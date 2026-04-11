"""Voice conversion engine using OpenVoice V2.

Converts the tone/timbre of a source audio to match a target voice
reference, preserving the original speech content and prosody.
Audio-to-audio, not text-to-audio.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from pathlib import Path
from typing import TYPE_CHECKING

import torch
from pydub import AudioSegment

from ..exceptions import SynthesisError
from ..gpu_lock import gpu_semaphore
from ..paths import OUTPUT_DIR, TEMP_DIR

if TYPE_CHECKING:
    from openvoice.api import ToneColorConverter

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_MODEL_DIR = _PROJECT_ROOT / "models" / "openvoice_v2"
_CONVERTER_DIR = _MODEL_DIR / "converter"

# Max seconds per conversion step before timing out.
_CONVERT_TIMEOUT_SECONDS = 600


class ConvertEngine:
    """OpenVoice V2 voice conversion with lazy model loading.

    Loads the ToneColorConverter on first use (~131MB model).
    Converts source audio to match a target voice reference sample.
    """

    def __init__(self) -> None:
        self._converter: ToneColorConverter | None = None
        self._device: str = "cuda:0" if torch.cuda.is_available() else "cpu"

    @property
    def is_available(self) -> bool:
        return _CONVERTER_DIR.exists() and (
            (_CONVERTER_DIR / "checkpoint.pth").exists()
        )

    @property
    def is_loaded(self) -> bool:
        return self._converter is not None

    def load_model(self) -> None:
        """Load OpenVoice V2 converter into GPU memory."""
        if self._converter is not None:
            return

        if not self.is_available:
            raise SynthesisError(
                "OpenVoice V2 model not found. Run: "
                "python -c \"from huggingface_hub import snapshot_download; "
                "snapshot_download('myshell-ai/OpenVoiceV2', local_dir='models/openvoice_v2')\""
            )

        logger.info("Loading OpenVoice V2 converter on %s...", self._device)
        from openvoice.api import ToneColorConverter

        self._converter = ToneColorConverter(
            str(_CONVERTER_DIR / "config.json"),
            device=self._device,
        )
        self._converter.load_ckpt(str(_CONVERTER_DIR / "checkpoint.pth"))

        # Disable the watermark: the wavmark neural network rewrites
        # 1-second chunks and causes the well-known "robotic + low
        # volume" artifact. Replace add_watermark with a no-op that
        # passes the audio through unchanged.
        def _noop_watermark(wav: object, message: object = None) -> object:  # noqa: ARG001
            return wav

        self._converter.add_watermark = _noop_watermark  # type: ignore[method-assign]
        logger.info("OpenVoice V2 converter loaded on %s (watermark disabled)", self._device)

    def unload_model(self) -> None:
        """Unload model from GPU memory."""
        if self._converter is not None:
            del self._converter
            self._converter = None
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            logger.info("OpenVoice V2 converter unloaded")

    def _extract_embedding(self, audio_path: str) -> object:
        """Extract speaker embedding from an audio file."""
        from openvoice import se_extractor

        se, _ = se_extractor.get_se(
            audio_path,
            self._converter,
            vad=True,
        )
        return se

    @staticmethod
    def _prepare_source(source_path: Path) -> Path:
        """Normalize source audio to 22050 Hz mono WAV, peak at -1 dBFS.

        OpenVoice V2's native sample rate is 22050 Hz. Pre-resampling and
        peak-normalizing avoids librosa surprises inside convert() and
        fixes the low-volume output problem.
        """
        import librosa
        import numpy as np
        import soundfile as sf

        y, _ = librosa.load(str(source_path), sr=22050, mono=True)
        peak = float(np.max(np.abs(y))) if y.size else 0.0
        if peak > 0:
            y = (y / peak) * 0.98

        prepped = source_path.with_name(f"{source_path.stem}_prep.wav")
        sf.write(str(prepped), y, 22050, subtype="PCM_16")
        return prepped

    @staticmethod
    def _normalize_output(path: Path) -> None:
        """Peak-normalize the converted output to -0.5 dBFS.

        OpenVoice's convert() does not normalize, so output typically
        sits around -6 to -12 dBFS. Post-normalization restores full
        perceived loudness without distortion.
        """
        import numpy as np
        import soundfile as sf

        try:
            y, sr = sf.read(str(path))
            peak = float(np.max(np.abs(y))) if y.size else 0.0
            if peak > 0:
                y = (y / peak) * 0.95
                sf.write(str(path), y, sr)
        except Exception as exc:
            logger.warning("Could not normalize output: %s", exc)

    async def convert(
        self,
        source_path: Path,
        target_sample_path: Path,
        output_format: str = "mp3",
        pitch_shift: float = 0.0,
        formant_shift: float = 0.0,
        bass_boost_db: float = 0.0,
    ) -> Path:
        """Convert source audio to match target voice.

        Args:
            source_path: Path to the audio to convert.
            target_sample_path: Path to the target voice reference (6-30s).
            output_format: Output format (mp3, wav, ogg, flac).
            pitch_shift: Pitch adjustment in semitones after conversion
                (-12 to +12). Negative = deeper.
            formant_shift: Formant resonance shift after conversion
                (-6 to +6). Negative = deeper, more chest resonance.
            bass_boost_db: Low-frequency shelf boost in dB (-6 to +12).

        Returns:
            Path to the converted audio file.
        """
        self.load_model()
        assert self._converter is not None  # noqa: S101

        file_id = str(uuid.uuid4())[:12]
        temp_wav = TEMP_DIR / f"{file_id}_converted.wav"
        output_path = OUTPUT_DIR / f"{file_id}.{output_format}"
        prepped_source: Path | None = None

        try:
            # Pre-process source: resample to 22050Hz mono and peak-normalize
            logger.info("Preparing source audio: %s", source_path.name)
            prepped_source = await asyncio.to_thread(self._prepare_source, source_path)

            async with gpu_semaphore:
                logger.info("Extracting target voice embedding from %s", target_sample_path.name)
                target_se = await asyncio.wait_for(
                    asyncio.to_thread(self._extract_embedding, str(target_sample_path)),
                    timeout=_CONVERT_TIMEOUT_SECONDS,
                )

                logger.info("Extracting source voice embedding from %s", prepped_source.name)
                source_se = await asyncio.wait_for(
                    asyncio.to_thread(self._extract_embedding, str(prepped_source)),
                    timeout=_CONVERT_TIMEOUT_SECONDS,
                )

                logger.info("Converting voice tone...")
                await asyncio.wait_for(
                    asyncio.to_thread(
                        self._converter.convert,
                        audio_src_path=str(prepped_source),
                        src_se=source_se,
                        tgt_se=target_se,
                        output_path=str(temp_wav),
                        message="",  # ignored when enable_watermark=False
                    ),
                    timeout=_CONVERT_TIMEOUT_SECONDS,
                )

            logger.info("Conversion done: %s (%d bytes)", temp_wav, temp_wav.stat().st_size)

            # Post-normalize to restore full loudness (convert() does not)
            await asyncio.to_thread(self._normalize_output, temp_wav)

            # Optional DSP post-processing (pitch, formants, bass)
            # Lets the user fine-tune residual brightness/darkness of the
            # converted voice. Applied on the WAV before format export.
            if abs(pitch_shift) > 0.05 or abs(formant_shift) > 0.05 or abs(bass_boost_db) > 0.05:
                from .voice_lab_engine import VoiceLabEngine, VoiceLabParams

                lab = VoiceLabEngine()
                params = VoiceLabParams(
                    pitch_semitones=pitch_shift,
                    formant_shift=formant_shift,
                    bass_boost_db=bass_boost_db,
                )
                logger.info(
                    "Applying DSP post-processing: pitch=%.1fst formant=%.1fst bass=%.1fdB",
                    pitch_shift, formant_shift, bass_boost_db,
                )
                post_path = await lab.process(temp_wav, params, "wav")
                temp_wav.unlink(missing_ok=True)
                temp_wav = post_path

            # Export to requested format
            if output_format == "wav":
                temp_wav.rename(output_path)
            else:
                from ..catalogs import AUDIO_FORMATS

                fmt = AUDIO_FORMATS.get(output_format, AUDIO_FORMATS["mp3"])
                audio = AudioSegment.from_wav(str(temp_wav))
                audio.export(
                    str(output_path),
                    format=fmt["format"],
                    codec=fmt["codec"],
                    parameters=fmt["parameters"],
                )
                temp_wav.unlink(missing_ok=True)

            logger.info("Converted audio exported: %s", output_path)
            return output_path

        except asyncio.TimeoutError:
            temp_wav.unlink(missing_ok=True)
            output_path.unlink(missing_ok=True)
            logger.error("Voice conversion timed out after %ds", _CONVERT_TIMEOUT_SECONDS)
            raise SynthesisError(
                f"Voice conversion timed out after {_CONVERT_TIMEOUT_SECONDS}s"
            ) from None
        except SynthesisError:
            raise
        except Exception as exc:
            temp_wav.unlink(missing_ok=True)
            output_path.unlink(missing_ok=True)
            logger.error("Voice conversion error: %s", exc)
            raise SynthesisError(f"Voice conversion error: {exc}") from exc
        finally:
            if prepped_source is not None:
                prepped_source.unlink(missing_ok=True)
