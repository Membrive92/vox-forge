#!/usr/bin/env python3
"""prepare_dataset.py — build an XTTS fine-tuning dataset from raw voice recordings.

============================================================================
README
============================================================================

What it does
------------
Takes a folder of WAV/MP3 recordings of a single speaker (the author's
voice), slices them on silence into 6-12 s clips, transcribes each clip
with faster-whisper, and emits the Coqui trainer dataset layout
(ljspeech formatter):

    <output_dir>/
    ├── metadata.csv          # clip_id|transcription|transcription
    └── wavs/
        ├── <source>_000.wav  # mono, 16-bit, 22050 Hz
        ├── <source>_001.wav
        └── ...

This is the VOZ-11 prep tool. It is fully standalone: it does NOT import
anything from the VoxForge backend and is meant to run in its OWN
environment (fine-tuning tooling never enters the app runtime).

Setup (own venv, NOT VoxForge's)
--------------------------------
    python -m venv .venv-finetune
    .venv-finetune\\Scripts\\activate        # Windows
    pip install faster-whisper pydub

`ffmpeg` must be on PATH (already a VoxForge system dependency); pydub
needs it to decode MP3.

Usage
-----
    python prepare_dataset.py <input_dir> <output_dir> [options]

    python prepare_dataset.py D:\\grabaciones D:\\dataset --language es
    python prepare_dataset.py raw/ out/ --whisper-model medium --device cuda

Options: --language (default es), --whisper-model (default small),
--min-sec/--max-sec clip bounds (default 6/12), --silence-thresh-db
(default -40), --min-silence-ms (default 400), --device (auto/cpu/cuda).

Recording guidance (see internal-docs/xtts-finetune.md for the recipe)
----------------------------------------------------------------------
- Absolute minimum 2-3 minutes of clean speech; 5+ recommended;
  20-60 minutes is the target for narration quality.
- One microphone, one room, no music/noise, varied registers.

Caveat: the official Coqui GPT trainer filters out clips longer than
``max_wav_length=255995`` samples (~11.6 s at 22050 Hz). Keep --max-sec
at or below ~11.5, or raise ``max_wav_length`` in the trainer config;
this script warns when clips exceed that cap.
============================================================================
"""
from __future__ import annotations

import argparse
import logging
import re
import sys
from dataclasses import dataclass
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("prepare_dataset")

AUDIO_EXTENSIONS = frozenset({".wav", ".mp3"})

# XTTS GPT trainer operates on 22050 Hz mono audio (DVAE sample rate).
TARGET_SAMPLE_RATE = 22050

# Default max_wav_length of the official GPT trainer config, in seconds
# (255995 samples at 22050 Hz). Longer clips are silently dropped by the
# stock trainer unless its config is raised.
TRAINER_MAX_CLIP_SECONDS = 255995 / TARGET_SAMPLE_RATE

# Padding kept around each speech region so consonant onsets/decays
# aren't clipped by the silence detector.
EDGE_PAD_MS = 100


@dataclass(frozen=True)
class Clip:
    """One exported dataset clip, pending transcription."""

    clip_id: str
    path: Path
    duration_s: float


def find_source_files(input_dir: Path) -> list[Path]:
    """Return WAV/MP3 files in ``input_dir`` (non-recursive), sorted."""
    return sorted(
        p for p in input_dir.iterdir()
        if p.is_file() and p.suffix.lower() in AUDIO_EXTENSIONS
    )


def merge_speech_ranges(
    ranges: list[tuple[int, int]],
    min_ms: int,
    max_ms: int,
) -> list[tuple[int, int]]:
    """Greedily merge detected speech ranges into clip windows.

    Consecutive speech regions (and the silences between them) are
    accumulated until adding the next region would exceed ``max_ms``.
    Continuous speech longer than ``max_ms`` is hard-split. Windows
    shorter than ``min_ms`` are dropped (typically stray noises or the
    tail of a hard split).
    """
    merged: list[tuple[int, int]] = []
    cur_start: int | None = None
    cur_end = 0
    for start, end in ranges:
        if cur_start is None:
            cur_start, cur_end = start, end
        elif end - cur_start <= max_ms:
            cur_end = end
        else:
            merged.append((cur_start, cur_end))
            cur_start, cur_end = start, end
    if cur_start is not None:
        merged.append((cur_start, cur_end))

    windows: list[tuple[int, int]] = []
    for start, end in merged:
        while end - start > max_ms:
            windows.append((start, start + max_ms))
            start += max_ms
        windows.append((start, end))

    return [(s, e) for s, e in windows if e - s >= min_ms]


