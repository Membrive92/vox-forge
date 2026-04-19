/**
 * Audio Tools tab (Phase 2).
 *
 * Replaces the separate Convert and Lab tabs with a unified tab that
 * has two modes:
 *  - "Change Voice" — OpenVoice voice conversion (timbre transfer)
 *  - "Effects" — DSP chain (pitch, formant, noise reduction, reverb, ...)
 *
 * The mode toggle lives at the top. Below it, we render the corresponding
 * tab component unchanged. This composition approach avoids duplicating
 * the substantial logic (presets, DSP params, file handling) in each
 * child and keeps the migration scope narrow.
 *
 * The 3 DSP sliders shared between modes (pitch, formant, bass boost)
 * are duplicated at the component level today; a deeper refactor could
 * hoist them to this wrapper, but that's out of scope for Phase 2.
 */
import { useState } from "react";

import type { Translations } from "@/i18n";
import { colors, fonts, radii, typography } from "@/theme/tokens";
import type { Profile } from "@/types/domain";

import { ConvertTab } from "./ConvertTab";
import { LabTab } from "./LabTab";

type Mode = "change-voice" | "effects";

interface Props {
  t: Translations;
  profiles: readonly Profile[];
  onToast: (msg: string) => void;
}

export function AudioToolsTab({ t, profiles, onToast }: Props) {
  const [mode, setMode] = useState<Mode>("change-voice");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Mode toggle */}
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: radii.xl,
          padding: 6,
          display: "flex",
          gap: 6,
        }}
      >
        <ModeButton
          active={mode === "change-voice"}
          label={t.audioToolsChangeVoice}
          description={t.audioToolsChangeVoiceDesc}
          onClick={() => setMode("change-voice")}
        />
        <ModeButton
          active={mode === "effects"}
          label={t.audioToolsEffects}
          description={t.audioToolsEffectsDesc}
          onClick={() => setMode("effects")}
        />
      </div>

      {/* Mode content */}
      {mode === "change-voice" ? (
        <ConvertTab t={t} profiles={profiles} onToast={onToast} />
      ) : (
        <LabTab t={t} onToast={onToast} />
      )}
    </div>
  );
}

interface ModeButtonProps {
  active: boolean;
  label: string;
  description: string;
  onClick: () => void;
}

function ModeButton({ active, label, description, onClick }: ModeButtonProps) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      style={{
        flex: 1,
        padding: "14px 20px",
        borderRadius: radii.lg,
        background: active
          ? `linear-gradient(135deg, ${colors.primary}, ${colors.primaryDim})`
          : "transparent",
        border: "none",
        color: active ? "#fff" : colors.textDim,
        cursor: "pointer",
        fontFamily: fonts.sans,
        textAlign: "left",
        transition: "all 0.2s",
      }}
    >
      <div
        style={{
          fontSize: typography.size.base,
          fontWeight: 700,
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: typography.size.xs,
          opacity: active ? 0.85 : 0.7,
          fontWeight: 500,
        }}
      >
        {description}
      </div>
    </button>
  );
}
