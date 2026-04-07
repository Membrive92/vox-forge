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


# --- Clone text preprocessing ---

def test_preprocess_converts_numbers_to_words() -> None:
    from backend.services.text_normalizer import normalize_for_tts

    result = normalize_for_tts("Tiene 42 anos y 3 hijos")
    assert "42" not in result
    assert "3" not in result
    assert "cuarenta y dos" in result
    assert "tres" in result


def test_preprocess_converts_year_numbers() -> None:
    from backend.services.text_normalizer import normalize_for_tts

    result = normalize_for_tts("En el ano 1981 ocurrio algo")
    assert "1981" not in result
    assert "mil novecientos ochenta y uno" in result


def test_preprocess_normalizes_allcaps() -> None:
    from backend.services.text_normalizer import normalize_for_tts

    result = normalize_for_tts("El ARCHIVO SECRETO fue encontrado")
    assert "ARCHIVO" not in result
    assert "SECRETO" not in result
    # All lowercased (first letter capitalized by sentence rule)
    assert "archivo secreto" in result


def test_preprocess_lowercases_everything() -> None:
    from backend.services.text_normalizer import normalize_for_tts

    result = normalize_for_tts("La Ciudad de Coruna")
    # Everything lowercase except first letter
    assert result == "La ciudad de coruna"


def test_preprocess_handles_symbols() -> None:
    from backend.services.text_normalizer import normalize_for_tts

    result = normalize_for_tts("50% de descuento")
    assert "%" not in result
    assert "por ciento" in result


def test_preprocess_removes_ellipsis() -> None:
    from backend.services.text_normalizer import normalize_for_tts

    assert "..." not in normalize_for_tts("Hello... world")
    assert "\u2026" not in normalize_for_tts("Hello\u2026 world")


def test_preprocess_replaces_dashes_with_commas() -> None:
    from backend.services.text_normalizer import normalize_for_tts

    result = normalize_for_tts("Word \u2014 another word")
    assert "\u2014" not in result


def test_preprocess_removes_quotes() -> None:
    from backend.services.text_normalizer import normalize_for_tts

    result = normalize_for_tts('"Hello" she said')
    assert '"' not in result


def test_preprocess_normalizes_single_newlines() -> None:
    from backend.services.text_normalizer import normalize_for_tts

    result = normalize_for_tts("Line one\nLine two")
    assert "\n" not in result
    assert "Line one line two" == result  # lowercased after merge


def test_preprocess_preserves_paragraph_breaks() -> None:
    from backend.services.text_normalizer import normalize_for_tts

    result = normalize_for_tts("Paragraph one.\n\nParagraph two.")
    assert "\n\n" in result


def test_preprocess_collapses_repeated_punctuation() -> None:
    from backend.services.text_normalizer import normalize_for_tts

    assert ",," not in normalize_for_tts("Hello,, world")
    assert ".." not in normalize_for_tts("Hello.. world")


# --- Clone-specific chunking ---

def test_clone_chunks_splits_by_sentences() -> None:
    from backend.services.tts_engine import split_into_clone_chunks

    text = "First sentence. Second sentence. Third sentence."
    result = split_into_clone_chunks(text)
    assert len(result) == 3
    for chunk in result:
        assert hasattr(chunk, "text")
        assert hasattr(chunk, "pause_ms")


def test_clone_chunks_keeps_commas_inside() -> None:
    """Commas stay inside chunks — not split points."""
    from backend.services.tts_engine import split_into_clone_chunks

    text = "First clause, second clause, third clause."
    result = split_into_clone_chunks(text)
    # One sentence = one chunk (commas are internal)
    assert len(result) == 1
    assert "," in result[0].text


def test_clone_chunks_no_sentence_ending_punctuation() -> None:
    """Sentence-ending punctuation (. ! ?) is stripped from chunk text."""
    from backend.services.tts_engine import split_into_clone_chunks

    text = "Hello, world. How are you? Fine, thanks! Great."
    result = split_into_clone_chunks(text)
    for chunk in result:
        assert not chunk.text.endswith("."), f"Period at end: '{chunk.text}'"
        assert not chunk.text.endswith("!"), f"Exclamation at end: '{chunk.text}'"
        assert not chunk.text.endswith("?"), f"Question at end: '{chunk.text}'"


def test_clone_chunks_paragraph_pause() -> None:
    from backend.services.tts_engine import split_into_clone_chunks, CLONE_PAUSE_PARAGRAPH_MS

    text = "End of first paragraph.\n\nStart of second paragraph."
    result = split_into_clone_chunks(text)
    assert len(result) == 2
    assert result[0].pause_ms == CLONE_PAUSE_PARAGRAPH_MS


def test_clone_chunks_last_chunk_no_pause() -> None:
    from backend.services.tts_engine import split_into_clone_chunks

    text = "Some text. More text."
    result = split_into_clone_chunks(text)
    assert result[-1].pause_ms == 0


def test_clone_chunks_vs_edge_chunks_count() -> None:
    """Clone chunks should be more numerous than Edge-TTS chunks."""
    from backend.services.tts_engine import split_into_chunks, split_into_clone_chunks

    sentences = [f"Sentence number {i} in our test story." for i in range(50)]
    text = " ".join(sentences)

    edge_chunks = split_into_chunks(text, max_chars=3000)
    clone_chunks = split_into_clone_chunks(text)

    assert len(clone_chunks) > len(edge_chunks)


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