def slice_source_file(
    source: Path,
    wavs_dir: Path,
    *,
    min_sec: float,
    max_sec: float,
    silence_thresh_db: float,
    min_silence_ms: int,
) -> list[Clip]:
    """Slice one recording on silence and export normalized WAV clips."""
    from pydub import AudioSegment
    from pydub.silence import detect_nonsilent

    audio = AudioSegment.from_file(str(source))
    speech_ranges = detect_nonsilent(
        audio,
        min_silence_len=min_silence_ms,
        silence_thresh=silence_thresh_db,
    )
    if not speech_ranges:
        logger.warning("%s: no speech detected (threshold %.0f dBFS) — skipped",
                       source.name, silence_thresh_db)
        return []

    windows = merge_speech_ranges(
        [(int(s), int(e)) for s, e in speech_ranges],
        min_ms=int(min_sec * 1000),
        max_ms=int(max_sec * 1000),
    )

    stem = re.sub(r"[^A-Za-z0-9_-]", "_", source.stem)
    clips: list[Clip] = []
    for i, (start, end) in enumerate(windows):
        padded_start = max(0, start - EDGE_PAD_MS)
        padded_end = min(len(audio), end + EDGE_PAD_MS)
        segment = (
            audio[padded_start:padded_end]
            .set_channels(1)
            .set_frame_rate(TARGET_SAMPLE_RATE)
            .set_sample_width(2)
        )
        clip_id = f"{stem}_{i:03d}"
        clip_path = wavs_dir / f"{clip_id}.wav"
        segment.export(str(clip_path), format="wav")
        clips.append(Clip(clip_id=clip_id, path=clip_path,
                          duration_s=len(segment) / 1000.0))

    total_speech_s = sum((e - s) for s, e in speech_ranges) / 1000.0
    kept_s = sum(c.duration_s for c in clips)
    logger.info("%s: %d clips (%.1f s kept of %.1f s speech)",
                source.name, len(clips), kept_s, total_speech_s)
    return clips


def sanitize_transcription(text: str) -> str:
    """Collapse whitespace and strip the metadata.csv field separator."""
    return re.sub(r"\s+", " ", text.replace("|", " ")).strip()


def transcribe_clips(
    clips: list[Clip],
    *,
    whisper_model: str,
    language: str,
    device: str,
) -> dict[str, str]:
    """Transcribe every clip with faster-whisper; returns clip_id -> text."""
    from faster_whisper import WhisperModel

    logger.info("Loading faster-whisper model '%s' (device=%s)...",
                whisper_model, device)
    model = WhisperModel(whisper_model, device=device, compute_type="auto")

    transcriptions: dict[str, str] = {}
    for n, clip in enumerate(clips, start=1):
        segments, _info = model.transcribe(
            str(clip.path), language=language, beam_size=5,
        )
        text = sanitize_transcription(" ".join(seg.text for seg in segments))
        if len(text) < 3:
            logger.warning("[%d/%d] %s: empty/garbage transcription — clip excluded",
                           n, len(clips), clip.clip_id)
            continue
        transcriptions[clip.clip_id] = text
        logger.info("[%d/%d] %s (%.1f s): %s",
                    n, len(clips), clip.clip_id, clip.duration_s,
                    text if len(text) <= 80 else text[:77] + "...")
    return transcriptions


def write_metadata(
    output_dir: Path,
    clips: list[Clip],
    transcriptions: dict[str, str],
) -> Path:
    """Write the ljspeech-style ``metadata.csv`` (id|text|normalized_text).

    Coqui's ``ljspeech`` formatter resolves each id to
    ``<output_dir>/wavs/<id>.wav``; both text columns carry the same
    transcription (no separate normalization pass).
    """
    metadata_path = output_dir / "metadata.csv"
    lines = [
        f"{clip.clip_id}|{transcriptions[clip.clip_id]}|{transcriptions[clip.clip_id]}"
        for clip in clips
        if clip.clip_id in transcriptions
    ]
    metadata_path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    return metadata_path


