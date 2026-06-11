"""Tests de la politica de reintento OOM (SPEC_COMFY_ENGINE §6) en JobRunner."""

from __future__ import annotations

from pathlib import Path

import pytest

from pipeline.errors import JobFailed, JobOOM, JobTimeout
from pipeline.job_runner import JobRunner, pick_main_output

from tests.conftest import FakeEngine


@pytest.fixture()
def engine(tmp_path: Path) -> FakeEngine:
    return FakeEngine(tmp_path / "ws", object_info_data={})


def test_success_first_attempt(engine: FakeEngine) -> None:
    runner = JobRunner(engine)
    result = runner.run({}, timeout_s=5.0)
    assert result.prompt_id == "prompt-1"
    assert result.timings == {"queue_s": 0.1, "exec_s": 1.5}
    assert len(engine.submitted) == 1
    assert (engine.free_vram_calls, engine.restart_calls) == (0, 0)
    assert runner.restart_count == 0


def test_oom_then_free_vram_then_success(engine: FakeEngine) -> None:
    engine.wait_script = [JobOOM("oom"), None]
    runner = JobRunner(engine)
    result = runner.run({}, timeout_s=5.0)
    assert result.prompt_id == "prompt-2"
    assert engine.free_vram_calls == 1
    assert engine.restart_calls == 0
    assert runner.restart_count == 0


def test_double_oom_restarts_then_success(engine: FakeEngine) -> None:
    engine.wait_script = [JobOOM("oom"), JobOOM("oom"), None]
    runner = JobRunner(engine)
    result = runner.run({}, timeout_s=5.0)
    assert result.prompt_id == "prompt-3"
    assert engine.free_vram_calls == 1
    assert engine.restart_calls == 1
    assert runner.restart_count == 1  # observable por el orchestrator


def test_triple_oom_is_final_failure(engine: FakeEngine) -> None:
    engine.wait_script = [JobOOM("1"), JobOOM("2"), JobOOM("3")]
    runner = JobRunner(engine)
    with pytest.raises(JobOOM):
        runner.run({}, timeout_s=5.0)
    assert len(engine.submitted) == 3  # exactamente 3 intentos, nunca mas
    assert engine.free_vram_calls == 1
    assert engine.restart_calls == 1


def test_job_failed_is_never_retried(engine: FakeEngine) -> None:
    engine.wait_script = [JobFailed("deterministic failure")]
    runner = JobRunner(engine)
    with pytest.raises(JobFailed):
        runner.run({}, timeout_s=5.0)
    assert len(engine.submitted) == 1
    assert (engine.free_vram_calls, engine.restart_calls) == (0, 0)


def test_timeout_interrupts_and_fails(engine: FakeEngine) -> None:
    engine.wait_script = [JobTimeout("hung")]
    runner = JobRunner(engine)
    with pytest.raises(JobTimeout):
        runner.run({}, timeout_s=5.0)
    assert engine.interrupt_calls == 1
    assert len(engine.submitted) == 1


def test_oom_max_retries_caps_escalation(engine: FakeEngine) -> None:
    engine.wait_script = [JobOOM("1"), JobOOM("2")]
    runner = JobRunner(engine, oom_max_retries=1)  # solo free_vram, sin restart
    with pytest.raises(JobOOM):
        runner.run({}, timeout_s=5.0)
    assert len(engine.submitted) == 2
    assert engine.free_vram_calls == 1
    assert engine.restart_calls == 0


def test_restart_count_accumulates_across_jobs(engine: FakeEngine) -> None:
    runner = JobRunner(engine)
    engine.wait_script = [JobOOM("1"), JobOOM("2"), None]
    runner.run({}, timeout_s=5.0)
    engine.wait_script = [JobOOM("1"), JobOOM("2"), None]
    runner.run({}, timeout_s=5.0)
    assert runner.restart_count == 2  # umbral de aborto del orchestrator


def test_pick_main_output_prefers_suffix(tmp_path: Path) -> None:
    outputs = [tmp_path / "preview.png", tmp_path / "clip.mp4"]
    assert pick_main_output(outputs, ".mp4") == tmp_path / "clip.mp4"
    assert pick_main_output(outputs, ".png") == tmp_path / "preview.png"
    assert pick_main_output([tmp_path / "only.webm"], ".mp4") == tmp_path / "only.webm"
