"""Voice profile persistence in JSON.

Concurrent access protected with ``asyncio.Lock``. Atomic writes:
data is written to a ``.tmp`` file then ``os.replace``d.

Multi-sample conditioning (VOZ-10): profiles store up to
``MAX_PROFILE_SAMPLES`` sample filenames in ``samples``. Old
``profiles.json`` files written before the migration (single
``sample_filename`` + dead ``extra_samples``) are converted to the new
shape on first load and the file is rewritten immediately, so the
migration runs exactly once.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from pathlib import Path

from ..atomic_io import write_text_atomic
from ..exceptions import InvalidSampleError, ProfileNotFound, SampleNotFound
from ..paths import VOICES_DIR
from ..schemas import MAX_PROFILE_SAMPLES, ProfileUpdate, VoiceProfile

logger = logging.getLogger(__name__)


def _migrate_profile_dict(data: dict) -> bool:
    """Convert a pre-VOZ-10 profile dict to the ``samples`` list shape.

    Mutates ``data`` in place. Returns ``True`` when a legacy shape was
    converted (the caller rewrites the file once). Already-migrated
    entries only get stray legacy keys dropped (``sample_filename`` is a
    computed serialization alias, never read back).
    """
    if "samples" in data:
        data.pop("sample_filename", None)
        data.pop("extra_samples", None)
        return False
    legacy = data.pop("sample_filename", None)
    extra = data.pop("extra_samples", None) or []
    data["samples"] = ([legacy] if legacy else []) + [s for s in extra if s]
    return True


class ProfileManager:
    """Voice profile CRUD backed by a JSON file."""

    def __init__(self, filepath: Path) -> None:
        self._filepath = filepath
        self._profiles: dict[str, VoiceProfile] = {}
        self._lock = asyncio.Lock()
        self._load()

    # -- internal persistence --------------------------------------------------

    def _load(self) -> None:
        if not self._filepath.exists():
            return
        try:
            raw = json.loads(self._filepath.read_text(encoding="utf-8"))
            migrated = False
            for data in raw.values():
                migrated = _migrate_profile_dict(data) or migrated
            self._profiles = {k: VoiceProfile(**v) for k, v in raw.items()}
            logger.info("Loaded %d voice profiles", len(self._profiles))
            if migrated:
                self._write_atomic()
                logger.info(
                    "Migrated profiles.json to the multi-sample shape (VOZ-10)"
                )
        except Exception as exc:  # noqa: BLE001 - resilient startup
            logger.error("Error loading profiles: %s", exc)
            self._profiles = {}

    def _write_atomic(self) -> None:
        # ``sample_filename`` is a computed back-compat alias for HTTP
        # responses only — the persisted shape is ``samples``.
        data = {
            k: v.model_dump(exclude={"sample_filename"})
            for k, v in self._profiles.items()
        }
        write_text_atomic(
            self._filepath, json.dumps(data, indent=2, ensure_ascii=False)
        )

    # -- public API ------------------------------------------------------------

    @property
    def count(self) -> int:
        return len(self._profiles)

    def list_all(self) -> list[VoiceProfile]:
        return list(self._profiles.values())

    def get(self, profile_id: str) -> VoiceProfile | None:
        return self._profiles.get(profile_id)

    async def create(self, profile: VoiceProfile) -> VoiceProfile:
        async with self._lock:
            self._profiles[profile.id] = profile
            self._write_atomic()
        logger.info("Profile created: %s (%s)", profile.name, profile.id)
        return profile

    async def update(self, profile_id: str, updates: ProfileUpdate) -> VoiceProfile:
        async with self._lock:
            profile = self._profiles.get(profile_id)
            if profile is None:
                raise ProfileNotFound(f"Profile not found: {profile_id}")
            for key, value in updates.model_dump(exclude_none=True).items():
                setattr(profile, key, value)
            profile.updated_at = datetime.now().isoformat()
            self._write_atomic()
        logger.info("Profile updated: %s (%s)", profile.name, profile.id)
        return profile

    async def delete(self, profile_id: str) -> None:
        async with self._lock:
            profile = self._profiles.pop(profile_id, None)
            if profile is None:
                raise ProfileNotFound(f"Profile not found: {profile_id}")
            for sample in profile.samples:
                (VOICES_DIR / sample).unlink(missing_ok=True)
            self._write_atomic()
        logger.info("Profile deleted: %s (%s)", profile.name, profile.id)

    async def add_sample(
        self,
        profile_id: str,
        sample_filename: str,
        sample_duration: float | None,
    ) -> VoiceProfile:
        """Append a stored sample to a profile's conditioning set.

        Raises ``InvalidSampleError`` when the profile already holds
        ``MAX_PROFILE_SAMPLES`` samples — the caller is responsible for
        removing the orphaned file from disk in that case.
        """
        async with self._lock:
            profile = self._profiles.get(profile_id)
            if profile is None:
                raise ProfileNotFound(f"Profile not found: {profile_id}")
            if len(profile.samples) >= MAX_PROFILE_SAMPLES:
                raise InvalidSampleError(
                    f"Profile already has the maximum of {MAX_PROFILE_SAMPLES} "
                    "samples. Remove one before adding another."
                )
            profile.samples.append(sample_filename)
            if len(profile.samples) == 1:
                profile.sample_duration = sample_duration
            profile.updated_at = datetime.now().isoformat()
            self._write_atomic()
        logger.info(
            "Sample %s attached to profile %s (%d/%d)",
            sample_filename, profile_id, len(profile.samples), MAX_PROFILE_SAMPLES,
        )
        return profile

    async def remove_sample(self, profile_id: str, sample_filename: str) -> VoiceProfile:
        """Detach a sample from a profile and delete its file from disk."""
        async with self._lock:
            profile = self._profiles.get(profile_id)
            if profile is None:
                raise ProfileNotFound(f"Profile not found: {profile_id}")
            if sample_filename not in profile.samples:
                raise SampleNotFound(
                    f"Sample not attached to profile: {sample_filename}"
                )
            was_first = profile.samples[0] == sample_filename
            profile.samples.remove(sample_filename)
            (VOICES_DIR / sample_filename).unlink(missing_ok=True)
            if was_first:
                # The new first sample's duration is unknown.
                profile.sample_duration = None
            profile.updated_at = datetime.now().isoformat()
            self._write_atomic()
        logger.info("Sample %s removed from profile %s", sample_filename, profile_id)
        return profile
