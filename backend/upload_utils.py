"""Upload validation helpers.

Enforces content type allowlists and size limits on all file upload
endpoints to prevent malicious uploads and OOMs from arbitrary files.
"""
from __future__ import annotations

from fastapi import UploadFile

from .exceptions import InvalidSampleError

# Max size for a single uploaded file (100 MB).
MAX_UPLOAD_BYTES = 100 * 1024 * 1024

# Allowed audio content types.
ALLOWED_AUDIO_TYPES: set[str] = {
    "audio/wav",
    "audio/x-wav",
    "audio/wave",
    "audio/mpeg",
    "audio/mp3",
    "audio/ogg",
    "audio/flac",
    "audio/webm",
    "audio/x-m4a",
    "audio/mp4",
}

# Allowed document content types.
ALLOWED_DOCUMENT_TYPES: set[str] = {
    "text/plain",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


def validate_audio_upload(upload: UploadFile) -> None:
    """Reject if content_type is not a recognized audio format."""
    ctype = (upload.content_type or "").lower()
    if ctype not in ALLOWED_AUDIO_TYPES:
        # Fallback: allow if filename has a known audio extension
        fname = (upload.filename or "").lower()
        if not fname.endswith((".wav", ".mp3", ".ogg", ".flac", ".webm", ".m4a")):
            raise InvalidSampleError(
                f"Unsupported audio type: {upload.content_type}. "
                "Valid: wav, mp3, ogg, flac, webm, m4a"
            )


def validate_document_upload(upload: UploadFile) -> None:
    """Reject if content_type is not a recognized document format."""
    ctype = (upload.content_type or "").lower()
    if ctype not in ALLOWED_DOCUMENT_TYPES:
        fname = (upload.filename or "").lower()
        if not fname.endswith((".txt", ".pdf", ".doc", ".docx")):
            raise InvalidSampleError(
                f"Unsupported document type: {upload.content_type}. "
                "Valid: txt, pdf, doc, docx"
            )


async def read_upload_safely(upload: UploadFile, max_bytes: int = MAX_UPLOAD_BYTES) -> bytes:
    """Read an upload in chunks, aborting if it exceeds max_bytes.

    Prevents a single POST from buffering gigabytes into memory.
    """
    chunks: list[bytes] = []
    total = 0
    chunk_size = 1024 * 1024  # 1 MB

    while True:
        chunk = await upload.read(chunk_size)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise InvalidSampleError(
                f"File too large: exceeds {max_bytes // (1024 * 1024)} MB limit"
            )
        chunks.append(chunk)

    return b"".join(chunks)
