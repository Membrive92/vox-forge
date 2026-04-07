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
from ..paths import OUTPUT_DIR, TEMP_DIR

if TYPE_CHECKING:
    from TTS.api import TTS as TTSApi

logger = logging.getLogger(__name__)

XTTS_MODEL_NAME = "tts_models/multilingual/multi-dataset/xtts_v2"

# Map our language codes to XTTS language codes.
XTTS_LANGUAGES = {"es": "es", "en": "en"}

# Max seconds to wait for a single chunk synthesis before timing out.
_CHUNK_TIMEOUT_SECONDS = 180

# Only one GPU inference at a time to prevent VRAM contention.
_gpu_semaphore = asyncio.Semaphore(1)

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

# Generate each chunk N times and pick the best one (fewest artifacts).
_CANDIDATES_PER_CHUNK = 8

# If the best candidate's score exceeds this threshold, regenerate.
# Clean audio scores 3-8. Lower threshold = stricter quality gate.
_QUALITY_THRESHOLD = 8.0
_MAX_RETRIES = 4


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
        """Score an audio file by quality (lower = better).

        Combines three metrics to detect hallucinations:
        1. Energy variance — artifacts cause sudden spikes
        2. Peak-to-mean ratio — hallucinations have extreme peaks
        3. Silence ratio — too much silence indicates model confusion

        Clean audio typically scores 3-8. Hallucinations score 15+.
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
        """Generate a single audio file (one attempt)."""
        assert self._model is not None  # noqa: S101
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

    async def synthesize_chunk(
        self,
        text: str,
        speaker_wav: str | Path,
        language: str = "es",
        cancel_token: CancellationToken | None = None,
    ) -> Path:
        """Synthesize a single chunk using voice cloning.

        Generates N candidates, scores each, and picks the cleanest.
        If the best candidate exceeds the quality threshold, retries
        up to _MAX_RETRIES additional rounds to get a clean take.
        """
        if not self.is_available:
            raise SynthesisError("CUDA is not available. Voice cloning requires an NVIDIA GPU.")

        self.load_model()

        xtts_lang = XTTS_LANGUAGES.get(language, "es")
        file_id = str(uuid.uuid4())[:12]
        all_candidates: list[Path] = []

        try:
            async with _gpu_semaphore:
                self._generation_count += 1
                if self._generation_count % 10 == 0:
                    self._clear_cuda_cache()
                    logger.debug("CUDA cache cleared (generation %d)", self._generation_count)

                # First round of candidates
                candidates = await self._generate_candidates(
                    text, str(speaker_wav), xtts_lang, file_id, _CANDIDATES_PER_CHUNK,
                    cancel_token=cancel_token,
                )
                all_candidates.extend(candidates)

                # Score and check quality threshold
                scored = [(c, self._score_audio(c)) for c in all_candidates]
                scored.sort(key=lambda x: x[1])
                best_score = scored[0][1]

                # Retry if best candidate is below quality threshold
                retry = 0
                while best_score > _QUALITY_THRESHOLD and retry < _MAX_RETRIES:
                    retry += 1
                    logger.info(
                        "Best score %.2f exceeds threshold %.1f, retry %d/%d",
                        best_score, _QUALITY_THRESHOLD, retry, _MAX_RETRIES,
                    )
                    self._clear_cuda_cache()
                    extra = await self._generate_candidates(
                        text, str(speaker_wav), xtts_lang, file_id,
                        _CANDIDATES_PER_CHUNK, offset=len(all_candidates),
                        cancel_token=cancel_token,
                    )
                    all_candidates.extend(extra)
                    scored = [(c, self._score_audio(c)) for c in all_candidates]
                    scored.sort(key=lambda x: x[1])
                    best_score = scored[0][1]

            best = scored[0][0]
            logger.info(
                "Best candidate: %s (score %.2f) from %d total [best scores: %s]",
                best.name,
                best_score,
                len(scored),
                ", ".join(f"{s[1]:.2f}" for s in scored[:5]),
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
    ) -> tuple[Path, int]:
        """Synthesize multiple chunks with cloning and concatenate.

        Each chunk has its own pause_ms that determines the silence
        inserted after it (comma=200ms, sentence=500ms, paragraph=900ms).
        """
        file_id = str(uuid.uuid4())[:12]
        output_path = OUTPUT_DIR / f"{file_id}.{output_format}"
        temp_files: list[Path] = []

        try:
            for i, chunk in enumerate(chunks):
                chunk_text = chunk.text if hasattr(chunk, "text") else str(chunk)
                if cancel_token is not None:
                    cancel_token.check()
                chunk_path = await self.synthesize_chunk(chunk_text, speaker_wav, language, cancel_token=cancel_token)
                temp_files.append(chunk_path)
                logger.info("Clone chunk %d/%d done: '%s'", i + 1, len(chunks),
                            chunk_text[:60] + ("..." if len(chunk_text) > 60 else ""))

            # Concatenate with per-chunk pause durations
            combined = AudioSegment.empty()
            for j, (tf, chunk) in enumerate(zip(temp_files, chunks)):
                segment = AudioSegment.from_wav(str(tf))
                combined += segment
                pause_ms = chunk.pause_ms if hasattr(chunk, "pause_ms") else 500
                if pause_ms > 0 and j < len(temp_files) - 1:
                    combined += AudioSegment.silent(duration=pause_ms)

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
            for tf in temp_files:
                tf.unlink(missing_ok=True)
