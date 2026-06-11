"""Tests de pipeline.errors: clasificacion de execution_error (SPEC_COMFY_ENGINE §6)."""

from __future__ import annotations

import pytest

from pipeline.errors import (
    JobFailed,
    JobOOM,
    PipelineError,
    classify_execution_error,
)


def test_classify_oom_by_exception_type() -> None:
    err = classify_execution_error(
        {"exception_type": "torch.cuda.OutOfMemoryError", "exception_message": "CUDA out of memory"}
    )
    assert isinstance(err, JobOOM)


def test_classify_oom_by_allocation_on_device_case_insensitive() -> None:
    err = classify_execution_error(
        {"exception_type": "RuntimeError", "exception_message": "ALLOCATION ON DEVICE 0 would exceed allowed memory"}
    )
    assert isinstance(err, JobOOM)


def test_classify_oom_substring_in_message() -> None:
    err = classify_execution_error({"exception_message": "got outofmemory while decoding"})
    assert isinstance(err, JobOOM)


def test_classify_non_oom_is_job_failed() -> None:
    err = classify_execution_error(
        {"exception_type": "ValueError", "exception_message": "tensor shape mismatch"}
    )
    assert isinstance(err, JobFailed)
    assert not isinstance(err, JobOOM)


def test_classify_empty_payload_is_job_failed() -> None:
    assert isinstance(classify_execution_error({}), JobFailed)


def test_classify_preserves_payload_in_message() -> None:
    payload = {
        "node_id": "20",
        "node_type": "KSamplerAdvanced",
        "exception_type": "ValueError",
        "exception_message": "tensor shape mismatch",
        "traceback": ["line1", "line2"],
    }
    err = classify_execution_error(payload)
    # El payload entero se conserva para el log y el resumen.
    assert "tensor shape mismatch" in str(err)
    assert "KSamplerAdvanced" in str(err)


def test_exceptions_share_pipeline_base() -> None:
    assert issubclass(JobOOM, PipelineError)
    assert issubclass(JobFailed, PipelineError)
    with pytest.raises(PipelineError):
        raise JobOOM("boom")
