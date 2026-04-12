"""Domain exceptions and their HTTP translations.

Services raise these exceptions; routers don't catch them manually.
A global handler converts them into structured HTTP responses.
"""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


class DomainError(Exception):
    """Root of the domain exception hierarchy."""

    status_code: int = 500
    code: str = "domain_error"

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class ProfileNotFound(DomainError):
    status_code = 404
    code = "profile_not_found"


class UnsupportedVoiceError(DomainError):
    status_code = 400
    code = "unsupported_voice"


class UnsupportedFormatError(DomainError):
    status_code = 400
    code = "unsupported_format"


class InvalidSampleError(DomainError):
    status_code = 400
    code = "invalid_sample"


class SampleNotFound(DomainError):
    status_code = 404
    code = "sample_not_found"


class SynthesisError(DomainError):
    status_code = 500
    code = "synthesis_failed"


_USER_FRIENDLY_MESSAGES: dict[str, str] = {
    "profile_not_found": "The voice profile was not found. It may have been deleted.",
    "unsupported_voice": "The selected voice is not available. Try a different one.",
    "unsupported_format": "The selected audio format is not supported. Use MP3, WAV, OGG, or FLAC.",
    "invalid_sample": "The audio sample is invalid or corrupted. Upload a clean .wav or .mp3 file.",
    "sample_not_found": "The voice sample file was not found on disk.",
    "synthesis_failed": "Audio synthesis failed. Check the logs tab for details.",
}


def _friendly_message(exc: DomainError) -> str:
    return _USER_FRIENDLY_MESSAGES.get(exc.code, exc.message)


def register_exception_handlers(app: FastAPI) -> None:
    """Translate domain exceptions to consistent JSON responses."""

    @app.exception_handler(DomainError)
    async def _handle_domain(_: Request, exc: DomainError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "detail": _friendly_message(exc),
                "code": exc.code,
                "technical": exc.message,
            },
        )
