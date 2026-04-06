"""Voice catalog endpoints."""
from __future__ import annotations


def test_list_curated_voices(client) -> None:
    response = client.get("/api/voices")
    assert response.status_code == 200
    body = response.json()
    assert "es" in body and "en" in body
    alvaro = body["es"]["es-ES-AlvaroNeural"]
    assert alvaro["gender"] == "M"
    assert alvaro["accent"] == "España"


def test_discover_all_voices(client) -> None:
    response = client.get("/api/voices/all")
    assert response.status_code == 200
    body = response.json()
    assert {"es", "en"} <= set(body.keys())
    # El stub de edge_tts devuelve 1 voz por idioma
    assert any(v["id"] == "es-ES-AlvaroNeural" for v in body["es"])


def test_get_missing_sample_returns_404(client) -> None:
    response = client.get("/api/voices/samples/nonexistent.wav")
    assert response.status_code == 404
    assert response.json()["code"] == "sample_not_found"
