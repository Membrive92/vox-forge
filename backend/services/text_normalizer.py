"""Text normalization for optimal TTS output.

Converts raw text into a form that a voice model reads fluently:
no abbreviations, no numbers, no ALL-CAPS, no decorative punctuation,
no formatting artifacts. The output reads like a narrator would speak it.
"""
from __future__ import annotations

import re

# ──────────────────────────────────────────────────────────────────────
# Spanish abbreviation expansion
# ──────────────────────────────────────────────────────────────────────

_ABBREVIATIONS_ES: dict[str, str] = {
    # Titles
    "Dr.": "Doctor",
    "Dra.": "Doctora",
    "Sr.": "Señor",
    "Sra.": "Señora",
    "Srta.": "Señorita",
    "Prof.": "Profesor",
    "Profa.": "Profesora",
    "Lic.": "Licenciado",
    "Ing.": "Ingeniero",
    "Arq.": "Arquitecto",
    "Gral.": "General",
    "Cnel.": "Coronel",
    "Cap.": "Capitán",
    "Tte.": "Teniente",
    "Sgto.": "Sargento",
    # Common
    "etc.": "etcétera",
    "pág.": "página",
    "págs.": "páginas",
    "núm.": "número",
    "vol.": "volumen",
    "cap.": "capítulo",
    "fig.": "figura",
    "aprox.": "aproximadamente",
    "tel.": "teléfono",
    "dept.": "departamento",
    "depto.": "departamento",
    "admón.": "administración",
    "ctro.": "centro",
    # Places
    "Av.": "Avenida",
    "Avda.": "Avenida",
    "c/": "calle",
    "C/": "Calle",
    "Pza.": "Plaza",
    "Ctra.": "Carretera",
    # Time
    "a.m.": "de la mañana",
    "p.m.": "de la tarde",
    "a.C.": "antes de Cristo",
    "d.C.": "después de Cristo",
}

# Measure abbreviations: only expanded when preceded by a number (e.g. "5 km").
# These are NOT in the main dict because single letters like "m", "s", "g"
# would match inside normal words and corrupt them.
_MEASURE_ABBREVS: dict[str, str] = {
    "km": "kilómetros",
    "m": "metros",
    "cm": "centímetros",
    "mm": "milímetros",
    "kg": "kilogramos",
    "g": "gramos",
    "mg": "miligramos",
    "l": "litros",
    "ml": "mililitros",
    "h": "horas",
    "min": "minutos",
    "s": "segundos",
}

# Sorted longest first to avoid partial matches (e.g. "Sra." before "Sr.")
_ABBREV_SORTED = sorted(_ABBREVIATIONS_ES.items(), key=lambda x: -len(x[0]))

# ──────────────────────────────────────────────────────────────────────
# Number to words (Spanish)
# ──────────────────────────────────────────────────────────────────────

_UNITS_ES = {
    "0": "cero", "1": "uno", "2": "dos", "3": "tres", "4": "cuatro",
    "5": "cinco", "6": "seis", "7": "siete", "8": "ocho", "9": "nueve",
    "10": "diez", "11": "once", "12": "doce", "13": "trece", "14": "catorce",
    "15": "quince", "16": "dieciséis", "17": "diecisiete", "18": "dieciocho",
    "19": "diecinueve", "20": "veinte", "21": "veintiuno", "22": "veintidós",
    "23": "veintitrés", "24": "veinticuatro", "25": "veinticinco",
    "26": "veintiséis", "27": "veintisiete", "28": "veintiocho", "29": "veintinueve",
}
_TENS_ES = {
    "30": "treinta", "40": "cuarenta", "50": "cincuenta", "60": "sesenta",
    "70": "setenta", "80": "ochenta", "90": "noventa",
}
_HUNDREDS_ES = [
    "", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos",
    "seiscientos", "setecientos", "ochocientos", "novecientos",
]


