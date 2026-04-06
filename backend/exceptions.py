"""Excepciones de dominio y sus traducciones a HTTP.

Los servicios lanzan estas excepciones; los routers no las capturan manualmente.
Un handler global las convierte en respuestas HTTP estructuradas.
"""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


class DomainError(Exception):
    """Raíz de las excepciones de dominio."""

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


def register_exception_handlers(app: FastAPI) -> None:
    """Traduce excepciones de dominio a respuestas JSON coherentes."""

    @app.exception_handler(DomainError)
    async def _handle_domain(_: Request, exc: DomainError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.message, "code": exc.code},
        )
