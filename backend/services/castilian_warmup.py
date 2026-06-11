"""Castilian-accent warm-up helper for cross-lingual XTTS synthesis.

Background: when XTTS v2 receives an English speaker_wav with
``language="es"``, the model has no built-in dialect control. The
generated Spanish accent drifts unpredictably toward Latin American
seseo. This module provides two complementary tools:

1. ``wrap_text_with_warmup`` — prepends a short Castilian-only phrase
   plus an explicit silence cue. The model "anchors" on the warm-up
   phonemes (with their characteristic /θ/ and crisp final /s/) and
   carries that articulation into the user's text.

2. ``trim_warmup_audio`` — locates the first long silence in the
   resulting waveform and discards everything before it. The
   user-facing audio starts cleanly with their text.

The warm-up phrase is intentionally short (≈1s of speech) and uses
words that contain ⟨c⟩+e/i, ⟨z⟩, and final ⟨s⟩ to force the model
into Castilian articulation patterns.

Reference voice support (D1) — see ``get_reference_voice``: returns
a path to a pre-recorded Castilian sample if the operator has placed
one under ``data/voices/reference/``. When used, the speaker_wav of
the user is *replaced* by the reference, sacrificing timbre for
guaranteed accent.
"""
from __future__ import annotations

import logging
from pathlib import Path

from ..paths import REFERENCE_VOICES_DIR
from .audio_stretch import clamp_stretch_factor

logger = logging.getLogger(__name__)

# A compact Castilian-leaning phrase. Includes:
#   - ⟨ce⟩ in "Barcelona" and "Cervantes" → /θ/ vs LATAM /s/
#   - final ⟨s⟩ in "España", "los" → crisp Castilian /s/
#   - ⟨z⟩ in "zona" → /θ/
# The trailing periods + comma sequence creates a long pause cue that
# XTTS reliably renders as a >800ms silence — easy to detect downstream.
_WARMUP_PHRASE = "España, Barcelona, Cervantes, zona azul."
_PAUSE_MARKER = " . . . . "


def wrap_text_with_warmup(text: str) -> str:
    """Prepend the Castilian warm-up phrase + a silent gap to ``text``.

    The model sees a single utterance starting in pure Castilian. The
    pause marker is a string of periods that XTTS materializes as
    ~1-1.5s of silence — long enough to detect and trim later.
    """
    return f"{_WARMUP_PHRASE}{_PAUSE_MARKER}{text}"


def trim_warmup_audio(audio_path: Path, min_silence_ms: int = 500) -> bool:
    """Trim the warm-up portion from ``audio_path`` in place.

    Detects the first silence of at least ``min_silence_ms`` after the
    start of the audio and discards everything up to and including it.
    Returns ``True`` if trimming happened, ``False`` if no qualifying
    silence was found (in which case the file is left untouched).

    This is best-effort. If detection fails (e.g. the model produced
    no silence between phrases) the user gets the warm-up audio at
    the start — annoying but not destructive. Raising would be worse:
    they'd lose the whole take.
    """
    try:
        from pydub import AudioSegment
        from pydub.silence import detect_silence
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("pydub not available, skipping warm-up trim: %s", exc)
        return False

    try:
        audio = AudioSegment.from_wav(str(audio_path))
    except Exception as exc:
        logger.warning("Could not open audio for trim: %s", exc)
        return False

    silences = detect_silence(audio, min_silence_len=min_silence_ms, silence_thresh=-40)
    if not silences:
        logger.info("No long silence found — warm-up trim skipped")
        return False

    # Take the FIRST qualifying silence — that's the gap we inserted.
    # Anything later belongs inside the user's text.
    _start, end = silences[0]
    if end >= len(audio) - 200:
        # The whole clip is mostly silence after the warm-up — nothing useful.
        logger.warning("Detected silence covers the rest of the audio; skipping trim")
        return False

    trimmed = audio[end:]
    if len(trimmed) < 500:
        logger.warning("Trim would leave <500ms of audio; skipping")
        return False

    trimmed.export(str(audio_path), format="wav")
    logger.info("Trimmed %dms of warm-up from %s", end, audio_path.name)
    return True


