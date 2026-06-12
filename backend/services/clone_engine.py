"""Voice cloning engine using XTTS v2 (Coqui TTS).

Loads the XTTS v2 model on first use (lazy init) and keeps it resident
in GPU memory. Synthesizes text using a reference audio sample to clone
the speaker's voice.

Concurrency: an asyncio.Semaphore limits GPU access to one inference at
a time. A timeout prevents hung requests.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from pathlib import Path
from typing import TYPE_CHECKING

import torch
from pydub import AudioSegment

from ..config import settings
from ..cancellation import CancelledError, CancellationToken
from ..exceptions import SynthesisError
from ..gpu_lock import gpu_semaphore
from ..paths import OUTPUT_DIR, TEMP_DIR
from .castilian_warmup import time_stretch_wav
from .intelligibility import score_intelligibility
from .job_store import chunk_path as job_chunk_path

if TYPE_CHECKING:
    from TTS.api import TTS as TTSApi

logger = logging.getLogger(__name__)

XTTS_MODEL_NAME = "tts_models/multilingual/multi-dataset/xtts_v2"

# Map our language codes to XTTS language codes.
XTTS_LANGUAGES = {"es": "es", "en": "en"}

# Max seconds to wait for a single chunk synthesis before timing out.
_CHUNK_TIMEOUT_SECONDS = 180

# Shared GPU semaphore — only one CUDA inference at a time across all engines.
_gpu_semaphore = gpu_semaphore

# XTTS v2 generation parameters optimized for maximum quality.
# Trade-off: ~3-5x slower than defaults, but significantly fewer artifacts.
_XTTS_QUALITY_PARAMS = {
    # Lower temperature = more deterministic, fewer hallucinations.
    # Default is 0.75; 0.1 is extremely conservative.
    "temperature": 0.1,
    # Very narrow sampling distribution.
    "top_p": 0.4,
    # Restrict token choices aggressively.
    "top_k": 20,
    # High repetition penalty prevents loops and artifacts.
    "repetition_penalty": 10.0,
    # Greedy decoding. Beam search (num_beams>1) causes tensor shape
    # errors in XTTS v2 — not stable.
    "num_beams": 1,
    # Use maximum reference audio for voice conditioning.
    "gpt_cond_len": 30,
    "gpt_cond_chunk_len": 4,
    # Use full reference audio for speaker embedding extraction.
    "max_ref_len": 60,
    # Normalize reference audio levels for consistent output volume.
    "sound_norm_refs": True,
}

# Candidate budget (VOZ-08 — ASR-in-the-loop re-ranking).
#
# The old design generated 8 candidates per chunk (plus up to 4 blind
# retry rounds) and picked one by signal statistics alone, which is
# blind to diction: a fluent candidate with the wrong words scored
# perfectly. Final selection is now decided by measured intelligibility
# (faster-whisper transcription vs the expected text, see
# services/intelligibility.py), so the blind 8-sample sweep is wasted
# GPU: start with 2 candidates and escalate with 2 more (4 max) only
# when the best falls below settings.intelligibility_threshold.
_CANDIDATES_PER_CHUNK = 2
_ADAPTIVE_EXTRA_CANDIDATES = 2
_MAX_CANDIDATES = 4

# Cheap signal pre-filter cutoff (_score_audio units). Candidates above
# it look like hallucinations (clean audio scores 3-8, hallucinations
# 15+) and are discarded before paying an ASR pass. If EVERY candidate
# in a round exceeds it, all are kept: the signal scorer is evidently
# uninformative for that chunk and intelligibility decides alone.
_PREFILTER_THRESHOLD = 8.0


class CloneEngine:
    """XTTS v2 voice cloning engine with lazy model loading.

    The model (~1.8GB) is downloaded automatically on first use and
    loaded into GPU memory. Subsequent calls reuse the loaded model.

    A semaphore ensures only one inference runs on the GPU at a time,
    preventing VRAM contention and hangs with concurrent requests.
    """

    def __init__(self) -> None:
        self._model: TTSApi | None = None
        self._device: str = "cuda" if torch.cuda.is_available() else "cpu"
        self._generation_count: int = 0

    @property
    def is_available(self) -> bool:
        """Check if CUDA is available for cloning."""
        return torch.cuda.is_available()

    @property
    def is_loaded(self) -> bool:
        return self._model is not None

    def load_model(self) -> None:
        """Load XTTS v2 model into GPU memory.

        Called lazily on first synthesis request, or can be called
        eagerly at startup to avoid first-request latency.
        """
        if self._model is not None:
            return

        logger.info("Loading XTTS v2 model on %s (this may take a moment)...", self._device)
        from TTS.api import TTS as TTSApi

        self._model = TTSApi(XTTS_MODEL_NAME).to(self._device)
        self._generation_count = 0
        logger.info("XTTS v2 model loaded successfully on %s", self._device)

    def unload_model(self) -> None:
        """Unload model from GPU memory."""
        if self._model is not None:
            del self._model
            self._model = None
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            self._generation_count = 0
            logger.info("XTTS v2 model unloaded")

    def _clear_cuda_cache(self) -> None:
        """Clear CUDA cache to prevent VRAM fragmentation."""
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    @staticmethod
    def _trim_silences(path: Path, silence_thresh_db: int = -40, min_silence_ms: int = 150) -> None:
        """Remove internal silences from a generated chunk.

        XTTS v2 inserts phantom pauses at arbitrary points. This
        detects silence segments longer than min_silence_ms and
        replaces them with a short 80ms gap (just enough for a
        natural breath, not a noticeable pause).

        Modifies the file in place.
        """
        try:
            from pydub.silence import detect_silence
        except ImportError:
            return  # pydub.silence not available (e.g. in tests)

        try:
            audio = AudioSegment.from_wav(str(path))
            silences = detect_silence(audio, min_silence_len=min_silence_ms, silence_thresh=silence_thresh_db)

            if not silences:
                return

            # Build new audio by keeping speech and replacing long silences
            # with short 80ms gaps
            result = AudioSegment.empty()
            prev_end = 0
            short_gap = AudioSegment.silent(duration=80)

            for start, end in silences:
                # Keep the speech before this silence
                if start > prev_end:
                    result += audio[prev_end:start]
                # Replace silence with short gap
                result += short_gap
                prev_end = end

            # Append remaining audio after last silence
            if prev_end < len(audio):
                result += audio[prev_end:]

            # Only save if we actually trimmed something meaningful
            if len(audio) - len(result) > 50:
                result.export(str(path), format="wav")

        except Exception:
            pass  # If trimming fails, keep original audio

    def _score_audio(self, path: Path) -> float:
        """Score an audio file by signal quality (lower = better).

        Combines three metrics to detect hallucinations:
        1. Energy variance — artifacts cause sudden spikes
        2. Peak-to-mean ratio — hallucinations have extreme peaks
        3. Silence ratio — too much silence indicates model confusion

        Clean audio typically scores 3-8. Hallucinations score 15+.

        Role since VOZ-08: cheap PRE-FILTER only. It discards obviously
        broken candidates before the ASR pass; the final selection is
        made by measured intelligibility (it is blind to diction — a
        fluent candidate with the wrong words scores perfectly here).
        """
        try:
            audio = AudioSegment.from_wav(str(path))
            window_ms = 30
            energies = []
            silent_windows = 0
            total_windows = 0

            for i in range(0, len(audio) - window_ms, window_ms):
                window = audio[i : i + window_ms]
                total_windows += 1
                if window.dBFS > -50:
                    energies.append(window.dBFS)
                else:
                    silent_windows += 1

            if not energies or total_windows == 0:
                return 999.0

            mean = sum(energies) / len(energies)

            # 1. Energy std dev (smooth = good)
            variance = sum((e - mean) ** 2 for e in energies) / len(energies)
            std_dev = variance ** 0.5

            # 2. Peak deviation (how far the worst spike is from mean)
            peak_dev = max(abs(e - mean) for e in energies)
            peak_penalty = max(0, (peak_dev - 15) * 0.5)

            # 3. Silence ratio penalty (too much silence = confused model)
            silence_ratio = silent_windows / total_windows if total_windows > 0 else 0
            silence_penalty = max(0, (silence_ratio - 0.3) * 20)

            return std_dev + peak_penalty + silence_penalty
        except Exception:
            return 999.0

    async def _generate_one(
        self,
        text: str,
        speaker_wav: str,
        language: str,
        output_path: Path,
    ) -> None:
        """Generate a single audio file (one attempt).

        Holds the shared GPU semaphore only for THIS one inference, so other
        GPU work (a second chapter, /convert, experimental) can interleave
        between candidates instead of waiting behind the whole
        candidates loop + scoring.

        Speed policy (VOZ-04): XTTS's native ``speed`` kwarg is NEVER
        forwarded — with long speaker_wavs the model locks onto the
        sample's cadence and silently ignores it, and when it does act
        the quality is poor. Clone speed is always resolved as a Rubber
        Band post-stretch over natural-cadence output (see
        ``synthesize_long`` and ``castilian_warmup.time_stretch_wav``).
        """
        assert self._model is not None  # noqa: S101
        async with _gpu_semaphore:
            self._generation_count += 1
            if self._generation_count % 10 == 0:
                self._clear_cuda_cache()
            await asyncio.wait_for(
                asyncio.to_thread(
                    self._model.tts_to_file,
                    text=text,
                    speaker_wav=speaker_wav,
                    language=language,
                    file_path=str(output_path),
                    **_XTTS_QUALITY_PARAMS,
                ),
                timeout=_CHUNK_TIMEOUT_SECONDS,
            )

    async def raw_synthesize(
        self,
        text: str,
        speaker_wav: str,
        language: str,
        output_path: Path,
        temperature: float = 0.3,
        top_p: float = 0.7,
        repetition_penalty: float = 10.0,
    ) -> None:
        """Direct XTTS v2 synthesis for experimental use.

        Bypasses the quality system (no candidates, no retries) but
        still acquires the shared GPU semaphore. Use for fast iteration
        on cross-lingual tests.

        Speed policy (VOZ-04): no ``speed`` kwarg, ever — the model
        always synthesizes at its natural cadence (which also keeps the
        Castilian-leaning code path: forwarding ``speed`` has been
        observed to nudge Spanish output toward a Latin American
        accent). Callers that need a different speed post-stretch the
        output with ``castilian_warmup.time_stretch_wav`` (Rubber Band).
        """
        if not self.is_available:
            raise SynthesisError("CUDA is not available. Voice cloning requires an NVIDIA GPU.")

        self.load_model()
        assert self._model is not None  # noqa: S101

        async with _gpu_semaphore:
            await asyncio.wait_for(
                asyncio.to_thread(
                    self._model.tts_to_file,
                    text=text,
                    speaker_wav=speaker_wav,
                    language=language,
                    file_path=str(output_path),
                    temperature=temperature,
                    top_p=top_p,
                    repetition_penalty=repetition_penalty,
                ),
                timeout=_CHUNK_TIMEOUT_SECONDS,
            )

    async def _generate_candidates(
        self,
        text: str,
        speaker_wav: str,
        language: str,
        file_id: str,
        count: int,
        offset: int = 0,
        cancel_token: CancellationToken | None = None,
    ) -> list[Path]:
        """Generate N candidate audio files for a chunk."""
        candidates: list[Path] = []
        for i in range(count):
            if cancel_token is not None:
                cancel_token.check()
            candidate = TEMP_DIR / f"{file_id}_cand{offset + i}.wav"
            candidates.append(candidate)
            await self._generate_one(
                text=text,
                speaker_wav=speaker_wav,
                language=language,
                output_path=candidate,
            )
        return candidates

    async def _rank_by_intelligibility(
        self,
        candidates: list[Path],
        expected_text: str,
        language: str,
        intel_scores: dict[Path, float],
    ) -> None:
        """Score not-yet-ranked candidates and record them in ``intel_scores``.

        Two stages per new batch:
        1. Cheap signal pre-filter (``_score_audio``, CPU, off the event
           loop and outside any GPU lock): candidates over
           ``_PREFILTER_THRESHOLD`` are dropped before paying a
           transcription. If the WHOLE batch exceeds it, all are kept —
           the signal scorer carries no information for this chunk and
           intelligibility decides alone.
        2. ASR intelligibility (``score_intelligibility``, holds the GPU
           semaphore per transcription) for each survivor.

        Already-scored paths are skipped, so the adaptive escalation
        round never re-transcribes round-one candidates.
        """
        fresh = [c for c in candidates if c not in intel_scores]
        signal = [(c, await asyncio.to_thread(self._score_audio, c)) for c in fresh]
        survivors = [c for c, s in signal if s <= _PREFILTER_THRESHOLD]
        if not survivors:
            survivors = fresh
        dropped = len(fresh) - len(survivors)
        if dropped:
            logger.info("Pre-filter discarded %d/%d candidates before ASR", dropped, len(fresh))
        for candidate in survivors:
            intel_scores[candidate] = await score_intelligibility(
                candidate, expected_text, language=language,
            )

    async def synthesize_chunk(
        self,
        text: str,
        speaker_wav: str | Path,
        language: str = "es",
        cancel_token: CancellationToken | None = None,
    ) -> Path:
        """Synthesize a single chunk using voice cloning.

        Generates 2 candidates and picks the one that most intelligibly
        speaks the expected text (ASR re-ranking, VOZ-08; the signal
        scorer only pre-filters obvious hallucinations). If the best
        falls below ``settings.intelligibility_threshold``, generates
        2 more (4 max) and accepts the best available with a warning.
        Always at natural cadence — speed is a post-stretch concern
        of ``synthesize_long``.
        """
        if not self.is_available:
            raise SynthesisError("CUDA is not available. Voice cloning requires an NVIDIA GPU.")

        self.load_model()

        xtts_lang = XTTS_LANGUAGES.get(language, "es")
        file_id = str(uuid.uuid4())[:12]
        all_candidates: list[Path] = []
        intel_scores: dict[Path, float] = {}
        threshold = settings.intelligibility_threshold

        try:
            # The GPU semaphore is held per-inference inside _generate_one
            # (and per-transcription inside score_intelligibility), so it's
            # released between candidates and rounds and other GPU work can
            # interleave.
            candidates = await self._generate_candidates(
                text, str(speaker_wav), xtts_lang, file_id, _CANDIDATES_PER_CHUNK,
                cancel_token=cancel_token,
            )
            all_candidates.extend(candidates)
            await self._rank_by_intelligibility(all_candidates, text, xtts_lang, intel_scores)
            best, best_intel = max(intel_scores.items(), key=lambda kv: kv[1])

            # Adaptive escalation: one extra round only when the best
            # candidate doesn't reach the intelligibility threshold.
            if best_intel < threshold and len(all_candidates) < _MAX_CANDIDATES:
                logger.info(
                    "Best intelligibility %.3f below threshold %.2f — generating %d more candidates",
                    best_intel, threshold, _ADAPTIVE_EXTRA_CANDIDATES,
                )
                extra = await self._generate_candidates(
                    text, str(speaker_wav), xtts_lang, file_id,
                    _ADAPTIVE_EXTRA_CANDIDATES, offset=len(all_candidates),
                    cancel_token=cancel_token,
                )
                all_candidates.extend(extra)
                await self._rank_by_intelligibility(all_candidates, text, xtts_lang, intel_scores)
                best, best_intel = max(intel_scores.items(), key=lambda kv: kv[1])

            if best_intel < threshold:
                logger.warning(
                    "Accepting best-available candidate %s with intelligibility %.3f "
                    "below threshold %.2f (%d candidates tried)",
                    best.name, best_intel, threshold, len(all_candidates),
                )
            else:
                logger.info(
                    "Best candidate: %s (intelligibility %.3f) from %d generated",
                    best.name, best_intel, len(all_candidates),
                )

            # Move best to final output path, trim silences, delete the rest
            output_path = TEMP_DIR / f"{file_id}_clone.wav"
            best.rename(output_path)
            self._trim_silences(output_path)
            for c in all_candidates:
                c.unlink(missing_ok=True)

            logger.info(
                "Clone chunk synthesized: %s (%d bytes)",
                output_path,
                output_path.stat().st_size,
            )
            return output_path

        except CancelledError:
            for c in all_candidates:
                c.unlink(missing_ok=True)
            self._clear_cuda_cache()
            logger.info("Clone synthesis cancelled by client")
            raise SynthesisError("Synthesis cancelled: client disconnected") from None

        except asyncio.TimeoutError:
            for c in all_candidates:
                c.unlink(missing_ok=True)
            self._clear_cuda_cache()
            logger.error("Clone synthesis timed out after %ds", _CHUNK_TIMEOUT_SECONDS)
            raise SynthesisError(
                f"Voice cloning timed out after {_CHUNK_TIMEOUT_SECONDS}s. "
                "Try with shorter text or restart the backend."
            ) from None

        except SynthesisError:
            raise

        except Exception as exc:
            for c in all_candidates:
                c.unlink(missing_ok=True)
            self._clear_cuda_cache()
            logger.error("Clone synthesis error: %s", exc)
            raise SynthesisError(f"Voice cloning error: {exc}") from exc

    async def synthesize_long(
        self,
        chunks: list,  # list[_CloneChunk] from tts_engine
        speaker_wav: str | Path,
        language: str,
        output_format: str,
        format_config: dict,
        cancel_token: CancellationToken | None = None,
        speed: float = 1.0,
        job_id: str | None = None,
    ) -> tuple[Path, int]:
        """Synthesize multiple chunks with cloning and concatenate.

        Each chunk has its own pause_ms that determines the silence
        inserted after it (comma=200ms, sentence=500ms, paragraph=900ms).

        ``speed`` is never forwarded to XTTS (see ``_generate_one``):
        every chunk is synthesized at natural cadence and the
        concatenated master is post-stretched once with Rubber Band
        (clamped to the safe ±25% range).

        When ``job_id`` is set, every finished chunk is promoted into the
        job dir (``data/jobs/{job_id}/chunk_NNNN.wav``) with an atomic
        ``os.replace``, mirroring the Edge-TTS path: a crashed job can be
        resumed and chunks already on disk are skipped instead of paying
        the full candidates × retries GPU loop again.
        """
        file_id = str(uuid.uuid4())[:12]
        output_path = OUTPUT_DIR / f"{file_id}.{output_format}"
        temp_files: list[Path] = []
        use_job_dir = job_id is not None

        # Local import to avoid a circular dep with tts_engine at module load.
        from .progress import registry as progress_registry

        try:
            for i, chunk in enumerate(chunks):
                chunk_text = chunk.text if hasattr(chunk, "text") else str(chunk)
                if cancel_token is not None:
                    cancel_token.check()

                if use_job_dir:
                    persisted = job_chunk_path(job_id, i, "wav")
                    persisted.parent.mkdir(parents=True, exist_ok=True)
                    if persisted.exists() and persisted.stat().st_size > 0:
                        logger.info(
                            "Clone chunk %d/%d already present, skipping",
                            i + 1, len(chunks),
                        )
                        temp_files.append(persisted)
                        progress_registry.update(job_id, chunks_done=i + 1)
                        continue

                chunk_path = await self.synthesize_chunk(chunk_text, speaker_wav, language, cancel_token=cancel_token)
                if use_job_dir:
                    # Promote the finished chunk into the job dir with an
                    # atomic rename so a crash can only ever leave whole
                    # chunk files behind.
                    chunk_path.replace(persisted)
                    chunk_path = persisted
                temp_files.append(chunk_path)
                logger.info("Clone chunk %d/%d done: '%s'", i + 1, len(chunks),
                            chunk_text[:60] + ("..." if len(chunk_text) > 60 else ""))
                if job_id:
                    progress_registry.update(job_id, chunks_done=i + 1)

            # Concatenate with per-chunk pause durations
            combined = AudioSegment.empty()
            for j, (tf, chunk) in enumerate(zip(temp_files, chunks)):
                segment = AudioSegment.from_wav(str(tf))
                combined += segment
                pause_ms = chunk.pause_ms if hasattr(chunk, "pause_ms") else 500
                if pause_ms > 0 and j < len(temp_files) - 1:
                    combined += AudioSegment.silent(duration=pause_ms)

            # Speed is resolved HERE, never inside XTTS: one Rubber Band
            # post-stretch over the natural-cadence master (no-op within
            # epsilon, clamped to ±25% inside time_stretch_wav).
            if abs(speed - 1.0) >= 0.01:
                stretch_wav = TEMP_DIR / f"{file_id}_stretch.wav"
                combined.export(str(stretch_wav), format="wav")
                if time_stretch_wav(stretch_wav, speed):
                    combined = AudioSegment.from_wav(str(stretch_wav))
                stretch_wav.unlink(missing_ok=True)

            # Export to requested format
            combined.export(
                str(output_path),
                format=format_config["format"],
                codec=format_config["codec"],
                parameters=format_config["parameters"],
            )

            logger.info(
                "Clone audio exported: %s (%d bytes, %d chunks)",
                output_path,
                output_path.stat().st_size,
                len(chunks),
            )
            return output_path, len(chunks)

        except SynthesisError:
            raise
        except Exception as exc:
            output_path.unlink(missing_ok=True)
            logger.error("Clone synthesis error: %s", exc)
            raise SynthesisError(f"Voice cloning error: {exc}") from exc
        finally:
            # Chunks living in a job dir are the resume payload — the caller
            # tears them down via job_store.cleanup_job on success. On crash
            # they are exactly what makes resume possible.
            if not use_job_dir:
                for tf in temp_files:
                    tf.unlink(missing_ok=True)
