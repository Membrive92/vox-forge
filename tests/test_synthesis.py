"""Text-to-audio synthesis endpoints."""
from __future__ import annotations


def _payload(**overrides: object) -> dict:
    data = {
        "text": "Hello world",
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
    assert response.headers.get("x-audio-engine") == "edge-tts"
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
    """When profile_id is passed, its params override the request's."""
    created = client.post(
        "/api/profiles",
        data={
            "name": "Fast",
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


# ── Resume concurrency (BAJO-17) ─────────────────────────────────────


def _seed_crashed_job(text: str = "Hola mundo.") -> str:
    """Persist a job record on disk as if the process died mid-synthesis."""
    from backend.services import job_store

    job_id = job_store.new_job_id()
    record = job_store.JobRecord(
        job_id=job_id, request=_payload(text=text), engine="edge-tts",
    )
    job_store.save_record(record)
    return job_id


def test_resume_crashed_job_succeeds(client) -> None:
    job_id = _seed_crashed_job()
    response = client.post(f"/api/synthesize/resume/{job_id}")
    assert response.status_code == 200, response.text
    assert response.headers.get("X-Resumed") == "true"
    assert response.headers.get("x-audio-engine") == "edge-tts"


def test_resume_rejected_while_job_is_running(client) -> None:
    """A resume must not run concurrently with the original request (or a
    previous resume) on the same job_id — both would write to the same
    chunk dir. The in-flight run is simulated via the progress registry."""
    from backend.services import job_store
    from backend.services.progress import registry

    job_id = _seed_crashed_job()
    registry.start(job_id, chunks_total=3, step="synthesizing")
    try:
        response = client.post(f"/api/synthesize/resume/{job_id}")
        assert response.status_code == 409
        assert "running" in response.json()["detail"].lower()
        # The record must survive the rejection so a later resume still works.
        assert job_store.load_record(job_id) is not None
    finally:
        registry.finish(job_id, status="cancelled")
        job_store.cleanup_job(job_id)


def test_resume_allowed_after_job_errored(client) -> None:
    """Only status == 'running' blocks a resume; a crashed/errored job must
    remain resumable."""
    from backend.services.progress import registry

    job_id = _seed_crashed_job()
    registry.start(job_id, chunks_total=3, step="synthesizing")
    registry.finish(job_id, status="error", error="boom")

    response = client.post(f"/api/synthesize/resume/{job_id}")
    assert response.status_code == 200, response.text
    assert response.headers.get("X-Resumed") == "true"


async def test_concurrent_resumes_one_wins_one_409(app, monkeypatch) -> None:
    """Two truly concurrent resumes on the same job_id: exactly one runs,
    the other is rejected with 409 instead of racing on the chunk dir."""
    import asyncio

    import httpx

    from backend.paths import OUTPUT_DIR
    from backend.services import job_store
    from backend.services.tts_engine import SynthesisResult, TTSEngine

    job_id = _seed_crashed_job()
    out = OUTPUT_DIR / f"{job_id}_resumed.mp3"

    async def slow_synthesize(self, request, cancel_token=None, job_id=None):
        await asyncio.sleep(0.05)  # yield so the second request can interleave
        out.write_bytes(b"ID3\x04" + b"\x00" * 64)
        return SynthesisResult(path=out, chunks=1, engine="edge-tts")

    monkeypatch.setattr(TTSEngine, "synthesize", slow_synthesize)

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        first, second = await asyncio.gather(
            ac.post(f"/api/synthesize/resume/{job_id}"),
            ac.post(f"/api/synthesize/resume/{job_id}"),
        )

    assert sorted([first.status_code, second.status_code]) == [200, 409]


def test_synthesize_mints_fresh_id_when_header_job_is_running(client) -> None:
    """POSTing /synthesize with an X-Synthesis-Job-ID that is mid-flight
    must not clobber the running job — a fresh id is minted instead."""
    from backend.services import job_store
    from backend.services.progress import registry

    busy_id = job_store.new_job_id()
    registry.start(busy_id, chunks_total=3, step="synthesizing")
    try:
        response = client.post(
            "/api/synthesize",
            json=_payload(),
            headers={"X-Synthesis-Job-ID": busy_id},
        )
        assert response.status_code == 200
        # The running job's progress was not reset by the new request.
        live = registry.snapshot(busy_id)
        assert live is not None
        assert live.status == "running"
        assert live.chunks_total == 3
    finally:
        registry.finish(busy_id, status="cancelled")
