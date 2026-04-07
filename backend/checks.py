"""Startup dependency checks. Run before the app starts serving requests."""
from __future__ import annotations

import logging
import os
import shutil
from pathlib import Path

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_LOCAL_FFMPEG_BIN = _PROJECT_ROOT / "tools" / "ffmpeg" / "bin"


def check_ffmpeg() -> bool:
    """Check if ffmpeg is available. Auto-detects local install in tools/.

    If ffmpeg was installed via ``scripts/setup_ffmpeg.py``, it lives in
    ``tools/ffmpeg/bin/``. This function adds that directory to PATH so
    pydub can find it without requiring a system-wide install.

    Returns True if found, False otherwise.
    """
    # Check local install first and inject into PATH
    local_ffmpeg = _LOCAL_FFMPEG_BIN / ("ffmpeg.exe" if os.name == "nt" else "ffmpeg")
    if local_ffmpeg.exists():
        bin_dir = str(_LOCAL_FFMPEG_BIN)
        if bin_dir not in os.environ.get("PATH", ""):
            os.environ["PATH"] = bin_dir + os.pathsep + os.environ.get("PATH", "")
        logger.info("ffmpeg found (local): %s", local_ffmpeg)
        return True

    # Check system PATH
    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")

    if ffmpeg and ffprobe:
        logger.info("ffmpeg found (system): %s", ffmpeg)
        return True

    logger.warning(
        "\n"
        "========================================================\n"
        "  ffmpeg NOT FOUND\n"
        "========================================================\n"
        "  ffmpeg is required for:\n"
        "  - Audio format conversion (WAV, OGG, FLAC)\n"
        "  - Long text synthesis (multi-chunk concatenation)\n"
        "  - Voice cloning (XTTS v2)\n"
        "\n"
        "  Without it, only single-chunk MP3 will work.\n"
        "\n"
        "  Quick install:\n"
        "    python scripts/setup_ffmpeg.py\n"
        "\n"
        "  Manual install:\n"
        "    Windows:  choco install ffmpeg (admin terminal)\n"
        "    macOS:    brew install ffmpeg\n"
        "    Linux:    sudo apt install ffmpeg\n"
        "========================================================\n"
    )
    return False


def run_startup_checks() -> None:
    """Run all startup checks. Called from create_app()."""
    check_ffmpeg()
