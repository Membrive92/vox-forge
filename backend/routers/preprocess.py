"""Text preprocessing endpoint for TTS optimization."""
from __future__ import annotations

import io
import logging
from pathlib import Path

from fastapi import APIRouter, UploadFile, File
from pydantic import BaseModel, Field

from ..config import settings
from ..exceptions import DomainError
from ..services.text_normalizer import normalize_for_tts
from ..upload_utils import read_upload_safely, validate_document_upload

logger = logging.getLogger(__name__)

router = APIRouter(tags=["preprocess"])

_SUPPORTED_EXTENSIONS = {".txt", ".doc", ".docx", ".pdf"}


class UnsupportedFileError(DomainError):
    status_code = 400
    code = "unsupported_file"


class PreprocessRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=settings.max_text_length)


class PreprocessResponse(BaseModel):
    original_length: int
    processed_length: int
    text: str


def _extract_text_from_txt(content: bytes) -> str:
    """Extract text from a plain text file."""
    for encoding in ("utf-8", "latin-1", "cp1252"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    return content.decode("utf-8", errors="replace")


def _extract_text_from_docx(content: bytes) -> str:
    """Extract text from a .docx file."""
    import docx

    doc = docx.Document(io.BytesIO(content))
    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
    return "\n\n".join(paragraphs)


def _extract_text_from_pdf(content: bytes) -> str:
    """Extract text from a PDF file."""
    import fitz  # pymupdf

    doc = fitz.open(stream=content, filetype="pdf")
    pages = []
    for page in doc:
        text = page.get_text()
        if text.strip():
            pages.append(text.strip())
    doc.close()
    return "\n\n".join(pages)


def _extract_text(filename: str, content: bytes) -> str:
    """Extract text based on file extension."""
    ext = Path(filename).suffix.lower()

    if ext == ".txt":
        return _extract_text_from_txt(content)
    if ext in (".doc", ".docx"):
        return _extract_text_from_docx(content)
    if ext == ".pdf":
        return _extract_text_from_pdf(content)

    raise UnsupportedFileError(
        f"Unsupported file type: {ext}. "
        f"Supported: {', '.join(sorted(_SUPPORTED_EXTENSIONS))}"
    )


@router.post("/preprocess", summary="Normalize text for TTS", response_model=PreprocessResponse)
async def preprocess_text(request: PreprocessRequest) -> PreprocessResponse:
    """Normalize text for optimal TTS output.

    Expands abbreviations, numbers to words, normalizes caps,
    removes decorative punctuation, and cleans up formatting.
    """
    processed = normalize_for_tts(request.text)
    return PreprocessResponse(
        original_length=len(request.text),
        processed_length=len(processed),
        text=processed,
    )


@router.post("/preprocess/file", summary="Upload and normalize a document", response_model=PreprocessResponse)
async def preprocess_file(file: UploadFile = File(...)) -> PreprocessResponse:
    """Upload a document and return normalized text for TTS.

    Supported formats: .txt, .doc, .docx, .pdf
    """
    validate_document_upload(file)

    filename = file.filename or "unknown.txt"
    content = await read_upload_safely(file)

    logger.info("Processing file: %s (%d bytes)", filename, len(content))
    try:
        text = _extract_text(filename, content)
    except UnsupportedFileError:
        raise
    except Exception as exc:
        raise UnsupportedFileError(f"Could not read document: {exc}") from exc

    if len(text) > settings.max_text_length:
        raise UnsupportedFileError(
            f"Document too long: {len(text)} characters exceeds limit of {settings.max_text_length}"
        )

    processed = normalize_for_tts(text)

    logger.info(
        "File processed: %s -> %d chars original -> %d chars normalized",
        filename, len(text), len(processed),
    )
    return PreprocessResponse(
        original_length=len(text),
        processed_length=len(processed),
        text=processed,
    )
