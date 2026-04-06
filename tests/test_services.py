"""Unit tests for services: ProfileManager and TTSEngine helpers."""
from __future__ import annotations

import json

import pytest


# --- ProfileManager: persistence, lock, atomic writes --------

@pytest.fixture()
def pm(_session_env):
    """Fresh ProfileManager with temporary file."""
    from backend.services.profile_manager import ProfileManager
    from backend.paths import PROFILES_DIR

    filepath = PROFILES_DIR / "test_profiles.json"
    filepath.unlink(missing_ok=True)
    manager = ProfileManager(filepath)
    yield manager
    filepath.unlink(missing_ok=True)


@pytest.mark.asyncio
async def test_create_persists_to_disk(pm) -> None:
    from backend.schemas import VoiceProfile

    profile = VoiceProfile(name="Test", voice_id="es-ES-AlvaroNeural")
    created = await pm.create(profile)
    assert created.name == "Test"

    raw = json.loads(pm._filepath.read_text(encoding="utf-8"))
    assert created.id in raw
    assert raw[created.id]["name"] == "Test"


@pytest.mark.asyncio
async def test_update_changes_fields_and_updated_at(pm) -> None:
    from backend.schemas import ProfileUpdate, VoiceProfile

    profile = VoiceProfile(name="Original", voice_id="es-ES-AlvaroNeural", speed=100)
    created = await pm.create(profile)
    original_updated = created.updated_at

    updated = await pm.update(created.id, ProfileUpdate(speed=150, name="Renamed"))
    assert updated.speed == 150
    assert updated.name == "Renamed"
    assert updated.voice_id == "es-ES-AlvaroNeural"  # sin cambio
    assert updated.updated_at >= original_updated


@pytest.mark.asyncio
async def test_update_nonexistent_raises(pm) -> None:
    from backend.exceptions import ProfileNotFound
    from backend.schemas import ProfileUpdate

    with pytest.raises(ProfileNotFound):
        await pm.update("ghost", ProfileUpdate(name="X"))


@pytest.mark.asyncio
async def test_delete_removes_from_disk(pm) -> None:
    from backend.schemas import VoiceProfile

    profile = VoiceProfile(name="ToDelete", voice_id="es-ES-AlvaroNeural")
    created = await pm.create(profile)
    await pm.delete(created.id)

    raw = json.loads(pm._filepath.read_text(encoding="utf-8"))
    assert created.id not in raw


@pytest.mark.asyncio
async def test_delete_nonexistent_raises(pm) -> None:
    from backend.exceptions import ProfileNotFound

    with pytest.raises(ProfileNotFound):
        await pm.delete("ghost")


@pytest.mark.asyncio
async def test_attach_sample_replaces_old(pm, tmp_path) -> None:
    from backend.schemas import VoiceProfile
    from backend.paths import VOICES_DIR

    old_sample = VOICES_DIR / "old.wav"
    old_sample.write_bytes(b"fake")

    profile = VoiceProfile(
        name="WithSample",
        voice_id="es-ES-AlvaroNeural",
        sample_filename="old.wav",
        sample_duration=5.0,
    )
    created = await pm.create(profile)

    updated = await pm.attach_sample(created.id, "new.wav", 10.0)
    assert updated.sample_filename == "new.wav"
    assert updated.sample_duration == 10.0
    assert not old_sample.exists()  # viejo borrado


def test_load_existing_file(tmp_path) -> None:
    """ProfileManager loads existing data from disk."""
    from backend.services.profile_manager import ProfileManager

    filepath = tmp_path / "profiles.json"
    data = {
        "abc": {
            "id": "abc",
            "name": "Preexisting",
            "voice_id": "es-ES-AlvaroNeural",
            "language": "es",
            "speed": 100,
            "pitch": 0,
            "volume": 80,
            "sample_filename": None,
            "sample_duration": None,
            "created_at": "2025-01-01T00:00:00",
            "updated_at": "2025-01-01T00:00:00",
        }
    }
    filepath.write_text(json.dumps(data), encoding="utf-8")

    pm = ProfileManager(filepath)
    assert pm.count == 1
    assert pm.get("abc") is not None
    assert pm.get("abc").name == "Preexisting"


def test_load_corrupt_file_recovers(tmp_path) -> None:
    from backend.services.profile_manager import ProfileManager

    filepath = tmp_path / "profiles.json"
    filepath.write_text("not json!!", encoding="utf-8")

    pm = ProfileManager(filepath)
    assert pm.count == 0


# --- TTSEngine helpers: rate, pitch, volume strings ---

def test_rate_string() -> None:
    from backend.services.tts_engine import _rate_str

    assert _rate_str(100) == "+0%"
    assert _rate_str(150) == "+50%"
    assert _rate_str(70) == "-30%"


def test_pitch_string() -> None:
    from backend.services.tts_engine import _pitch_str

    assert _pitch_str(0) == "+0Hz"
    assert _pitch_str(3) == "+48Hz"
    assert _pitch_str(-5) == "-80Hz"


def test_volume_string() -> None:
    from backend.services.tts_engine import _volume_str

    assert _volume_str(100) == "+0%"
    assert _volume_str(80) == "-20%"
    assert _volume_str(50) == "-50%"


# --- Catalogs ---

def test_all_voice_ids() -> None:
    from backend.catalogs import all_voice_ids

    ids = all_voice_ids()
    assert "es-ES-AlvaroNeural" in ids
    assert "en-US-JennyNeural" in ids
    assert len(ids) == 12
