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
from ..paths import OUTPUT_DIR, TEMP_DIR

if TYPE_CHECKING:
    from openvoice.api import ToneColorConverter

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_MODEL_DIR = _PROJECT_ROOT / "models" / "openvoice_v2"
_CONVERTER_DIR = _MODEL_DIR / "converter"

# Max source audio length in seconds. Longer files are split into segments.
_MAX_SEGMENT_SECONDS = 300  # 5 minutes per segment
_SEGMENT_OVERLAP_SECONDS = 1  # 1s overlap for smooth crossfade


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
        logger.info("OpenVoice V2 converter loaded on %s", self._device)

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

    async def convert(
        self,
        source_path: Path,
        target_sample_path: Path,
        output_format: str = "mp3",
    ) -> Path:
        """Convert source audio to match target voice.

        Args:
            source_path: Path to the audio to convert.
            target_sample_path: Path to the target voice reference (6-30s).
            output_format: Output format (mp3, wav, ogg, flac).

        Returns:
            Path to the converted audio file.
        """
        self.load_model()
        assert self._converter is not None  # noqa: S101

        file_id = str(uuid.uuid4())[:12]
        temp_wav = TEMP_DIR / f"{file_id}_converted.wav"
        output_path = OUTPUT_DIR / f"{file_id}.{output_format}"

        try:
            logger.info("Extracting target voice embedding from %s", target_sample_path.name)
            target_se = await asyncio.to_thread(
                self._extract_embedding, str(target_sample_path),
            )

            logger.info("Extracting source voice embedding from %s", source_path.name)
            source_se = await asyncio.to_thread(
                self._extract_embedding, str(source_path),
            )

            logger.info("Converting voice tone...")
            await asyncio.to_thread(
                self._converter.convert,
                audio_src_path=str(source_path),
                src_se=source_se,
                tgt_se=target_se,
                output_path=str(temp_wav),
                message="@VoxForge",
            )

            logger.info("Conversion done: %s (%d bytes)", temp_wav, temp_wav.stat().st_size)

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

        except SynthesisError:
            raise
        except Exception as exc:
            temp_wav.unlink(missing_ok=True)
            output_path.unlink(missing_ok=True)
            logger.error("Voice conversion error: %s", exc)
            raise SynthesisError(f"Voice conversion error: {exc}") from exc
