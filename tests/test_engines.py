"""Tests for ``POST /api/engines/unload`` (PROD-01).

The endpoint frees VRAM for external GPU processes (ComfyUI): it must
unload whichever engines hold a resident model, report exactly what it
released, and never unload while an inference holds the GPU semaphore.
Engines are stubbed — no real model is ever loaded.

``backend`` is imported inside each test (never at module level) so
collection cannot import the real torch/pydub before the conftest
stubs are installed.
"""
from __future__ import annotations

import asyncio

import httpx


class _StubCloneEngine:
    """Stands in for the lazy ``CloneEngine`` held by ``TTSEngine``."""

    def __init__(self, loaded: bool = True) -> None:
        self._loaded = loaded
        self.unload_calls = 0

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    def unload_model(self) -> None:
        self.unload_calls += 1
        self._loaded = False


def test_unload_reports_resident_engines(client, monkeypatch):
    from backend import dependencies

    tts = dependencies.get_tts_engine()
    convert = dependencies.get_convert_engine()
    clone_stub = _StubCloneEngine(loaded=True)
    monkeypatch.setattr(tts, "_clone_engine", clone_stub)
    monkeypatch.setattr(convert, "_converter", object())

    resp = client.post("/api/engines/unload")

    assert resp.status_code == 200
    body = resp.json()
    assert body["unloaded"] == ["xtts", "openvoice"]
    # conftest stubs torch with cuda.is_available() == False.
    assert body["cuda_cache_cleared"] is False
    assert clone_stub.unload_calls == 1
    assert convert._converter is None  # noqa: SLF001


def test_unload_with_nothing_loaded_is_a_noop(client):
    resp = client.post("/api/engines/unload")

    assert resp.status_code == 200
    assert resp.json()["unloaded"] == []


def test_unload_skips_instantiated_but_unloaded_clone_engine(client, monkeypatch):
    """A lazily created clone engine whose model was already released
    must not be re-unloaded nor reported."""
    from backend import dependencies

    tts = dependencies.get_tts_engine()
    clone_stub = _StubCloneEngine(loaded=False)
    monkeypatch.setattr(tts, "_clone_engine", clone_stub)

    resp = client.post("/api/engines/unload")

    assert resp.status_code == 200
    assert resp.json()["unloaded"] == []
    assert clone_stub.unload_calls == 0


async def test_unload_waits_for_gpu_semaphore(app, monkeypatch):
    """While an inference holds the GPU semaphore the unload must block;
    it completes as soon as the semaphore is released."""
    from backend.services import engine_unload

    # Fresh semaphore so this test never binds the shared global to a
    # per-test event loop (asyncio primitives latch the loop on first
    # contended acquire).
    sem = asyncio.Semaphore(1)
    monkeypatch.setattr(engine_unload, "gpu_semaphore", sem)

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        async with sem:
            task = asyncio.create_task(ac.post("/api/engines/unload"))
            done, _ = await asyncio.wait({task}, timeout=0.2)
            assert not done, "unload must wait for the GPU semaphore"
        resp = await task

    assert resp.status_code == 200
    assert resp.json()["unloaded"] == []
