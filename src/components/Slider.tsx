import { useState } from "react";

import { colors, fonts, typography } from "@/theme/tokens";

interface SliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  info?: string | undefined;
}

export function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  unit = "",
  info,
}: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100;
  const [showInfo, setShowInfo] = useState(false);

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, alignItems: "center" }}>
        <span style={{ fontSize: typography.size.sm, color: colors.textMuted, fontFamily: fonts.sans, display: "flex", alignItems: "center", gap: 6 }}>
          {label}
          {info && (
            <span
              onMouseEnter={() => setShowInfo(true)}
              onMouseLeave={() => setShowInfo(false)}
              onClick={() => setShowInfo((v) => !v)}
              style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: showInfo ? colors.primary : "rgba(148,163,184,0.15)",
                color: showInfo ? "#fff" : colors.textDim,
                fontSize: typography.size.xs,
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                transition: "all 0.2s",
                flexShrink: 0,
              }}
            >
              i
            </span>
          )}
        </span>
        <span
          style={{
            fontSize: typography.size.sm,
            color: colors.text,
            fontFamily: fonts.mono,
            fontWeight: 600,
          }}
        >
          {value}
          {unit}
        </span>
      </div>
      {showInfo && info && (
        <div
          style={{
            fontSize: typography.size.xs,
            color: colors.textMuted,
            background: "rgba(30,41,59,0.8)",
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            padding: "8px 10px",
            marginBottom: 8,
            lineHeight: 1.5,
          }}
        >
          {info}
        </div>
      )}
      <div style={{ position: "relative", height: 6, background: colors.textDark, borderRadius: 3 }}>
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            height: "100%",
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${colors.primary}, ${colors.primaryLight})`,
            borderRadius: 3,
            transition: "width 0.15s ease",
          }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={label}
          style={{
            position: "absolute",
            top: -8,
            left: 0,
            width: "100%",
            height: 22,
            opacity: 0,
            cursor: "pointer",
            zIndex: 2,
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: `${pct}%`,
            width: 14,
            height: 14,
            background: colors.primary,
            borderRadius: "50%",
            transform: "translate(-50%, -50%)",
            boxShadow: "0 0 8px rgba(59,130,246,0.5)",
            transition: "left 0.15s ease",
            border: `2px solid ${colors.text}`,
            pointerEvents: "none",
          }}
        />
      </div>
    </div>
  );
}