def summarize(clips: list[Clip], transcriptions: dict[str, str]) -> None:
    """Print dataset totals against the fine-tuning data targets."""
    kept = [c for c in clips if c.clip_id in transcriptions]
    total_minutes = sum(c.duration_s for c in kept) / 60.0
    logger.info("Dataset: %d clips, %.1f minutes total", len(kept), total_minutes)

    if total_minutes < 3:
        logger.warning("Under the 2-3 minute absolute minimum — record more "
                       "before training (target: 20-60 min for narration).")
    elif total_minutes < 5:
        logger.warning("Usable but thin (5+ minutes recommended; "
                       "20-60 min target for narration).")
    elif total_minutes < 20:
        logger.info("Good for a first run; 20-60 minutes is the narration target.")

    over_cap = [c for c in kept if c.duration_s > TRAINER_MAX_CLIP_SECONDS]
    if over_cap:
        logger.warning(
            "%d clips exceed the stock trainer cap of %.1f s (max_wav_length=255995); "
            "they will be dropped by the official GPT trainer unless you raise "
            "max_wav_length — or rerun with --max-sec %.1f.",
            len(over_cap), TRAINER_MAX_CLIP_SECONDS, TRAINER_MAX_CLIP_SECONDS - 0.1,
        )


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Slice + transcribe voice recordings into a Coqui XTTS "
                    "fine-tuning dataset (ljspeech-style metadata.csv + wavs/).",
    )
    parser.add_argument("input_dir", type=Path,
                        help="Folder with WAV/MP3 recordings of ONE speaker")
    parser.add_argument("output_dir", type=Path,
                        help="Dataset destination (created if missing)")
    parser.add_argument("--language", default="es",
                        help="Speech language for transcription (default: es)")
    parser.add_argument("--whisper-model", default="small",
                        help="faster-whisper model size (default: small; "
                             "use 'medium' for better Spanish accuracy)")
    parser.add_argument("--min-sec", type=float, default=6.0,
                        help="Minimum clip length in seconds (default: 6)")
    parser.add_argument("--max-sec", type=float, default=12.0,
                        help="Maximum clip length in seconds (default: 12; "
                             "the stock Coqui trainer caps at ~11.6 s)")
    parser.add_argument("--silence-thresh-db", type=float, default=-40.0,
                        help="Silence threshold in dBFS (default: -40)")
    parser.add_argument("--min-silence-ms", type=int, default=400,
                        help="Minimum silence to split on, in ms (default: 400)")
    parser.add_argument("--device", default="auto", choices=("auto", "cpu", "cuda"),
                        help="faster-whisper device (default: auto)")
    args = parser.parse_args(argv)

    if args.min_sec <= 0 or args.max_sec <= args.min_sec:
        parser.error("--min-sec must be > 0 and --max-sec must be > --min-sec")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    if not args.input_dir.is_dir():
        logger.error("Input directory does not exist: %s", args.input_dir)
        return 1
    sources = find_source_files(args.input_dir)
    if not sources:
        logger.error("No WAV/MP3 files found in %s", args.input_dir)
        return 1

    wavs_dir = args.output_dir / "wavs"
    wavs_dir.mkdir(parents=True, exist_ok=True)

    clips: list[Clip] = []
    for source in sources:
        clips.extend(slice_source_file(
            source, wavs_dir,
            min_sec=args.min_sec,
            max_sec=args.max_sec,
            silence_thresh_db=args.silence_thresh_db,
            min_silence_ms=args.min_silence_ms,
        ))
    if not clips:
        logger.error("No usable clips produced — check --silence-thresh-db "
                     "and that the recordings contain speech.")
        return 1

    transcriptions = transcribe_clips(
        clips,
        whisper_model=args.whisper_model,
        language=args.language,
        device=args.device,
    )
    if not transcriptions:
        logger.error("No clip produced a usable transcription.")
        return 1

    # Remove clips whose transcription was rejected — the trainer must
    # never see a wav without a metadata row.
    for clip in clips:
        if clip.clip_id not in transcriptions:
            clip.path.unlink(missing_ok=True)

    metadata_path = write_metadata(args.output_dir, clips, transcriptions)
    logger.info("Wrote %s (%d entries)", metadata_path, len(transcriptions))
    summarize(clips, transcriptions)
    logger.info("Next step: train per internal-docs/xtts-finetune.md, then point "
                "VoxForge at the result via VOXFORGE_XTTS_CHECKPOINT_DIR.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
