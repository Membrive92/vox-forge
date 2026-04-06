"""CRUD de perfiles de voz."""
from __future__ import annotations


def _create_profile(client, **overrides: object) -> dict:
    data = {
        "name": "Narrador",
        "voice_id": "es-ES-AlvaroNeural",
        "language": "es",
        "speed": 90,
        "pitch": -1,
        "volume": 80,
    }
    data.update(overrides)
    response = client.post("/api/profiles", data=data)
    assert response.status_code == 200, response.text
    return response.json()


def test_list_profiles_empty(client) -> None:
    response = client.get("/api/profiles")
    assert response.status_code == 200
    assert response.json() == []


def test_create_and_get_profile(client) -> None:
    created = _create_profile(client)
    assert created["name"] == "Narrador"
    assert created["voice_id"] == "es-ES-AlvaroNeural"
    assert created["speed"] == 90
    assert created["id"]

    got = client.get(f"/api/profiles/{created['id']}")
    assert got.status_code == 200
    assert got.json()["id"] == created["id"]


def test_get_missing_profile_returns_404(client) -> None:
    response = client.get("/api/profiles/does-not-exist")
    assert response.status_code == 404
    assert response.json()["code"] == "profile_not_found"


def test_update_profile(client) -> None:
    created = _create_profile(client)
    response = client.patch(
        f"/api/profiles/{created['id']}",
        json={"name": "Renombrado", "speed": 120},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Renombrado"
    assert body["speed"] == 120
    # Campos no tocados se preservan
    assert body["voice_id"] == "es-ES-AlvaroNeural"
    assert body["pitch"] == -1


def test_update_missing_profile_returns_404(client) -> None:
    response = client.patch("/api/profiles/ghost", json={"speed": 100})
    assert response.status_code == 404


def test_update_rejects_out_of_range_speed(client) -> None:
    created = _create_profile(client)
    response = client.patch(
        f"/api/profiles/{created['id']}",
        json={"speed": 999},
    )
    assert response.status_code == 422


def test_delete_profile(client) -> None:
    created = _create_profile(client)
    response = client.delete(f"/api/profiles/{created['id']}")
    assert response.status_code == 200
    assert response.json() == {"status": "deleted", "id": created["id"]}

    # Idempotencia: segunda llamada es 404
    response = client.delete(f"/api/profiles/{created['id']}")
    assert response.status_code == 404


def test_list_reflects_creation(client) -> None:
    _create_profile(client, name="Uno")
    _create_profile(client, name="Dos")
    response = client.get("/api/profiles")
    assert response.status_code == 200
    names = {p["name"] for p in response.json()}
    assert names == {"Uno", "Dos"}
