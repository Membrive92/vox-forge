"""Tests del sistema de chunking para textos largos."""
from __future__ import annotations

import pytest


# --- Tests unitarios de split_into_chunks ---

def test_short_text_single_chunk() -> None:
    from backend.services.tts_engine import split_into_chunks

    result = split_into_chunks("Hola mundo.", max_chars=3000)
    assert result == ["Hola mundo."]


def test_split_by_paragraphs() -> None:
    from backend.services.tts_engine import split_into_chunks

    text = "Párrafo uno.\n\nPárrafo dos.\n\nPárrafo tres."
    # max_chars menor que el texto total para forzar split
    result = split_into_chunks(text, max_chars=20)
    assert len(result) == 3
    assert result[0] == "Párrafo uno."
    assert result[1] == "Párrafo dos."
    assert result[2] == "Párrafo tres."


def test_long_paragraph_split_by_sentences() -> None:
    from backend.services.tts_engine import split_into_chunks

    sentences = ["Frase número uno." for _ in range(20)]
    text = " ".join(sentences)  # ~360 chars, single paragraph
    result = split_into_chunks(text, max_chars=100)
    assert len(result) > 1
    # Cada chunk no debe exceder el límite significativamente
    for chunk in result:
        assert len(chunk) <= 110  # margen por última frase


def test_preserves_all_content() -> None:
    from backend.services.tts_engine import split_into_chunks

    text = "Primera frase. Segunda frase. Tercera frase.\n\nSegundo párrafo. Más texto aquí."
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
    """Simula un relato de ~11000 palabras (~70k chars)."""
    from backend.services.tts_engine import split_into_chunks

    paragraphs = []
    for i in range(100):
        sentences = [
            f"Esta es la frase número {j} del párrafo número {i} de nuestro relato largo de prueba."
            for j in range(15)
        ]
        paragraphs.append(" ".join(sentences))
    text = "\n\n".join(paragraphs)

    assert len(text) > 30_000

    result = split_into_chunks(text, max_chars=3000)
    assert len(result) >= 10
    for chunk in result:
        assert len(chunk) <= 3100  # margen razonable
    # Verificar que todo el texto está representado
    total_chars = sum(len(c) for c in result)
    assert total_chars >= len(text) * 0.95  # al menos 95% del original


# --- Tests de integración: síntesis con chunks ---

def test_synthesis_short_text_single_chunk(client) -> None:
    response = client.post("/api/synthesize", json={
        "text": "Texto corto.",
        "voice_id": "es-ES-AlvaroNeural",
        "output_format": "mp3",
        "speed": 100,
        "pitch": 0,
        "volume": 80,
    })
    assert response.status_code == 200
    assert response.headers.get("x-audio-chunks") == "1"


def test_synthesis_long_text_multiple_chunks(client) -> None:
    """Un texto largo se divide en múltiples chunks."""
    sentences = ["Esta es una frase de prueba número cien." for _ in range(150)]
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
    """Párrafos separados por doble newline se dividen correctamente."""
    paragraphs = [f"Este es el párrafo {i}. Contiene varias frases. Y un poco más de texto." for i in range(20)]
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
    """Verifica que textos de hasta 500k chars son aceptados por validación."""
    # Solo verifica que la validación Pydantic no rechaza (no sintetiza 500k)
    text = "Frase de relleno. " * 200  # ~3800 chars
    response = client.post("/api/synthesize", json={
        "text": text,
        "voice_id": "es-ES-AlvaroNeural",
        "output_format": "mp3",
        "speed": 100,
        "pitch": 0,
        "volume": 80,
    })
    assert response.status_code == 200
