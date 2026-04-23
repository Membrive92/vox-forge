"""Stateless audio editor. Takes a source file + list of operations and
produces a new file with all ops applied in order.

Thin wrapper over pydub for slice/fade/peak-normalize ops; ``loudness``,
``denoise`` and ``compressor`` shell out to ffmpeg / noisereduce /
pedalboard respectively via a round-trip through a temp WAV. Each op
is pure: it takes an AudioSegment and returns a new AudioSegment.
"""
from __future__ import annotations

import logging
import shutil
import subprocess
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from pydub import AudioSegment

from ..catalogs import AUDIO_FORMATS
from ..exceptions import InvalidSampleError, UnsupportedFormatError
from ..paths import STUDIO_DIR, TEMP_DIR

logger = logging.getLogger(__name__)

VALID_OPERATIONS = frozenset({
    "trim", "delete_region", "fade_in", "fade_out", "normalize",
    "loudness", "denoise", "compressor",
})


@dataclass(frozen=True)
class EditOperation:
    """A single edit step."""

    type: str
    params: dict[str, Any]


def apply_operations(
    source_path: Path,
    operations: list[EditOperation],
    output_format: str = "mp3",
) -> Path:
    """Apply a sequence of edit operations to an audio file.

    Returns the path to the new file in ``data/studio/``.
    Raises ``UnsupportedFormatError`` if the output format is unknown.
    Raises ``InvalidSampleError`` if the source can't be decoded or
    any operation has invalid parameters.
    """
    if output_format not in AUDIO_FORMATS:
        raise UnsupportedFormatError(
            f"Unsupported format: {output_format}. Valid: {sorted(AUDIO_FORMATS)}"
        )
    if not operations:
        raise InvalidSampleError("No operations to apply")

    try:
        audio = AudioSegment.from_file(str(source_path))
    except Exception as exc:  # noqa: BLE001
        raise InvalidSampleError(
            f"Could not decode source audio: {exc}"
        ) from exc

    for idx, op in enumerate(operations):
        if op.type not in VALID_OPERATIONS:
            raise InvalidSampleError(
                f"Operation {idx} has unknown type: {op.type}"
            )
        try:
            audio = _dispatch(audio, op)
        except Exception as exc:  # noqa: BLE001
            raise InvalidSampleError(
                f"Operation {idx} ({op.type}) failed: {exc}"
            ) from exc

    STUDIO_DIR.mkdir(parents=True, exist_ok=True)
    file_id = str(uuid.uuid4())[:12]
    output = STUDIO_DIR / f"edit_{file_id}.{output_format}"

    fmt_cfg = AUDIO_FORMATS[output_format]
    audio.export(
        str(output),
        format=fmt_cfg["format"],
        codec=fmt_cfg["codec"],
        parameters=fmt_cfg["parameters"],
    )
    logger.info(
        "Audio edit exported: %s (%d ops, %d ms)",
        output.name, len(operations), len(audio),
    )
    return output


# ── Operation dispatch ──────────────────────────────────────────────


def _dispatch(audio: AudioSegment, op: EditOperation) -> AudioSegment:
    handler = _HANDLERS[op.type]
    return handler(audio, op.params)


def _trim(audio: AudioSegment, params: dict[str, Any]) -> AudioSegment:
    start = int(params.get("start_ms", 0))
    end = int(params.get("end_ms", len(audio)))
    start = max(0, min(start, len(audio)))
    end = max(start, min(end, len(audio)))
    if end <= start:
        raise ValueError(f"trim: end ({end}) must be greater than start ({start})")
    return audio[start:end]


def _delete_region(audio: AudioSegment, params: dict[str, Any]) -> AudioSegment:
    start = int(params.get("start_ms", 0))
    end = int(params.get("end_ms", 0))
    start = max(0, min(start, len(audio)))
    end = max(start, min(end, len(audio)))
    if end <= start:
        raise ValueError(f"delete_region: end ({end}) must be greater than start ({start})")
    return audio[:start] + audio[end:]


def _fade_in(audio: AudioSegment, params: dict[str, Any]) -> AudioSegment:
    duration = int(params.get("duration_ms", 1000))
    duration = max(1, min(duration, len(audio)))
    return audio.fade_in(duration)


def _fade_out(audio: AudioSegment, params: dict[str, Any]) -> AudioSegment:
    duration = int(params.get("duration_ms", 1000))
    duration = max(1, min(duration, len(audio)))
    return audio.fade_out(duration)


def _normalize(audio: AudioSegment, params: dict[str, Any]) -> AudioSegment:
    headroom_db = float(params.get("headroom_db", -1.0))
    # pydub exposes max_dBFS as the peak; shift the whole clip so the
    # peak lands at -headroom. If the clip is already quieter, we still
    # lift it up to the target.
    target_peak = headroom_db
    gain = target_peak - audio.max_dBFS
    return audio.apply_gain(gain)


# ── File-round-trip ops (C sprint) ──────────────────────────────────
# These three use external libs that work on raw samples rather than
# pydub's AudioSegment wrapper. They export to a temp WAV, run the
# transform on disk, and re-import. Each has a module-level runner
# (``_run_*``) so tests can monkeypatch them without pulling in
# ffmpeg / librosa / pedalboard.