def _number_to_words_es(n: int) -> str:
    """Convert an integer (0-999999) to Spanish words."""
    if n < 0:
        return f"menos {_number_to_words_es(-n)}"
    s = str(n)
    if s in _UNITS_ES:
        return _UNITS_ES[s]
    if n < 100:
        tens = (n // 10) * 10
        units = n % 10
        t = _TENS_ES.get(str(tens), "")
        if units == 0:
            return t
        return f"{t} y {_UNITS_ES[str(units)]}"
    if n == 100:
        return "cien"
    if n < 1000:
        h = _HUNDREDS_ES[n // 100]
        rest = n % 100
        if rest == 0:
            return h
        return f"{h} {_number_to_words_es(rest)}"
    if n < 1000000:
        th = n // 1000
        rest = n % 1000
        prefix = "mil" if th == 1 else f"{_number_to_words_es(th)} mil"
        if rest == 0:
            return prefix
        return f"{prefix} {_number_to_words_es(rest)}"
    return str(n)  # Fallback for very large numbers


# ──────────────────────────────────────────────────────────────────────
# Siglas / acronyms
# ──────────────────────────────────────────────────────────────────────

_KNOWN_SIGLAS: dict[str, str] = {
    "ONU": "O ene u",
    "OTAN": "O te a ene",
    "UE": "U e",
    "EEUU": "Estados Unidos",
    "EE.UU.": "Estados Unidos",
    "FBI": "efe be i",
    "CIA": "ce i a",
    "NASA": "nasa",
    "COVID": "covid",
    "ADN": "a de ene",
    "IVA": "i uve a",
    "DNI": "de ene i",
    "GPS": "ye pe ese",
    "PDF": "pe de efe",
    "USB": "u ese be",
    "URL": "u erre ele",
    "TV": "tele",
    "CD": "ce de",
    "DVD": "de uve de",
}


def _expand_siglas(text: str) -> str:
    """Replace known acronyms with their spoken form."""
    for sigla, expansion in _KNOWN_SIGLAS.items():
        text = re.sub(rf"\b{re.escape(sigla)}\b", expansion, text)
    return text


def _spell_unknown_siglas(text: str) -> str:
    """Spell out remaining ALL-CAPS words (2-5 letters) letter by letter."""
    _LETTER_NAMES = {
        "A": "a", "B": "be", "C": "ce", "D": "de", "E": "e", "F": "efe",
        "G": "ge", "H": "hache", "I": "i", "J": "jota", "K": "ka", "L": "ele",
        "M": "eme", "N": "ene", "O": "o", "P": "pe", "Q": "cu", "R": "erre",
        "S": "ese", "T": "te", "U": "u", "V": "uve", "W": "uve doble",
        "X": "equis", "Y": "ye", "Z": "zeta",
    }

    def _spell(m: re.Match) -> str:
        word = m.group(0)
        if len(word) > 5:
            # Likely a real word in caps, title-case it
            return word[0] + word[1:].lower()
        letters = [_LETTER_NAMES.get(c, c) for c in word]
        return " ".join(letters)

    return re.sub(r"\b[A-ZÁÉÍÓÚÑÜ]{2,}\b", _spell, text)


# ──────────────────────────────────────────────────────────────────────
# Roman numerals
# ──────────────────────────────────────────────────────────────────────

_ROMAN_MAP = [
    (1000, "M"), (900, "CM"), (500, "D"), (400, "CD"),
    (100, "C"), (90, "XC"), (50, "L"), (40, "XL"),
    (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I"),
]


def _roman_to_int(s: str) -> int | None:
    """Convert a roman numeral string to int, or None if invalid."""
    result = 0
    remaining = s.upper()
    for value, numeral in _ROMAN_MAP:
        while remaining.startswith(numeral):
            result += value
            remaining = remaining[len(numeral):]
    return result if not remaining and result > 0 else None


def _expand_roman_numerals(text: str) -> str:
    """Convert roman numerals to words.

    Handles two patterns:
    1. Enumeration style: "I.", "II.", "III)" etc. (roman + punctuation)
    2. Multi-char roman: "IV", "XII", "XIX" etc. (2+ chars, no context needed)
    """
    # Pattern 1: single or multi roman numeral followed by . or ) (enumeration)
    def _replace_enum(m: re.Match) -> str:
        val = _roman_to_int(m.group(1))
        if val is not None and val <= 50:
            return _number_to_words_es(val) + m.group(2)
        return m.group(0)
    text = re.sub(r"\b([IVXLCDM]+)([.)]\s)", _replace_enum, text)

    # Pattern 2: multi-char roman numerals standing alone (2+ chars)
    def _replace_standalone(m: re.Match) -> str:
        val = _roman_to_int(m.group(0))
        if val is not None and val <= 50:
            return _number_to_words_es(val)
        return m.group(0)
    text = re.sub(r"\b[IVXLCDM]{2,}\b", _replace_standalone, text)

    return text


# ──────────────────────────────────────────────────────────────────────
# Main normalizer
# ──────────────────────────────────────────────────────────────────────

def normalize_for_tts(text: str) -> str:
    """Full text normalization for TTS.

    Converts raw text into narrator-ready form:
    1. Expand abbreviations (Dr. → Doctor)
    2. Expand numbers to words (42 → cuarenta y dos)
    3. Expand known siglas (ONU → O ene u)
    4. Spell out unknown siglas (ASC → a ese ce)
    5. Expand roman numerals (IV → cuatro)
    6. Normalize punctuation (remove decorative chars)
    7. Normalize line breaks
    8. Clean up whitespace

    The result reads like a narrator would speak it aloud.
    """
    # 1. Single newlines → spaces (preserve paragraph breaks)
    text = re.sub(r"(?<!\n)\n(?!\n)", " ", text)

    # 2. Expand abbreviations (before number processing)
    for abbrev, expansion in _ABBREV_SORTED:
        text = text.replace(abbrev, expansion)

    # 2b. Expand measure units only when preceded by a digit (e.g. "5 km")
    for unit, expansion in sorted(_MEASURE_ABBREVS.items(), key=lambda x: -len(x[0])):
        text = re.sub(rf"(\d)\s*{re.escape(unit)}\b", rf"\1 {expansion}", text)

    # 3. Numbers to words
    def _num_replace(m: re.Match) -> str:
        n = int(m.group(0))
        if n > 999999:
            return m.group(0)
        return _number_to_words_es(n)
    text = re.sub(r"\b\d+\b", _num_replace, text)

    # 4. Expand known siglas
    text = _expand_siglas(text)

    # 5. Expand roman numerals (before caps normalization)
    text = _expand_roman_numerals(text)

    # 6. Spell or title-case remaining ALL-CAPS
    text = _spell_unknown_siglas(text)

    # 7. Special characters and legal/document symbols
    text = text.replace("\u00a7", "sección")   # §
    text = text.replace("\u00b6", "párrafo")   # ¶
    text = text.replace("\u00a9", "copyright") # ©
    text = text.replace("\u00ae", "registrado") # ®
    text = text.replace("\u2122", "marca registrada") # ™
    text = text.replace("\u00b0", " grados")   # °
    text = text.replace("\u00ba", "")           # º (ordinal masculino)
    text = text.replace("\u00aa", "")           # ª (ordinal femenino)
    text = text.replace("\u2022", ",")          # • bullet
    text = text.replace("\u2023", ",")          # ‣ triangle bullet
    text = text.replace("\u25cf", ",")          # ● black circle
    text = text.replace("\u25cb", ",")          # ○ white circle
    text = text.replace("\u2013", ",")          # – (en dash, also below)
    text = text.replace("\u00b7", ",")          # · middle dot

    # 8. Normalize punctuation
    text = text.replace("...", ".")
    text = text.replace("\u2026", ".")     # …
    text = text.replace("\u2014", ",")     # —
    text = text.replace("\u2013", ",")     # –
    text = text.replace(" - ", ", ")
    text = re.sub(r"(?<=\w)-(?=\w)", " ", text)  # word-word → word word
    text = re.sub(r"^-\s*", "", text, flags=re.MULTILINE)  # Dialog dash
    text = text.replace("-", " ")
    text = text.replace('"', "")
    text = text.replace("\u201c", "")      # "
    text = text.replace("\u201d", "")      # "
    text = text.replace("'", "")
    text = text.replace("\u2018", "")      # '
    text = text.replace("\u2019", "")      # '
    text = text.replace("\u00ab", "")      # «
    text = text.replace("\u00bb", "")      # »
    text = text.replace("(", ",")
    text = text.replace(")", ",")
    text = text.replace("[", "")
    text = text.replace("]", "")
    text = text.replace("{", "")
    text = text.replace("}", "")
    text = text.replace(":", ".")
    text = text.replace(";", ".")
    text = text.replace("/", " ")
    text = text.replace("\\", " ")
    text = text.replace("#", " número ")
    text = text.replace("&", " y ")
    text = text.replace("%", " por ciento")
    text = text.replace("@", " arroba ")
    text = text.replace("*", "")
    text = text.replace("_", " ")
    text = text.replace("~", "")
    text = text.replace("^", "")
    text = text.replace("|", ",")
    text = text.replace("`", "")
    text = text.replace("=", " igual ")
    text = text.replace("+", " mas ")
    text = text.replace("<", " menor que ")
    text = text.replace(">", " mayor que ")

    # 9. Clean up punctuation
    text = re.sub(r"([,.])\1+", r"\1", text)
    text = re.sub(r"^\s*,\s*", "", text)
    text = re.sub(r"\.\s*,", ".", text)
    text = re.sub(r",\s*\.", ".", text)
    text = re.sub(r" {2,}", " ", text)

    # 10. Lowercase everything, then capitalize first letter after each period.
    # This prevents XTTS from interpreting random capitals as acronyms.
    text = text.lower()
    # Capitalize after sentence boundaries (. ! ? and start of text)
    text = re.sub(r"(^|[.!?]\s+)([a-záéíóúñü])", lambda m: m.group(1) + m.group(2).upper(), text)

    return text.strip()
