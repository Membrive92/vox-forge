"""FastAPI middlewares for request ID tracking and access logging."""
from __future__ import annotations

import logging
import time
import uuid

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from .logging_config import request_id_var

logger = logging.getLogger("backend.access")


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Assigns a unique request ID to every request.

    Reuses the client-provided `X-Request-ID` header if present;
    otherwise generates a new short UUID. The ID is stored in a
    context var so every log record emitted during the request
    carries it automatically.

    The ID is echoed back in the response `X-Request-ID` header
    so the frontend can correlate its own logs with the backend.
    """

    async def dispatch(self, request: Request, call_next):  # noqa: ANN001
        incoming_id = request.headers.get("x-request-id")
        req_id = incoming_id if incoming_id else str(uuid.uuid4())[:12]

        token = request_id_var.set(req_id)
        try:
            response: Response = await call_next(request)
        finally:
            request_id_var.reset(token)

        response.headers["X-Request-ID"] = req_id
        return response


class AccessLogMiddleware(BaseHTTPMiddleware):
    """Logs every HTTP request with method, path, status, and duration.

    Format: `METHOD /path -> STATUS (Nms)`
    Level: INFO for 2xx/3xx, WARNING for 4xx, ERROR for 5xx.
    """

    async def dispatch(self, request: Request, call_next):  # noqa: ANN001
        start = time.perf_counter()
        try:
            response: Response = await call_next(request)
        except Exception:
            duration_ms = (time.perf_counter() - start) * 1000
            logger.exception(
                "%s %s -> EXCEPTION (%.1fms)",
                request.method,
                request.url.path,
                duration_ms,
            )
            raise

        duration_ms = (time.perf_counter() - start) * 1000
        status = response.status_code

        if status >= 500:
            log_level = logging.ERROR
        elif status >= 400:
            log_level = logging.WARNING
        else:
            log_level = logging.INFO

        logger.log(
            log_level,
            "%s %s -> %d (%.1fms)",
            request.method,
            request.url.path,
            status,
            duration_ms,
        )
        return response
