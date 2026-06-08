"""Client disconnection detection for long-running operations.

Provides a CancellationToken that monitors a FastAPI Request and
signals when the client has disconnected. Long-running services
check this token between steps to abort early.
"""
from __future__ import annotations

import asyncio
import logging

from fastapi import Request

logger = logging.getLogger(__name__)


class CancellationToken:
    """Token that signals when a client has disconnected.

    Pass to long-running services so they can abort between steps
    instead of generating audio nobody will receive.
    """

    def __init__(self) -> None:
        self._cancelled = False
        self._task: asyncio.Task | None = None

    @property
    def is_cancelled(self) -> bool:
        return self._cancelled

    def cancel(self) -> None:
        self._cancelled = True

    def check(self) -> None:
        """Raise if cancelled. Call between processing steps."""
        if self._cancelled:
            logger.info("Operation cancelled: client disconnected")
            raise CancelledError()

    def finish(self) -> None:
        """Stop the disconnect monitor. Handlers MUST call this when the
        operation ends (success or error) so the polling task doesn't
        outlive the request and pin it alive forever."""
        task = self._task
        self._task = None
        if task is not None and not task.done():
            task.cancel()


class CancelledError(Exception):
    """Raised when the client disconnects during processing."""


def create_cancellation_token(request: Request) -> CancellationToken:
    """Create a token that auto-cancels when the client disconnects.

    Starts a background task that polls Request.is_disconnected()
    every 2 seconds.
    """
    token = CancellationToken()

    async def _monitor() -> None:
        try:
            while not token.is_cancelled:
                if await request.is_disconnected():
                    token.cancel()
                    logger.info("Client disconnected, cancelling operation")
                    return
                await asyncio.sleep(2)
        except asyncio.CancelledError:
            pass  # operation finished and stopped the monitor

    # Keep a strong reference: a bare create_task is only weakly held by the
    # loop and can be garbage-collected mid-flight, silently disabling
    # disconnect detection. The handler stops it via ``token.finish()``.
    token._task = asyncio.create_task(_monitor())
    return token
