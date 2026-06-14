"""Runtime directories. Created on import."""
from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path

from .config import settings

DATA_DIR: Path = settings.base_dir / settings.data_subdir
VOICES_DIR: Path = DATA_DIR / "voices"
REFERENCE_VOICES_DIR: Path = VOICES_DIR / "reference"
# Cached tone-color reference clips synthesized from catalog (Edge-TTS)
# voices, so OpenVoice conversion can target a system voice (which has no
# stored audio sample). One clip per voice_id, generated on first use.
CATALOG_REFS_DIR: Path = VOICES_DIR / "catalog_refs"
PROFILES_DIR: Path = DATA_DIR / "profiles"
OUTPUT_DIR: Path = DATA_DIR / "output"
TEMP_DIR: Path = DATA_DIR / "temp"
AMBIENCE_DIR: Path = DATA_DIR / "ambience"
STUDIO_DIR: Path = DATA_DIR / "studio"
STUDIO_SUBS_DIR: Path = STUDIO_DIR / "subs"
STUDIO_VIDEOS_DIR: Path = STUDIO_DIR / "videos"
STUDIO_COVERS_DIR: Path = STUDIO_DIR / "covers"
# Media library (T2I-1 / UX-03): generated, uploaded and imported source
# images/clips plus their 256px thumbnails. Both live inside STUDIO_DIR so
# the existing ``is_within_allowed_roots`` guard already covers them.
STUDIO_MEDIA_DIR: Path = STUDIO_DIR / "media"
STUDIO_MEDIA_THUMBS_DIR: Path = STUDIO_MEDIA_DIR / "thumbs"
JOBS_DIR: Path = DATA_DIR / "jobs"

PROFILES_FILE: Path = PROFILES_DIR / "profiles.json"


def ensure_dirs() -> None:
    """Create data directories if they don't exist."""
    for d in (
        VOICES_DIR, REFERENCE_VOICES_DIR, CATALOG_REFS_DIR, PROFILES_DIR, OUTPUT_DIR,
        TEMP_DIR, AMBIENCE_DIR, STUDIO_DIR, STUDIO_SUBS_DIR, STUDIO_VIDEOS_DIR,
        STUDIO_COVERS_DIR, STUDIO_MEDIA_DIR, STUDIO_MEDIA_THUMBS_DIR,
    ):
        d.mkdir(parents=True, exist_ok=True)


# Roots that a user/client-supplied media path is allowed to point at.
# Any endpoint that takes a filesystem path from the request (Studio
# sources, ambience narration, video render inputs) must validate against
# these so a request cannot pull arbitrary files off disk through ffmpeg.
MEDIA_ROOTS: tuple[Path, ...] = (OUTPUT_DIR, STUDIO_DIR, JOBS_DIR)


def is_within_allowed_roots(target: Path, roots: Iterable[Path] = MEDIA_ROOTS) -> bool:
    """Return True if ``target`` resolves inside one of ``roots``.

    Blocks path traversal: the path is fully resolved (symlinks + ``..``)
    before the containment check, so ``data/output/../../etc/passwd`` fails.
    """
    try:
        resolved = target.resolve()
    except (OSError, RuntimeError):
        return False
    for root in roots:
        try:
            resolved.relative_to(root.resolve())
            return True
        except ValueError:
            continue
    return False


ensure_dirs()
