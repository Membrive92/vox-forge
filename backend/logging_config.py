"""Structured logging configuration with rotation and request context.

Sets up:
- Rotating file handler for `data/logs/app.log` (10MB x 5 backups, text)
- Rotating file handler for `data/logs/app.jsonl` (10MB x 5 backups, JSON lines)
- Separate error log `data/logs/errors.log` for warnings and errors
- Stdout handler with colored output for development
- Request ID context var injected into every log record
- Consistent format across all handlers
"""
from __future__ import annotations

import json
import logging
import sys
import traceback
from contextvars import ContextVar
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path

from .config import settings
from .paths import DATA_DIR

request_id_var: ContextVar[str] = ContextVar("request_id", default="-")

LOGS_DIR: Path = DATA_DIR / "logs"
APP_LOG_FILE: Path = LOGS_DIR / "app.log"
APP_JSONL_FILE: Path = LOGS_DIR / "app.jsonl"
ERROR_LOG_FILE: Path = LOGS_DIR / "errors.log"

_MAX_BYTES = 10 * 1024 * 1024  # 10 MB per file
_BACKUP_COUNT = 5

_LOG_FORMAT = "%(asctime)s [%(levelname)-7s] [%(request_id)s] %(name)s: %(message)s"
_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"


class _RequestIdFilter(logging.Filter):
    """Inject the current request_id contextvar into every LogRecord."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get()  # type: ignore[attr-defined]
        return True


class _ColorFormatter(logging.Formatter):
    """Colored formatter for console output (dev mode)."""

    _COLORS = {
        "DEBUG": "\033[90m",
        "INFO": "\033[36m",
        "WARNING": "\033[33m",
        "ERROR": "\033[31m",
        "CRITICAL": "\033[91m",
    }
    _RESET = "\033[0m"

    def format(self, record: logging.LogRecord) -> str:
        color = self._COLORS.get(record.levelname, "")
        reset = self._RESET if color else ""
        message = super().format(record)
        return f"{color}{message}{reset}"


class _JsonFormatter(logging.Formatter):
    """Emit one JSON object per log record — machine-parseable."""

    def format(self, record: logging.LogRecord) -> str:
        obj: dict[str, object] = {
            "ts": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "rid": getattr(record, "request_id", "-"),
        }
        if record.exc_info and record.exc_info[0] is not None:
            obj["exc"] = "".join(traceback.format_exception(*record.exc_info))
        if record.stack_info:
            obj["stack"] = record.stack_info
        return json.dumps(obj, ensure_ascii=False, default=str)


def configure_logging() -> None:
    """Configure root logger with file rotation + colored stdout.

    Idempotent — safe to call multiple times.
    """
    LOGS_DIR.mkdir(parents=True, exist_ok=True)

    root = logging.getLogger()
    root.setLevel(settings.log_level.upper())

    for handler in list(root.handlers):
        root.removeHandler(handler)

    request_filter = _RequestIdFilter()

    # ── Text: app.log (INFO+) ────────────────────────────────────────
    app_handler = RotatingFileHandler(
        APP_LOG_FILE, maxBytes=_MAX_BYTES, backupCount=_BACKUP_COUNT, encoding="utf-8",
    )
    app_handler.setLevel(logging.INFO)
    app_handler.setFormatter(logging.Formatter(_LOG_FORMAT, _DATE_FORMAT))
    app_handler.addFilter(request_filter)
    root.addHandler(app_handler)

    # ── JSON lines: app.jsonl (INFO+) ────────────────────────────────
    jsonl_handler = RotatingFileHandler(
        APP_JSONL_FILE, maxBytes=_MAX_BYTES, backupCount=_BACKUP_COUNT, encoding="utf-8",
    )
    jsonl_handler.setLevel(logging.INFO)
    jsonl_handler.setFormatter(_JsonFormatter())
    jsonl_handler.addFilter(request_filter)
    root.addHandler(jsonl_handler)

    # ── Text: errors.log (WARNING+) ──────────────────────────────────
    error_handler = RotatingFileHandler(
        ERROR_LOG_FILE, maxBytes=_MAX_BYTES, backupCount=_BACKUP_COUNT, encoding="utf-8",
    )
    error_handler.setLevel(logging.WARNING)
    error_handler.setFormatter(logging.Formatter(_LOG_FORMAT, _DATE_FORMAT))
    error_handler.addFilter(request_filter)
    root.addHandler(error_handler)

    # ── Console: colored stdout ──────────────────────────────────────
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(settings.log_level.upper())
    console_handler.setFormatter(_ColorFormatter(_LOG_FORMAT, _DATE_FORMAT))
    console_handler.addFilter(request_filter)
    root.addHandler(console_handler)

    # Reduce noise from verbose third-party libraries
    for noisy in ("httpcore", "httpx", "urllib3", "multipart", "python_multipart"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    root.info("Logging configured: %s (level=%s)", LOGS_DIR, settings.log_level)
