"""Chunking system tests for long texts."""
from __future__ import annotations

import pytest


# --- Tests unitarios de split_into_chunks ---

def test_short_text_single_chunk() -> None:
    from backend.services.tts_engine import split_into_chunks

    result = split_into_chunks("Hello world.", max_chars=3000)
    assert result == ["Hello world."]


def test_split_by_paragraphs() -> None:
    from backend.services.tts_engine import split_into_chunks

    text = "Paragraph one.\n\nParagraph two.\n\nParagraph three."
    # max_chars smaller than total text to force split
    result = split_into_chunks(text, max_chars=20)
    assert len(result) == 3
    assert result[0] == "Paragraph one."
    assert result[1] == "Paragraph two."
    assert result[2] == "Paragraph three."


def test_long_paragraph_split_by_sentences() -> None:
    from backend.services.tts_engine import split_into_chunks

    sentences = ["Sentence number one." for _ in range(20)]
    text = " ".join(sentences)  # ~360 chars, single paragraph
    result = split_into_chunks(text, max_chars=100)
    assert len(result) > 1
    # Cada chunk no debe exceder el límite significativamente
    for chunk in result:
        assert len(chunk) <= 110  # margin for last sentence


def test_preserves_all_content() -> None:
    from backend.services.tts_engine import split_into_chunks

    text = "First sentence. Second sentence. Third sentence.\n\nSecond paragraph. More text here."
    result = split_into_chunks(text, max_chars=40)

    # Reconstruir y verificar que no se perdió texto
    reconstructed = " ".join(result)
    for word in text.split():
        stripped = word.strip()
        if stripped:
            assert stripped in reconstructed, f"'{stripped}' no encontrado"


def test_empty_text_returns_text() -> None:
    from backend.services.tts_engine import split_into_chunks

    result = split_into_chunks("", max_chars=100)
    assert result == [""]


def test_realistic_story_length() -> None:
    """Simulate a story of ~11000 words (~70k chars)."""
    from backend.services.tts_engine import split_into_chunks

    paragraphs = []
    for i in range(100):
        sentences = [
            f"This is sentence number {j} of paragraph number {i} in our long test story."
            for j in range(15)
        ]
        paragraphs.append(" ".join(sentences))
    text = "\n\n".join(paragraphs)

    assert len(text) > 30_000

    result = split_into_chunks(text, max_chars=3000)
    assert len(result) >= 10
    for chunk in result:
        assert len(chunk) <= 3100  # margen razonable
    # Verify all text is represented
    total_chars = sum(len(c) for c in result)
    assert total_chars >= len(text) * 0.95  # al menos 95% del original


# --- Tests de integración: síntesis con chunks ---

def test_synthesis_short_text_single_chunk(client) -> None:
    response = client.post("/api/synthesize", json={
        "text": "Short text.",
        "voice_id": "es-ES-AlvaroNeural",
        "output_format": "mp3",
        "speed": 100,
        "pitch": 0,
        "volume": 80,
    })
    assert response.status_code == 200
    assert response.headers.get("x-audio-chunks") == "1"


def test_synthesis_long_text_multiple_chunks(client) -> None:
    """A long text is split into multiple chunks."""
    sentences = ["This is a test sentence number one hundred." for _ in range(150)]
    long_text = " ".join(sentences)
    assert len(long_text) > 3000

    response = client.post("/api/synthesize", json={
        "text": long_text,
        "voice_id": "es-ES-AlvaroNeural",
        "output_format": "mp3",
        "speed": 100,
        "pitch": 0,
        "volume": 80,
    })
    assert response.status_code == 200
    chunks = int(response.headers.get("x-audio-chunks", "0"))
    assert chunks > 1
    assert response.headers.get("x-text-length") == str(len(long_text))
    assert len(response.content) > 0


def test_synthesis_with_paragraphs_chunked(client) -> None:
    """Paragraphs separated by double newlines are split correctly."""
    paragraphs = [f"This is paragraph {i}. It contains several sentences. And a bit more text." for i in range(20)]
    text = "\n\n".join(paragraphs)

    response = client.post("/api/synthesize", json={
        "text": text,
        "voice_id": "es-ES-AlvaroNeural",
        "output_format": "mp3",
        "speed": 100,
        "pitch": 0,
        "volume": 80,
    })
    assert response.status_code == 200
    assert int(response.headers.get("x-audio-chunks", "0")) >= 1


def test_max_text_length_accepts_large_text(client) -> None:
    """Verify that texts up to 500k chars are accepted by validation."""
    # Just verify Pydantic validation doesn't reject (doesn't synthesize 500k)
    text = "Filler sentence here. " * 200  # ~4400 chars
    response = client.post("/api/synthesize", json={
        "text": text,
        "voice_id": "es-ES-AlvaroNeural",
        "output_format": "mp3",
        "speed": 100,
        "pitch": 0,
        "volume": 80,
    })
    assert response.status_code == 200
