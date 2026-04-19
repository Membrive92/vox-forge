"""FastAPI application entry point."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .checks import run_startup_checks
from .config import settings
from .database import init_db
from .exceptions import register_exception_handlers
from .logging_config import configure_logging
from .middleware import AccessLogMiddleware, RequestIdMiddleware
from .routers import activity, ambience, analyze, batch_export, chapter_synth, character_synth, conversion, stats as stats_router, experimental, health, logs, preprocess, profiles, projects, pronunciation, studio, synthesis, voice_lab, voices

logger = logging.getLogger("backend")


@asynccontextmanager
async def _lifespan(_app: FastAPI) -> AsyncIterator[None]:
    await init_db()
    yield


def create_app() -> FastAPI:
    configure_logging()
    run_startup_checks()

    app = FastAPI(
        title="VoxForge API",
        description="Text-to-speech synthesis API with voice profile management",
        version="1.0.0",
        lifespan=_lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=[
            "X-Audio-Duration", "X-Audio-Size", "X-Audio-Chunks", "X-Audio-Engine",
            "X-Text-Length", "Content-Disposition", "X-Request-ID",
        ],
    )

    # Order matters: RequestId must run first so every downstream log carries it.
    app.add_middleware(AccessLogMiddleware)
    app.add_middleware(RequestIdMiddleware)

    register_exception_handlers(app)

    @app.exception_handler(Exception)
    async def _unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.exception(
            "Unhandled exception on %s %s: %s",
            request.method, request.url.path, exc,
        )
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal server error"},
        )

    # Mount routers under /api prefix
    app.include_router(synthesis.router, prefix="/api")
    app.include_router(voices.router, prefix="/api")
    app.include_router(profiles.router, prefix="/api")
    app.include_router(preprocess.router, prefix="/api")
    app.include_router(conversion.router, prefix="/api")
    app.include_router(voice_lab.router, prefix="/api")
    app.include_router(experimental.router, prefix="/api")
    app.include_router(projects.router, prefix="/api")
    app.include_router(chapter_synth.router, prefix="/api")
    app.include_router(batch_export.router, prefix="/api")
    app.include_router(character_synth.router, prefix="/api")
    app.include_router(analyze.router, prefix="/api")
    app.include_router(ambience.router, prefix="/api")
    app.include_router(activity.router, prefix="/api")
    app.include_router(pronunciation.router, prefix="/api")
    app.include_router(logs.router, prefix="/api")
    app.include_router(stats_router.router, prefix="/api")
    app.include_router(studio.router, prefix="/api")
    app.include_router(health.router, prefix="/api")

    return app


app = create_app()
