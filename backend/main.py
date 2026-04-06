"""Punto de entrada de la aplicación FastAPI."""
from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .exceptions import register_exception_handlers
from .routers import health, profiles, synthesis, voices


def _configure_logging() -> None:
    logging.basicConfig(
        level=settings.log_level.upper(),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )


def create_app() -> FastAPI:
    _configure_logging()

    app = FastAPI(
        title="VoxForge API",
        description="API de síntesis de texto a voz con gestión de perfiles",
        version="1.0.0",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Audio-Duration", "X-Audio-Size", "X-Audio-Chunks", "X-Text-Length", "Content-Disposition"],
    )

    register_exception_handlers(app)

    # Routers bajo prefijo /api
    app.include_router(synthesis.router, prefix="/api")
    app.include_router(voices.router, prefix="/api")
    app.include_router(profiles.router, prefix="/api")
    app.include_router(health.router, prefix="/api")

    return app


app = create_app()
