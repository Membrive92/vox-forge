"""Upload validation helpers.

Enforces content type allowlists and size limits on all file upload
endpoints to prevent malicious uploads and OOMs from arbitrary files.
"""
from __future__ import annotations

from fastapi import UploadFile

from .exceptions import InvalidSampleError

# Max size for a single uploaded file (100 MB).
MAX_UPLOAD_BYTES = 100 * 1024 * 1024

# Allowed audio file extensions. Single source of truth shared with the
# routers (chapter upload-audio), so the two allowlists can't drift.
ALLOWED_AUDIO_EXTS: tuple[str, ...] = (".wav", ".mp3", ".ogg", ".flac", ".webm", ".m4a")

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

# Allowed image content types for Studio cover upload.
ALLOWED_IMAGE_TYPES: set[str] = {
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
}


def validate_audio_upload(upload: UploadFile) -> None:
    """Reject if content_type is not a recognized audio format."""
    ctype = (upload.content_type or "").lower()
    if ctype not in ALLOWED_AUDIO_TYPES:
        # Fallback: allow if filename has a known audio extension
        fname = (upload.filename or "").lower()
        if not fname.endswith(ALLOWED_AUDIO_EXTS):
            raise InvalidSampleError(
                f"Unsupported audio type: {upload.content_type}. "
                "Valid: wav, mp3, ogg, flac, webm, m4a"
            )


def validate_image_upload(upload: UploadFile) -> None:
    """Reject if content_type is not a recognized image format."""
    ctype = (upload.content_type or "").lower()
    if ctype not in ALLOWED_IMAGE_TYPES:
        fname = (upload.filename or "").lower()
        if not fname.endswith((".png", ".jpg", ".jpeg", ".webp")):
            raise InvalidSampleError(
                f"Unsupported image type: {upload.content_type}. "
                "Valid: png, jpg, jpeg, webp"
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


def _looks_like_audio(content: bytes) -> bool:
    """True if the leading bytes match a known audio container."""
    if len(content) < 12:
        return False
    head = content[:12]
    if head[:4] == b"RIFF" and content[8:12] == b"WAVE":
        return True  # WAV
    if head[:4] in (b"OggS", b"fLaC", b"FORM"):
        return True  # Ogg / FLAC / AIFF
    if head[:3] == b"ID3":
        return True  # MP3 with ID3 tag
    if head[0] == 0xFF and (head[1] & 0xE0) == 0xE0:
        return True  # MPEG audio frame sync
    if content[4:8] == b"ftyp":
        return True  # MP4 / M4A
    if head[:4] == b"\x1aE\xdf\xa3":
        return True  # EBML (WebM / Matroska)
    return False


def _looks_like_text_or_executable(content: bytes) -> bool:
    """True if the head clearly looks like markup/script/PDF/executable."""
    head = content[:64].lstrip()
    if not head:
        return False
    return (
        head[:1] in (b"<", b"{", b"[")
        or head[:2] in (b"#!", b"//", b"MZ")
        or head[:4] == b"\x7fELF"
        or head[:5].upper() == b"%PDF-"
    )


def validate_audio_bytes(content: bytes) -> None:
    """Defence-in-depth: reject payloads that are clearly not audio.

    The declared content-type/extension is trivially spoofable, so we also
    sniff the bytes. Intentionally permissive — only rejects when the bytes
    don't match a known audio container *and* look like text/markup/an
    executable, so unusual-but-valid audio isn't false-rejected (ffmpeg
    downstream is the final gate)."""
    if not _looks_like_audio(content) and _looks_like_text_or_executable(content):
        raise InvalidSampleError(
            "Uploaded file does not look like audio (content check failed)."
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
