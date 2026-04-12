"""User-maintained pronunciation dictionary.

Applies whole-word replacements to text *before* normalization so the
TTS engine sees the phonetic spelling for fantasy names, acronyms, or
loanwords the base normalizer mispronounces.

Storage: JSON file at `data/pronunciations.json`. Writes are atomic
(tmp + replace) and guarded by an asyncio lock to avoid corruption
under concurrent edits.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import tempfile
from pathlib import Path

from ..paths import DATA_DIR

logger = logging.getLogger(__name__)

_STORE_PATH: Path = DATA_DIR / "pronunciations.json"


class PronunciationManager:
    """Thread-safe pronunciation dictionary with atomic persistence."""

    def __init__(self, store_path: Path = _STORE_PATH) -> None:
        self._path = store_path
        self._entries: dict[str, str] = {}
        self._lock = asyncio.Lock()
        self._load()

    def _load(self) -> None:
        if not self._path.exists():
            self._entries = {}
            return
        try:
            raw = self._path.read_text(encoding="utf-8")
            data = json.loads(raw)
            if isinstance(data, dict):
                self._entries = {str(k): str(v) for k, v in data.items()}
            else:
                logger.warning("Invalid pronunciations file; expected object")
                self._entries = {}
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to load pronunciations: %s", exc)
            self._entries = {}

    def _write_atomic(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(
            suffix=".tmp", prefix="pron_", dir=str(self._path.parent),
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(self._entries, fh, ensure_ascii=False, indent=2)
            os.replace(tmp, self._path)
        except Exception:
            Path(tmp).unlink(missing_ok=True)
            raise

    def list_entries(self) -> dict[str, str]:
        return dict(self._entries)

    async def upsert(self, word: str, replacement: str) -> None:
        key = word.strip()
        value = replacement.strip()
        if not key or not value:
            raise ValueError("word and replacement must be non-empty")
        async with self._lock:
            self._entries[key] = value
            self._write_atomic()

    async def delete(self, word: str) -> bool:
        async with self._lock:
            if word not in self._entries:
                return False
            del self._entries[word]
            self._write_atomic()
            return True

    def apply(self, text: str) -> str:
        """Apply all replacements as whole-word substitutions.

        Case-insensitive for the key but preserves the casing of the
        replacement verbatim. Longer keys are applied first so that
        "Lord Kael" matches before "Kael" would.
        """
        if not self._entries:
            return text
        for key in sorted(self._entries.keys(), key=len, reverse=True):
            pattern = re.compile(rf"\b{re.escape(key)}\b", re.IGNORECASE)
            text = pattern.sub(self._entries[key], text)
        return text


# Module-level singleton — injected via FastAPI Depends.
manager = PronunciationManager()
