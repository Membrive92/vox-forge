"""Runtime directories. Created on import."""
from __future__ import annotations

from pathlib import Path

from .config import settings

DATA_DIR: Path = settings.base_dir / settings.data_subdir
VOICES_DIR: Path = DATA_DIR / "voices"
PROFILES_DIR: Path = DATA_DIR / "profiles"
OUTPUT_DIR: Path = DATA_DIR / "output"
TEMP_DIR: Path = DATA_DIR / "temp"
AMBIENCE_DIR: Path = DATA_DIR / "ambience"
STUDIO_DIR: Path = DATA_DIR / "studio"
STUDIO_SUBS_DIR: Path = STUDIO_DIR / "subs"
STUDIO_VIDEOS_DIR: Path = STUDIO_DIR / "videos"
STUDIO_COVERS_DIR: Path = STUDIO_DIR / "covers"
JOBS_DIR: Path = DATA_DIR / "jobs"

PROFILES_FILE: Path = PROFILES_DIR / "profiles.json"


def ensure_dirs() -> None:
    """Create data directories if they don't exist."""
    for d in (
        VOICES_DIR, PROFILES_DIR, OUTPUT_DIR, TEMP_DIR, AMBIENCE_DIR,
        STUDIO_DIR, STUDIO_SUBS_DIR, STUDIO_VIDEOS_DIR, STUDIO_COVERS_DIR,
    ):
        d.mkdir(parents=True, exist_ok=True)


ensure_dirs()