def get_reference_voice() -> Path | None:
    """Return the operator-configured Castilian reference voice, if any.

    Convention: drop a single ``.wav`` (or ``.mp3``/``.flac``) into
    ``data/voices/reference/``. The first file alphabetically wins.
    Returns ``None`` if the directory is empty or missing — callers
    must handle that case (typically by falling back to the user's
    speaker_wav).
    """
    if not REFERENCE_VOICES_DIR.exists():
        return None
    candidates = sorted(
        p for p in REFERENCE_VOICES_DIR.iterdir()
        if p.is_file() and p.suffix.lower() in {".wav", ".mp3", ".flac", ".ogg"}
    )
    return candidates[0] if candidates else None


def time_stretch_wav(audio_path: Path, rate: float) -> bool:
    """Change the speed of ``audio_path`` in place, preserving pitch.

    ``rate > 1`` = faster (shorter audio). ``rate < 1`` = slower (longer).
    A no-op if rate is within 0.01 of 1.0. The effective rate is clamped
    to the safe ±25% range (see ``audio_stretch``). Returns ``True`` if
    the file was rewritten.

    Background: XTTS v2 never receives a ``speed`` kwarg — it is
    silently ignored when the speaker_wav is long enough that the model
    "locks onto" the sample's cadence (audio anchor makes it ~10s+), and
    its quality is poor when it does act. Speed is always resolved here,
    in post, with ``pedalboard.time_stretch`` (Rubber Band): a single
    formant-preserving pass, independent of the model's whims and far
    above phase-vocoder quality.
    """
    if abs(rate - 1.0) < 0.01:
        return False
    rate = clamp_stretch_factor(rate)
    try:
        import soundfile as sf
        from pedalboard import time_stretch
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("pedalboard/soundfile unavailable, skipping stretch: %s", exc)
        return False
    try:
        # always_2d gives (frames, channels); pedalboard wants (channels, frames)
        y, sr = sf.read(str(audio_path), dtype="float32", always_2d=True)
    except Exception as exc:
        logger.warning("Could not load audio for time-stretch: %s", exc)
        return False
    try:
        stretched = time_stretch(
            y.T, sr,
            stretch_factor=rate,
            high_quality=True,
            preserve_formants=True,
        )
        sf.write(str(audio_path), stretched.T, sr)
        logger.info("Time-stretched %s by rate=%.2f (Rubber Band)", audio_path.name, rate)
        return True
    except Exception as exc:
        logger.warning("Time-stretch failed: %s", exc)
        return False


def build_anchored_speaker_wav(
    user_sample: Path,
    reference: Path,
    output_path: Path,
    max_reference_ms: int = 8_000,
) -> Path:
    """Concatenate ``reference`` + ``user_sample`` into a single wav (E).

    XTTS computes its speaker embedding from the entire speaker_wav. By
    placing a short Castilian reference *first*, we bias that embedding
    toward Castilian articulation while the longer user sample carries
    most of the timbre information.

    The reference is capped at ``max_reference_ms`` (default 8s) so it
    doesn't dominate timbre. The user_sample plays in full afterwards.
    Both inputs may be any format pydub can decode (wav/mp3/flac/ogg).
    Output is always wav — XTTS prefers it.
    """
    from pydub import AudioSegment

    ref_audio = AudioSegment.from_file(str(reference))
    if len(ref_audio) > max_reference_ms:
        ref_audio = ref_audio[:max_reference_ms]
    # 200ms of silence between the two clips so the model treats them as
    # separate utterances (not one weird run-on).
    gap = AudioSegment.silent(duration=200)
    user_audio = AudioSegment.from_file(str(user_sample))
    combined = ref_audio + gap + user_audio
    combined.export(str(output_path), format="wav")
    logger.info(
        "Built anchored speaker_wav: %dms ref + %dms user = %dms",
        len(ref_audio), len(user_audio), len(combined),
    )
    return output_path
