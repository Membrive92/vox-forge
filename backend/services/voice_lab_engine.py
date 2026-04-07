"""Voice laboratory engine for audio property manipulation.

Modifies voice characteristics (pitch, formants, EQ, reverb, compression)
of an existing audio file. All processing is CPU-based DSP — no GPU needed,
runs in seconds even for long audio.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf
from pedalboard import (
    Compressor,
    LowShelfFilter,
    Pedalboard,
    PeakFilter,
    Reverb,
)

from ..exceptions import SynthesisError
from ..paths import OUTPUT_DIR, TEMP_DIR

logger = logging.getLogger(__name__)

# Default sample rate for processing.
_SR = 22050


@dataclass
class VoiceLabParams:
    """Parameters for voice manipulation."""

    # Noise reduction strength 0-100. 0 = off, 100 = maximum.
    noise_reduction: float = 0.0

    # Pitch shift in semitones (-12 to +12). Negative = deeper.
    pitch_semitones: float = 0.0

    # Formant shift in semitones (-6 to +6). Negative = deeper resonance.
    # This is the key parameter for making a voice sound naturally deeper
    # without the "slow motion" effect of pitch-only shifting.
    formant_shift: float = 0.0

    # Bass boost in dB (0 to +12). Shelf filter at ~200Hz.
    bass_boost_db: float = 0.0

    # Warmth: mid-frequency boost in dB (0 to +6). Peak at ~300Hz.
    warmth_db: float = 0.0

    # Compression amount 0-100. Maps to threshold and ratio.
    compression: float = 0.0

    # Reverb wet/dry mix 0-100.
    reverb: float = 0.0

    # Speed multiplier (0.5 to 2.0). 1.0 = normal.
    speed: float = 1.0


@dataclass
class VoicePreset:
    """A named voice preset with parameters and character description."""

    name: str
    description: str
    category: str  # narrator, character, effect
    params: VoiceLabParams = field(default_factory=VoiceLabParams)


# ──────────────────────────────────────────────────────────────────────
# Built-in presets
# ──────────────────────────────────────────────────────────────────────

BUILTIN_PRESETS: list[VoicePreset] = [
    # Narrators
    VoicePreset(
        name="Narrador profundo",
        description="Voz grave y resonante, ideal para relatos de misterio y terror",
        category="narrator",
        params=VoiceLabParams(pitch_semitones=-2, formant_shift=-3, bass_boost_db=6, warmth_db=3, compression=40, reverb=10),
    ),
    VoicePreset(
        name="Narrador calido",
        description="Voz acogedora y envolvente, perfecta para cuentos y fabulas",
        category="narrator",
        params=VoiceLabParams(pitch_semitones=0, formant_shift=-1, bass_boost_db=3, warmth_db=5, compression=30, reverb=15),
    ),
    VoicePreset(
        name="Narrador epico",
        description="Voz imponente y dramatica, para aventuras y fantasia epica",
        category="narrator",
        params=VoiceLabParams(pitch_semitones=-3, formant_shift=-4, bass_boost_db=9, warmth_db=2, compression=50, reverb=25),
    ),
    VoicePreset(
        name="Narrador intimo",
        description="Voz cercana y suave, como si te contaran un secreto",
        category="narrator",
        params=VoiceLabParams(pitch_semitones=0, formant_shift=0, bass_boost_db=2, warmth_db=4, compression=20, reverb=5, speed=0.95),
    ),
    VoicePreset(
        name="Narrador documental",
        description="Voz clara y neutra, profesional y objetiva",
        category="narrator",
        params=VoiceLabParams(pitch_semitones=-1, formant_shift=-1, bass_boost_db=2, warmth_db=1, compression=45, reverb=8),
    ),
    # Characters
    VoicePreset(
        name="Anciano sabio",
        description="Voz envejecida, pausada y con gravedad",
        category="character",
        params=VoiceLabParams(pitch_semitones=-4, formant_shift=-2, bass_boost_db=4, warmth_db=6, compression=35, reverb=20, speed=0.88),
    ),
    VoicePreset(
        name="Villano siniestro",
        description="Voz oscura, amenazante, con resonancia cavernosa",
        category="character",
        params=VoiceLabParams(pitch_semitones=-5, formant_shift=-5, bass_boost_db=10, warmth_db=0, compression=55, reverb=30),
    ),
    VoicePreset(
        name="Hada o elfo",
        description="Voz eterea, aguda y luminosa",
        category="character",
        params=VoiceLabParams(pitch_semitones=3, formant_shift=2, bass_boost_db=0, warmth_db=2, compression=25, reverb=35),
    ),
    VoicePreset(
        name="Guerrero",
        description="Voz firme, potente y directa",
        category="character",
        params=VoiceLabParams(pitch_semitones=-2, formant_shift=-2, bass_boost_db=5, warmth_db=1, compression=60, reverb=5),
    ),
    VoicePreset(
        name="Espiritu o fantasma",
        description="Voz eterea, distante, como de otro mundo",
        category="character",
        params=VoiceLabParams(pitch_semitones=-1, formant_shift=1, bass_boost_db=0, warmth_db=3, compression=15, reverb=65, speed=0.92),
    ),
    # Effects
    VoicePreset(
        name="Radio antigua",
        description="Sonido de radio AM vintage, metalico y estrecho",
        category="effect",
        params=VoiceLabParams(pitch_semitones=0, formant_shift=0, bass_boost_db=-4, warmth_db=-2, compression=70, reverb=0),
    ),
    VoicePreset(
        name="Caverna",
        description="Como hablar dentro de una cueva enorme",
        category="effect",
        params=VoiceLabParams(pitch_semitones=-1, formant_shift=-1, bass_boost_db=4, warmth_db=0, compression=20, reverb=80),
    ),
]


# ──────────────────────────────────────────────────────────────────────
# Random preset generator
# ──────────────────────────────────────────────────────────────────────

_RANDOM_ARCHETYPES = [
    # (name_template, description_template, category, param_ranges)
    {
        "names": ["Cronista del alba", "Voz de las estrellas", "Relator del crepusculo", "Narrador de leyendas",
                  "Cuentista del bosque", "Voz del oraculo", "Bardo errante", "Cantor de historias"],
        "category": "narrator",
        "pitch": (-4, 1),
        "formant": (-5, 1),
        "bass": (0, 10),
        "warmth": (0, 6),
        "compression": (20, 60),
        "reverb": (5, 30),
        "speed": (0.88, 1.05),
    },
    {
        "names": ["Hechicero olvidado", "Senor de las sombras", "Guardian del umbral", "Alquimista demente",
                  "Dama del lago", "Centinela de piedra", "Espectro del pantano", "Dragon ancestral"],
        "category": "character",
        "pitch": (-6, 4),
        "formant": (-6, 4),
        "bass": (0, 12),
        "warmth": (0, 6),
        "compression": (10, 70),
        "reverb": (5, 50),
        "speed": (0.8, 1.1),
    },
    {
        "names": ["Eco del vacio", "Susurro arcano", "Resonancia astral", "Distorsion temporal",
                  "Frecuencia prohibida", "Canal olvidado", "Transmision fantasma", "Ruido blanco"],
        "category": "effect",
        "pitch": (-5, 5),
        "formant": (-4, 4),
        "bass": (-4, 12),
        "warmth": (-2, 6),
        "compression": (0, 80),
        "reverb": (10, 90),
        "speed": (0.75, 1.2),
    },
]


def generate_random_preset(rng: np.random.Generator | None = None) -> VoicePreset:
    """Generate a random voice preset with RPG-style name and parameters."""
    if rng is None:
        rng = np.random.default_rng()

    archetype = _RANDOM_ARCHETYPES[rng.integers(0, len(_RANDOM_ARCHETYPES))]
    name = str(rng.choice(archetype["names"]))  # type: ignore[arg-type]

    def _rand(r: tuple[float, float]) -> float:
        return round(float(rng.uniform(r[0], r[1])), 1)

    params = VoiceLabParams(
        pitch_semitones=_rand(archetype["pitch"]),
        formant_shift=_rand(archetype["formant"]),
        bass_boost_db=_rand(archetype["bass"]),
        warmth_db=_rand(archetype["warmth"]),
        compression=_rand(archetype["compression"]),
        reverb=_rand(archetype["reverb"]),
        speed=_rand(archetype["speed"]),
    )

    return VoicePreset(
        name=name,
        description=f"Perfil generado aleatoriamente ({archetype['category']})",
        category=str(archetype["category"]),
        params=params,
    )


# ──────────────────────────────────────────────────────────────────────
# Audio processing engine
# ──────────────────────────────────────────────────────────────────────

class VoiceLabEngine:
    """Processes audio with voice manipulation effects.

    All processing is CPU-based (no GPU needed). A 20-minute audio
    file processes in ~5-10 seconds.
    """

    @staticmethod
    def _apply_noise_reduction(audio: np.ndarray, sr: int, strength: float) -> np.ndarray:
        """Reduce background noise from audio.

        Uses spectral gating via noisereduce. Strength 0-100 maps to
        the prop_decrease parameter (0.0 = off, 1.0 = full reduction).
        """
        if strength < 1:
            return audio
        import noisereduce as nr

        prop = min(strength / 100, 1.0)
        return nr.reduce_noise(
            y=audio,
            sr=sr,
            prop_decrease=prop,
            stationary=True,
        )

    @staticmethod
    def _apply_formant_shift(audio: np.ndarray, sr: int, semitones: float) -> np.ndarray:
        """Shift formants independently of pitch using Parselmouth (Praat).

        This changes the resonance characteristics of the voice without
        affecting the fundamental frequency. It's what makes a voice
        sound naturally deeper vs just lower-pitched.
        """
        if abs(semitones) < 0.1:
            return audio

        import parselmouth
        from parselmouth.praat import call

        snd = parselmouth.Sound(audio, sampling_frequency=sr)
        factor = 2.0 ** (semitones / 12.0)

        # Use Praat's Change Gender function for formant shifting
        # (only shifts formants, pitch ratio set to 1.0 to keep pitch unchanged)
        shifted = call(
            snd, "Change gender",
            75,     # min pitch Hz
            600,    # max pitch Hz
            factor, # formant shift ratio
            0,      # new pitch median (0 = unchanged)
            1.0,    # pitch range factor
            1.0,    # duration factor
        )
        return shifted.values[0]

    @staticmethod
    def _apply_pitch_shift(audio: np.ndarray, sr: int, semitones: float) -> np.ndarray:
        """Shift pitch without changing speed."""
        if abs(semitones) < 0.1:
            return audio
        return librosa.effects.pitch_shift(y=audio, sr=sr, n_steps=semitones)

    @staticmethod
    def _apply_speed(audio: np.ndarray, speed: float) -> np.ndarray:
        """Change speed without changing pitch."""
        if abs(speed - 1.0) < 0.01:
            return audio
        return librosa.effects.time_stretch(y=audio, rate=speed)

    @staticmethod
    def _apply_pedalboard_effects(
        audio: np.ndarray,
        sr: int,
        params: VoiceLabParams,
    ) -> np.ndarray:
        """Apply EQ, compression, and reverb using Pedalboard."""
        effects: list = []

        # Bass boost (low shelf at 200Hz)
        if abs(params.bass_boost_db) > 0.1:
            effects.append(LowShelfFilter(
                cutoff_frequency_hz=200,
                gain_db=params.bass_boost_db,
            ))

        # Warmth (peak at 300Hz)
        if abs(params.warmth_db) > 0.1:
            effects.append(PeakFilter(
                cutoff_frequency_hz=300,
                gain_db=params.warmth_db,
                q=1.0,
            ))

        # Compression
        if params.compression > 1:
            threshold = -10 - (params.compression * 0.3)  # 0→-10dB, 100→-40dB
            ratio = 1 + (params.compression * 0.07)       # 0→1:1, 100→8:1
            effects.append(Compressor(
                threshold_db=threshold,
                ratio=ratio,
                attack_ms=10,
                release_ms=100,
            ))

        # Reverb
        if params.reverb > 1:
            effects.append(Reverb(
                room_size=min(params.reverb / 100, 0.95),
                wet_level=params.reverb / 100 * 0.5,
                dry_level=1.0 - params.reverb / 100 * 0.3,
                damping=0.5,
            ))

        if not effects:
            return audio

        board = Pedalboard(effects)
        # Pedalboard expects (channels, samples) shape
        if audio.ndim == 1:
            audio_2d = audio.reshape(1, -1)
        else:
            audio_2d = audio
        processed = board(audio_2d, sr)
        return processed[0] if audio.ndim == 1 else processed

    async def process(
        self,
        input_path: Path,
        params: VoiceLabParams,
        output_format: str = "mp3",
    ) -> Path:
        """Process audio with the given voice lab parameters.

        Applies effects in optimal order:
        0. Noise reduction (clean background first)
        1. Formant shift (changes resonance)
        2. Pitch shift (changes fundamental frequency)
        3. Speed change (time stretch)
        4. EQ, compression, reverb (pedalboard)

        Returns path to processed audio file.
        """
        file_id = str(uuid.uuid4())[:12]
        temp_wav = TEMP_DIR / f"{file_id}_lab.wav"
        output_path = OUTPUT_DIR / f"{file_id}.{output_format}"

        try:
            # Load audio
            audio, sr = await asyncio.to_thread(
                librosa.load, str(input_path), sr=_SR, mono=True,
            )

            logger.info("Voice lab processing: %d samples at %dHz", len(audio), sr)

            # 0. Noise reduction (must be first — clean signal before processing)
            if params.noise_reduction > 0:
                audio = await asyncio.to_thread(
                    self._apply_noise_reduction, audio, sr, params.noise_reduction,
                )
                logger.info("Noise reduction applied: %.0f%%", params.noise_reduction)

            # 1. Formant shift (works on clean signal)
            if abs(params.formant_shift) > 0.1:
                audio = await asyncio.to_thread(
                    self._apply_formant_shift, audio, sr, params.formant_shift,
                )
                logger.info("Formant shift applied: %.1f st", params.formant_shift)

            # 2. Pitch shift
            if abs(params.pitch_semitones) > 0.1:
                audio = await asyncio.to_thread(
                    self._apply_pitch_shift, audio, sr, params.pitch_semitones,
                )
                logger.info("Pitch shift applied: %.1f st", params.pitch_semitones)

            # 3. Speed change
            if abs(params.speed - 1.0) > 0.01:
                audio = await asyncio.to_thread(
                    self._apply_speed, audio, params.speed,
                )
                logger.info("Speed applied: %.2fx", params.speed)

            # 4. Pedalboard effects (EQ, compression, reverb)
            audio = await asyncio.to_thread(
                self._apply_pedalboard_effects, audio, sr, params,
            )
            logger.info("Pedalboard effects applied")

            # Normalize to prevent clipping
            peak = np.max(np.abs(audio))
            if peak > 0.95:
                audio = audio * (0.95 / peak)

            # Save temp WAV
            await asyncio.to_thread(sf.write, str(temp_wav), audio, sr)

            # Convert to output format
            if output_format == "wav":
                temp_wav.rename(output_path)
            else:
                from pydub import AudioSegment as PydubSegment
                from ..catalogs import AUDIO_FORMATS

                fmt = AUDIO_FORMATS.get(output_format, AUDIO_FORMATS["mp3"])
                segment = PydubSegment.from_wav(str(temp_wav))
                segment.export(
                    str(output_path),
                    format=fmt["format"],
                    codec=fmt["codec"],
                    parameters=fmt["parameters"],
                )
                temp_wav.unlink(missing_ok=True)

            logger.info("Voice lab output: %s", output_path)
            return output_path

        except Exception as exc:
            temp_wav.unlink(missing_ok=True)
            output_path.unlink(missing_ok=True)
            logger.error("Voice lab error: %s", exc)
            raise SynthesisError(f"Voice lab error: {exc}") from exc
