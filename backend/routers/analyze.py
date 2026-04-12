"""Voice sample quality analysis endpoint."""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, File, UploadFile
from pydub import AudioSegment

from ..upload_utils import read_upload_safely, validate_audio_upload

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/analyze", tags=["analyze"])


@router.post("/sample", summary="Analyze voice sample quality")
async def analyze_sample(audio: UploadFile = File(...)) -> dict:
    """Return quality metrics for a voice sample.

    Checks: duration, SNR estimate, clipping ratio, silence ratio,
    peak level, RMS level, and an overall quality rating.
    """
    validate_audio_upload(audio)
    content = await read_upload_safely(audio)

    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
        tf.write(content)
        tmp_path = Path(tf.name)

    try:
        seg = AudioSegment.from_file(str(tmp_path))
    except Exception as exc:
        tmp_path.unlink(missing_ok=True)
        from fastapi import HTTPException
        raise HTTPException(
            status_code=400,
            detail=f"Could not read audio file. It may be corrupted or in an unsupported format. ({exc})",
        ) from exc

    try:
        duration_s = len(seg) / 1000.0
        sample_rate = seg.frame_rate
        channels = seg.channels
        samples = seg.get_array_of_samples()
        peak = max(abs(s) for s in samples) if samples else 0
        max_val = 2 ** (seg.sample_width * 8 - 1)

        # Clipping: samples at or near max value
        clip_threshold = max_val * 0.99
        clipped = sum(1 for s in samples if abs(s) >= clip_threshold)
        clip_ratio = clipped / len(samples) if samples else 0

        # RMS and peak in dBFS
        rms_db = seg.rms
        peak_db = seg.max_dBFS

        # Silence analysis (windows below -40dBFS)
        window_ms = 50
        total_windows = 0
        silent_windows = 0
        for i in range(0, len(seg) - window_ms, window_ms):
            w = seg[i: i + window_ms]
            total_windows += 1
            if w.dBFS < -40:
                silent_windows += 1
        silence_ratio = silent_windows / total_windows if total_windows > 0 else 0

        # SNR estimate: RMS of loudest 50% vs RMS of quietest 25%
        window_energies: list[float] = []
        for i in range(0, len(seg) - window_ms, window_ms):
            w = seg[i: i + window_ms]
            window_energies.append(w.rms)

        if window_energies:
            sorted_e = sorted(window_energies)
            n = len(sorted_e)
            noise_rms = sum(sorted_e[: n // 4]) / max(1, n // 4)
            signal_rms = sum(sorted_e[n // 2:]) / max(1, n - n // 2)
            import math
            snr_db = 20 * math.log10(signal_rms / max(noise_rms, 1)) if noise_rms > 0 else 60.0
        else:
            snr_db = 0.0

        # Quality rating
        issues: list[str] = []
        if duration_s < 6:
            issues.append("Too short (min 6s recommended)")
        if duration_s > 30:
            issues.append("Very long (6-15s is optimal)")
        if clip_ratio > 0.001:
            issues.append(f"Clipping detected ({clip_ratio * 100:.2f}%)")
        if snr_db < 15:
            issues.append(f"Low SNR ({snr_db:.1f}dB — noisy)")
        if silence_ratio > 0.5:
            issues.append(f"Too much silence ({silence_ratio * 100:.0f}%)")
        if peak_db < -20:
            issues.append(f"Very quiet (peak {peak_db:.1f}dBFS)")

        if not issues:
            rating = "excellent"
        elif len(issues) <= 1:
            rating = "good"
        elif len(issues) <= 2:
            rating = "fair"
        else:
            rating = "poor"

        return {
            "duration_s": round(duration_s, 2),
            "sample_rate": sample_rate,
            "channels": channels,
            "peak_dbfs": round(peak_db, 1),
            "rms": rms_db,
            "snr_db": round(snr_db, 1),
            "clip_ratio": round(clip_ratio, 5),
            "silence_ratio": round(silence_ratio, 3),
            "rating": rating,
            "issues": issues,
        }
    finally:
        tmp_path.unlink(missing_ok=True)
