"""Persistencia de perfiles de voz en JSON.

Acceso concurrente protegido con ``asyncio.Lock``. Escritura atómica:
se escribe a un ``.tmp`` y luego ``os.replace``.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime
from pathlib import Path

from ..exceptions import ProfileNotFound
from ..paths import VOICES_DIR
from ..schemas import ProfileUpdate, VoiceProfile

logger = logging.getLogger(__name__)


class ProfileManager:
    """CRUD de perfiles de voz respaldado por un archivo JSON."""

    def __init__(self, filepath: Path) -> None:
        self._filepath = filepath
        self._profiles: dict[str, VoiceProfile] = {}
        self._lock = asyncio.Lock()
        self._load()

    # -- persistencia interna -------------------------------------------------

    def _load(self) -> None:
        if not self._filepath.exists():
            return
        try:
            raw = json.loads(self._filepath.read_text(encoding="utf-8"))
            self._profiles = {k: VoiceProfile(**v) for k, v in raw.items()}
            logger.info("Cargados %d perfiles de voz", len(self._profiles))
        except Exception as exc:  # noqa: BLE001 - arranque resiliente
            logger.error("Error cargando perfiles: %s", exc)
            self._profiles = {}

    def _write_atomic(self) -> None:
        data = {k: v.model_dump() for k, v in self._profiles.items()}
        tmp = self._filepath.with_suffix(self._filepath.suffix + ".tmp")
        tmp.write_text(
            json.dumps(data, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        os.replace(tmp, self._filepath)

    # -- API pública ---------------------------------------------------------

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
        logger.info("Perfil creado: %s (%s)", profile.name, profile.id)
        return profile

    async def update(self, profile_id: str, updates: ProfileUpdate) -> VoiceProfile:
        async with self._lock:
            profile = self._profiles.get(profile_id)
            if profile is None:
                raise ProfileNotFound(f"Perfil no encontrado: {profile_id}")
            for key, value in updates.model_dump(exclude_none=True).items():
                setattr(profile, key, value)
            profile.updated_at = datetime.now().isoformat()
            self._write_atomic()
        logger.info("Perfil actualizado: %s (%s)", profile.name, profile.id)
        return profile

    async def delete(self, profile_id: str) -> None:
        async with self._lock:
            profile = self._profiles.pop(profile_id, None)
            if profile is None:
                raise ProfileNotFound(f"Perfil no encontrado: {profile_id}")
            if profile.sample_filename:
                (VOICES_DIR / profile.sample_filename).unlink(missing_ok=True)
            self._write_atomic()
        logger.info("Perfil eliminado: %s (%s)", profile.name, profile.id)

    async def attach_sample(
        self,
        profile_id: str,
        sample_filename: str,
        sample_duration: float | None,
    ) -> VoiceProfile:
        """Asocia (o reemplaza) la muestra de audio de un perfil."""
        async with self._lock:
            profile = self._profiles.get(profile_id)
            if profile is None:
                raise ProfileNotFound(f"Perfil no encontrado: {profile_id}")
            if profile.sample_filename:
                (VOICES_DIR / profile.sample_filename).unlink(missing_ok=True)
            profile.sample_filename = sample_filename
            profile.sample_duration = sample_duration
            profile.updated_at = datetime.now().isoformat()
            self._write_atomic()
        return profile
