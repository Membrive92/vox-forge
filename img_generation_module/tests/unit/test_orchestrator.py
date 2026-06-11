"""Tests de run_episode: fases, idempotencia, politica de fallo y aborto."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from pipeline import orchestrator
from pipeline.errors import JobFailed, JobOOM, ManifestError
from pipeline.orchestrator import Summary, format_summary, run_episode

from tests.conftest import FakeEngine

MANIFEST = {
    "schema": 1,
    "episode": "e01",
    "defaults": {"image_suffix": ", dense fog", "motion_suffix": ", static camera"},
    "scenes": [
        {"id": "s01", "image_prompt": "the tower", "motion_prompt": "fog rolling"},
        {"id": "s02", "image_prompt": "the iron door", "motion_prompt": "push-in", "seed": 4471},
        {"id": "s03", "image_prompt": "the staircase", "motion_prompt": "flickering torch"},
    ],
}


@pytest.fixture()
def episode_setup(pipeline_cfg, fake_engine: FakeEngine):
    """Manifest en assets/e01 + factory que inyecta el FakeEngine."""
    manifest_path = pipeline_cfg.paths.assets / "e01" / "manifest.json"
    manifest_path.parent.mkdir(parents=True)
    manifest_path.write_text(json.dumps(MANIFEST), encoding="utf-8")
    return pipeline_cfg, fake_engine, lambda engine_cfg: fake_engine


def _run(setup, phase: str = "images", only: set[str] | None = None, force: bool = False) -> Summary:
    cfg, _, factory = setup
    return run_episode("e01", phase, only, force, cfg, engine_factory=factory)


def _statuses(summary: Summary) -> list[tuple[str, str, str]]:
    return [(outcome.scene_id, outcome.kind, outcome.status) for outcome in summary.outcomes]


# ----------------------------------------------------------------- happy path


def test_images_phase_generates_all_scenes(episode_setup) -> None:
    summary = _run(episode_setup, phase="images")
    assert _statuses(summary) == [("s01", "image", "DONE"), ("s02", "image", "DONE"), ("s03", "image", "DONE")]
    assert summary.exit_code == 0
    cfg, engine, _ = episode_setup
    assert (cfg.paths.assets / "e01" / "images" / "e01_s02.png").is_file()
    assert engine.start_calls == 1
    assert engine.stop_calls == 1  # ciclo de vida: stop en finally


def test_all_phase_runs_images_strictly_before_videos(episode_setup) -> None:
    summary = _run(episode_setup, phase="all")
    kinds = [outcome.kind for outcome in summary.outcomes]
    assert kinds == ["image"] * 3 + ["video"] * 3  # orden estricto por modalidad
    assert summary.exit_code == 0
    cfg, _, _ = episode_setup
    assert (cfg.paths.assets / "e01" / "clips" / "e01_s03.mp4").is_file()


def test_all_skip_fast_path(episode_setup) -> None:
    _run(episode_setup, phase="all")
    cfg, engine, _ = episode_setup
    submits_after_first = len(engine.submitted)

    summary = _run(episode_setup, phase="all")
    assert all(outcome.status == "SKIPPED" for outcome in summary.outcomes)
    assert summary.exit_code == 0
    assert len(engine.submitted) == submits_after_first  # ni un submit mas


def test_only_filters_scenes_and_force_regenerates(episode_setup) -> None:
    _run(episode_setup, phase="images")
    cfg, engine, _ = episode_setup
    before = len(engine.submitted)

    summary = _run(episode_setup, phase="images", only={"s02"}, force=True)
    assert _statuses(summary) == [("s02", "image", "DONE")]
    assert len(engine.submitted) == before + 1  # exactamente una escena regenerada


def test_only_with_unknown_scene_fails_loud(episode_setup) -> None:
    with pytest.raises(ManifestError, match="s99"):
        _run(episode_setup, phase="images", only={"s99"})


# -------------------------------------------------------------- fallo parcial


def test_one_failure_does_not_abort_episode(episode_setup) -> None:
    _, engine, _ = episode_setup
    engine.wait_script = [JobFailed("graph error"), None, None]
    summary = _run(episode_setup, phase="images")
    assert _statuses(summary) == [
        ("s01", "image", "FAILED"),
        ("s02", "image", "DONE"),
        ("s03", "image", "DONE"),
    ]
    assert summary.aborted is False
    assert summary.exit_code == 1
    assert "graph error" in summary.outcomes[0].message


def test_final_oom_is_reported_as_failed_oom(episode_setup) -> None:
    _, engine, _ = episode_setup
    engine.wait_script = [JobOOM("1"), JobOOM("2"), JobOOM("3"), None, None]
    summary = _run(episode_setup, phase="images")
    assert summary.outcomes[0].status == "FAILED_OOM"
    assert summary.outcomes[1].status == "DONE"
    assert summary.exit_code == 1


# ------------------------------------------------------------------ videos


def test_videos_without_stills_fail_with_actionable_message(episode_setup) -> None:
    summary = _run(episode_setup, phase="videos")
    assert all(outcome.status == "FAILED" for outcome in summary.outcomes)
    assert all("ejecuta primero --phase images" in outcome.message for outcome in summary.outcomes)
    assert summary.exit_code == 1
    _, engine, _ = episode_setup
    assert engine.submitted == []  # sin tocar el motor
    assert engine.uploads == []


def test_videos_phase_after_images_succeeds(episode_setup) -> None:
    _run(episode_setup, phase="images")
    summary = _run(episode_setup, phase="videos")
    assert [outcome.status for outcome in summary.outcomes] == ["DONE", "DONE", "DONE"]


# ------------------------------------------------------------------- aborto


def test_two_engine_restarts_abort_the_run(episode_setup) -> None:
    _, engine, _ = episode_setup
    # s01: OOM, OOM -> restart 1 -> DONE. s02: OOM, OOM -> restart 2 -> DONE.
    engine.wait_script = [JobOOM("1"), JobOOM("2"), None, JobOOM("3"), JobOOM("4"), None]
    summary = _run(episode_setup, phase="images")

    assert summary.aborted is True
    assert "restarted" in summary.abort_reason
    assert _statuses(summary) == [
        ("s01", "image", "DONE"),
        ("s02", "image", "DONE"),
        ("s03", "image", "FAILED"),  # no ejecutada: el run se aborto
    ]
    assert "not run" in summary.outcomes[2].message
    assert summary.exit_code == 1
    assert engine.restart_calls == 2
    assert len(engine.submitted) == 6  # s03 nunca llego a submit
    assert engine.stop_calls == 1  # stop en finally tambien al abortar


def test_engine_start_error_aborts_everything(episode_setup) -> None:
    from pipeline.errors import EngineStartError

    cfg, _, _ = episode_setup

    class DeadEngine(FakeEngine):
        def start(self) -> None:
            raise EngineStartError("port busy")

    dead = DeadEngine(cfg.engine.workspace)
    summary = run_episode("e01", "images", None, False, cfg, engine_factory=lambda engine_cfg: dead)
    assert summary.aborted is True
    assert "port busy" in summary.abort_reason
    assert summary.outcomes == ()
    assert summary.exit_code == 1


# ------------------------------------------------------------------ manifest


def test_missing_manifest_raises(pipeline_cfg, fake_engine: FakeEngine) -> None:
    with pytest.raises(ManifestError, match="not found"):
        run_episode("e09", "images", None, False, pipeline_cfg, engine_factory=lambda c: fake_engine)
    assert fake_engine.start_calls == 0  # el manifest se valida antes de arrancar nada


def test_manifest_episode_mismatch_raises(episode_setup) -> None:
    cfg, engine, factory = episode_setup
    other = cfg.paths.assets / "e02"
    other.mkdir(parents=True)
    (other / "manifest.json").write_text(json.dumps(MANIFEST), encoding="utf-8")  # dice e01
    with pytest.raises(ManifestError, match="declares episode 'e01'"):
        run_episode("e02", "images", None, False, cfg, engine_factory=factory)


# ------------------------------------------------------------------- summary


def test_format_summary_renders_table_and_totals(episode_setup) -> None:
    _, engine, _ = episode_setup
    engine.wait_script = [JobFailed("boom"), None, None]
    summary = _run(episode_setup, phase="images")
    text = format_summary(summary)
    assert "scene" in text and "status" in text and "duration" in text and "path" in text
    assert "FAILED" in text and "DONE" in text
    assert "1 failed" in text and "2 done" in text


def test_format_summary_empty_outcomes() -> None:
    text = format_summary(Summary(episode="e01", outcomes=(), aborted=True, abort_reason="engine down"))
    assert "ABORTED: engine down" in text
