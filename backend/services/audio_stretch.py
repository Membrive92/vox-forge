"""Shared policy for post-synthesis time-stretching (Rubber Band).

Every DSP speed change in VoxForge goes through pedalboard's
``time_stretch`` (the Rubber Band library): a single formant-preserving
pass, far above phase-vocoder quality. Two hard rules live here:

1. **Single pass.** Pitch and speed are combined into ONE Rubber Band
   call — never two stacked stretches, each pass costs quality.
2. **±25% clamp.** Beyond a 0.75–1.25× stretch any algorithm audibly
   breaks speech, so the effective factor is clamped to that range
   (with a warning when the requested value exceeds it).

Product note: listener-side speed (0.75–2×) belongs to the *player*
(client-side and reversible — the InteractivePlayer already offers it).
These knobs only adjust the narrator's cadence; ±10–15% is the useful
range. Edge-TTS's ``rate`` is prosodic re-synthesis, not DSP, and keeps
its full 50–200% range.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

# Safe range for any post-synthesis DSP stretch factor.
STRETCH_SAFE_MIN = 0.75
STRETCH_SAFE_MAX = 1.25


def clamp_stretch_factor(factor: float) -> float:
    """Clamp a stretch factor to the safe range, warning when exceeded."""
    clamped = min(max(factor, STRETCH_SAFE_MIN), STRETCH_SAFE_MAX)
    if clamped != factor:
        logger.warning(
            "Requested stretch factor %.2f exceeds the safe range "
            "[%.2f, %.2f]; clamping to %.2f. Listener speed belongs to "
            "the player — this knob is narrator cadence only.",
            factor, STRETCH_SAFE_MIN, STRETCH_SAFE_MAX, clamped,
        )
    return clamped