def _round_trip(
    audio: AudioSegment,
    runner: Callable[[Path, Path], None],
    tag: str,
) -> AudioSegment:
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    suffix = uuid.uuid4().hex[:8]
    tmp_in = TEMP_DIR / f"{tag}_in_{suffix}.wav"
    tmp_out = TEMP_DIR / f"{tag}_out_{suffix}.wav"
    audio.export(str(tmp_in), format="wav")
    try:
        runner(tmp_in, tmp_out)
        return AudioSegment.from_file(str(tmp_out))
    finally:
        tmp_in.unlink(missing_ok=True)
        tmp_out.unlink(missing_ok=True)


def _run_loudnorm(in_path: Path, out_path: Path, target_lufs: float = -16.0) -> None:
    """Apply ffmpeg ``loudnorm`` filter. TP=-1.5, LRA=11 are ITU BS.1770
    defaults — good for speech/audiobook material."""
    argv = [
        "ffmpeg", "-y", "-i", str(in_path),
        "-af", f"loudnorm=I={target_lufs}:TP=-1.5:LRA=11",
        str(out_path),
    ]
    proc = subprocess.run(argv, capture_output=True)  # noqa: S603
    if proc.returncode != 0:
        tail = proc.stderr.decode(errors="replace")[-1500:]
        raise RuntimeError(f"ffmpeg loudnorm failed ({proc.returncode}): {tail}")


def _run_denoise(in_path: Path, out_path: Path, strength: float = 0.5) -> None:
    """Spectral-gating noise reduction via ``noisereduce``. Uses an
    internal estimate of stationary noise (no separate noise profile
    needed) so it works on single-clip input."""
    import numpy as np
    import noisereduce as nr
    import soundfile as sf

    data, sr = sf.read(str(in_path))
    # noisereduce expects shape (n,) for mono or (channels, n). If
    # soundfile gave us (n, channels), transpose first.
    if data.ndim == 2:
        data = data.T
    reduced = nr.reduce_noise(y=data, sr=sr, prop_decrease=strength, stationary=True)
    out = reduced.T if reduced.ndim == 2 else reduced
    sf.write(str(out_path), out, sr)


def _run_compressor(
    in_path: Path,
    out_path: Path,
    amount: float = 0.5,
    threshold_db: float = -18.0,
) -> None:
    """Simple single-knob compressor. ``amount`` (0..1) maps to ratio
    1:1 .. 6:1 with fixed audiobook-friendly attack 10ms / release 150ms."""
    import numpy as np
    import soundfile as sf
    from pedalboard import Compressor, Pedalboard  # type: ignore[import-not-found]

    ratio = 1.0 + max(0.0, min(1.0, amount)) * 5.0
    board = Pedalboard([
        Compressor(threshold_db=threshold_db, ratio=ratio,
                   attack_ms=10.0, release_ms=150.0),
    ])
    data, sr = sf.read(str(in_path), dtype="float32")
    if data.ndim == 1:
        data = data[:, np.newaxis]
    effected = board(data, sample_rate=sr)
    # soundfile writes back in the shape it receives — (frames, channels)
    if effected.shape[1] == 1:
        effected = effected[:, 0]
    sf.write(str(out_path), effected, sr)


def _loudness(audio: AudioSegment, params: dict[str, Any]) -> AudioSegment:
    target_lufs = float(params.get("target_lufs", -16.0))
    # Sanity range: platforms vary between -24 (loud podcasts) and
    # -10 (aggressive masters). Outside this, almost certainly a bug.
    if target_lufs < -40 or target_lufs > -5:
        raise ValueError(
            f"target_lufs out of range: {target_lufs}. Expected -40..-5 (typical -18..-14)."
        )
    return _round_trip(audio, lambda i, o: _run_loudnorm(i, o, target_lufs), "loud")


def _denoise(audio: AudioSegment, params: dict[str, Any]) -> AudioSegment:
    strength = float(params.get("strength", 0.5))
    if strength < 0.0 or strength > 1.0:
        raise ValueError(f"strength out of range: {strength}. Expected 0..1.")
    return _round_trip(audio, lambda i, o: _run_denoise(i, o, strength), "den")


def _compressor(audio: AudioSegment, params: dict[str, Any]) -> AudioSegment:
    amount = float(params.get("amount", 0.5))
    if amount < 0.0 or amount > 1.0:
        raise ValueError(f"amount out of range: {amount}. Expected 0..1.")
    threshold_db = float(params.get("threshold_db", -18.0))
    return _round_trip(
        audio,
        lambda i, o: _run_compressor(i, o, amount, threshold_db),
        "cmp",
    )


_HANDLERS = {
    "trim": _trim,
    "delete_region": _delete_region,
    "fade_in": _fade_in,
    "fade_out": _fade_out,
    "normalize": _normalize,
    "loudness": _loudness,
    "denoise": _denoise,
    "compressor": _compressor,
}
