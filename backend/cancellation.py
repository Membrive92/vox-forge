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


class CancelledError(Exception):
    """Raised when the client disconnects during processing."""


def create_cancellation_token(request: Request) -> CancellationToken:
    """Create a token that auto-cancels when the client disconnects.

    Starts a background task that polls Request.is_disconnected()
    every 2 seconds.
    """
    token = CancellationToken()

    async def _monitor() -> None:
        while not token.is_cancelled:
            if await request.is_disconnected():
                token.cancel()
                logger.info("Client disconnected, cancelling operation")
                return
            await asyncio.sleep(2)

    asyncio.create_task(_monitor())
    return token
