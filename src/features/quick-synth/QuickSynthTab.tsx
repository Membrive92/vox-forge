/**
 * Quick Synth tab (Phase 3).
 *
 * Replaces the separate Synth and Experimental tabs. The "Use voice sample"
 * toggle at the top switches between:
 *  - Standard TTS (SynthTab): text -> system voice or saved profile -> audio
 *  - Cross-lingual cloning (ExperimentalTab): text + voice sample + target
 *    language -> audio in that language with the sample's timbre
 *
 * Same composition approach as Phase 2 (Audio Tools): the wrapper owns only
 * the mode toggle; the child components are rendered unchanged.
 */
import { useState } from "react";

import type { Translations } from "@/i18n";
import { colors, fonts, radii } from "@/theme/tokens";

import type { SynthSettings } from "../state";

import { ExperimentalTab } from "./ExperimentalTab";
import { SynthTab } from "./SynthTab";

type Mode = "standard" | "cross-lingual";

interface Props {
  t: Translations;
  text: string;
  setText: (v: string) => void;
  settings: SynthSettings;
  onToast: (msg: string) => void;
}

export function QuickSynthTab({ t, text, setText, settings, onToast }: Props) {
  const [mode, setMode] = useState<Mode>("standard");

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
          active={mode === "standard"}
          label={t.tabSynth}
          description="Voces del sistema o perfiles guardados"
          onClick={() => setMode("standard")}
        />
        <ModeButton
          active={mode === "cross-lingual"}
          label={t.crossLingualMode}
          description="Clonar una muestra en otro idioma (experimental)"
          onClick={() => setMode("cross-lingual")}
          warning
        />
      </div>

      {/* Mode content */}
      {mode === "standard" ? (
        <SynthTab
          t={t}
          text={text}
          setText={setText}
          settings={settings}
          onToast={onToast}
        />
      ) : (
        <ExperimentalTab t={t} onToast={onToast} />
      )}
    </div>
  );
}

interface ModeButtonProps {
  active: boolean;
  label: string;
  description: string;
  warning?: boolean;
  onClick: () => void;
}

function ModeButton({ active, label, description, warning, onClick }: ModeButtonProps) {
  const activeGradient = warning
    ? "linear-gradient(135deg, #f59e0b, #d97706)"
    : `linear-gradient(135deg, ${colors.primary}, ${colors.primaryDim})`;

  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      style={{
        flex: 1,
        padding: "14px 20px",
        borderRadius: radii.lg,
        background: active ? activeGradient : "transparent",
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
          fontSize: 14,
          fontWeight: 700,
          marginBottom: 2,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        {label}
        {warning && (
          <span
            style={{
              fontSize: 8,
              fontWeight: 700,
              padding: "2px 6px",
              borderRadius: 3,
              background: active ? "rgba(0,0,0,0.2)" : "rgba(245,158,11,0.15)",
              color: active ? "#fff" : "#f59e0b",
              textTransform: "uppercase",
              letterSpacing: "1px",
              fontFamily: fonts.mono,
            }}
          >
            EXP
          </span>
        )}
      </div>
      <div style={{ fontSize: 11, opacity: active ? 0.85 : 0.7, fontWeight: 500 }}>
        {description}
      </div>
    </button>
  );
}
