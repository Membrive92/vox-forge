"""Health check: smoke test del wiring completo."""
from __future__ import annotations


def test_health_returns_service_info(client) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "healthy"
    assert body["version"]
    assert body["profiles_count"] == 0
    assert body["voices"]["es"] > 0
    assert body["voices"]["en"] > 0
    assert "mp3" in body["formats"]
