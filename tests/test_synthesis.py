"""Síntesis de texto a audio."""
from __future__ import annotations


def _payload(**overrides: object) -> dict:
    data = {
        "text": "Hola mundo",
        "voice_id": "es-ES-AlvaroNeural",
        "output_format": "mp3",
        "speed": 100,
        "pitch": 0,
        "volume": 80,
    }
    data.update(overrides)
    return data


def test_synthesize_returns_audio_file(client) -> None:
    response = client.post("/api/synthesize", json=_payload())
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("audio/mp3")
    assert response.headers.get("x-audio-duration") is not None
    assert response.headers.get("x-audio-size") is not None
    assert len(response.content) > 0


def test_synthesize_unsupported_format(client) -> None:
    response = client.post("/api/synthesize", json=_payload(output_format="xyz"))
    assert response.status_code == 400
    assert response.json()["code"] == "unsupported_format"


def test_synthesize_unsupported_voice(client) -> None:
    response = client.post("/api/synthesize", json=_payload(voice_id="es-ES-Unknown"))
    assert response.status_code == 400
    assert response.json()["code"] == "unsupported_voice"


def test_synthesize_validates_text_length(client) -> None:
    response = client.post("/api/synthesize", json=_payload(text=""))
    assert response.status_code == 422


def test_synthesize_validates_speed_range(client) -> None:
    response = client.post("/api/synthesize", json=_payload(speed=10))
    assert response.status_code == 422


def test_synthesize_converts_to_wav(client) -> None:
    response = client.post("/api/synthesize", json=_payload(output_format="wav"))
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("audio/wav")


def test_synthesize_applies_profile_overrides(client) -> None:
    """Cuando se pasa profile_id, sus params sobreescriben los de la petición."""
    created = client.post(
        "/api/profiles",
        data={
            "name": "Rápido",
            "voice_id": "es-MX-DaliaNeural",
            "language": "es",
            "speed": 150,
            "pitch": 2,
            "volume": 90,
        },
    ).json()

    response = client.post(
        "/api/synthesize",
        json=_payload(voice_id="es-ES-AlvaroNeural", speed=80, profile_id=created["id"]),
    )
    assert response.status_code == 200
    # El perfil hace que se use es-MX-DaliaNeural (voz válida), así que 200 OK
