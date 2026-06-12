import { useId, useState } from "react";

import { colors, fonts, typography } from "@/theme/tokens";

const DEGRADED_COLOR = "#f59e0b";

interface SliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  info?: string | undefined;
  /** Values below this are marked as a quality-degraded zone. */
  degradedBelow?: number;
  /** Values above this are marked as a quality-degraded zone. */
  degradedAbove?: number;
  /** Warning shown while the value sits inside a degraded zone. */
  degradedInfo?: string;
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
  degradedBelow,
  degradedAbove,
  degradedInfo,
}: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100;
  const [showInfo, setShowInfo] = useState(false);
  const infoId = useId();

  const toPct = (v: number): number => ((v - min) / (max - min)) * 100;
  const isDegraded =
    (degradedBelow !== undefined && value < degradedBelow) ||
    (degradedAbove !== undefined && value > degradedAbove);

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, alignItems: "center" }}>
        <span style={{ fontSize: typography.size.sm, color: colors.textMuted, fontFamily: fonts.sans, display: "flex", alignItems: "center", gap: 6 }}>
          {label}
          {info && (
            <button
              type="button"
              aria-label={label}
              aria-expanded={showInfo}
              aria-controls={infoId}
              onMouseEnter={() => setShowInfo(true)}
              onMouseLeave={() => setShowInfo(false)}
              onClick={() => setShowInfo((v) => !v)}
              style={{
                width: 16,
                height: 16,
                padding: 0,
                border: "none",
                borderRadius: "50%",
                background: showInfo ? colors.primary : "rgba(148,163,184,0.15)",
                color: showInfo ? "#fff" : colors.textDim,
                fontSize: typography.size.xs,
                fontWeight: 700,
                fontFamily: "inherit",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                transition: "all 0.2s",
                flexShrink: 0,
              }}
            >
              i
            </button>
          )}
        </span>
        <span
          style={{
            fontSize: typography.size.sm,
            color: isDegraded ? DEGRADED_COLOR : colors.text,
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
          id={infoId}
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
      {isDegraded && degradedInfo && (
        <div
          role="alert"
          style={{
            fontSize: typography.size.xs,
            color: DEGRADED_COLOR,
            background: "rgba(245,158,11,0.08)",
            border: "1px solid rgba(245,158,11,0.35)",
            borderRadius: 6,
            padding: "8px 10px",
            marginBottom: 8,
            lineHeight: 1.5,
          }}
        >
          {degradedInfo}
        </div>
      )}
      <div style={{ position: "relative", height: 6, background: colors.textDark, borderRadius: 3 }}>
        {degradedBelow !== undefined && degradedBelow > min && (
          <div
            data-testid="slider-degraded-low"
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              height: "100%",
              width: `${toPct(degradedBelow)}%`,
              background: "rgba(245,158,11,0.3)",
              borderRadius: "3px 0 0 3px",
            }}
          />
        )}
        {degradedAbove !== undefined && degradedAbove < max && (
          <div
            data-testid="slider-degraded-high"
            style={{
              position: "absolute",
              right: 0,
              top: 0,
              height: "100%",
              width: `${100 - toPct(degradedAbove)}%`,
              background: "rgba(245,158,11,0.3)",
              borderRadius: "0 3px 3px 0",
            }}
          />
        )}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            height: "100%",
            width: `${pct}%`,
            background: isDegraded
              ? `linear-gradient(90deg, ${colors.primary}, ${DEGRADED_COLOR})`
              : `linear-gradient(90deg, ${colors.primary}, ${colors.primaryLight})`,
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
            background: isDegraded ? DEGRADED_COLOR : colors.primary,
            borderRadius: "50%",
            transform: "translate(-50%, -50%)",
            boxShadow: isDegraded ? "0 0 8px rgba(245,158,11,0.5)" : "0 0 8px rgba(59,130,246,0.5)",
            transition: "left 0.15s ease",
            border: `2px solid ${colors.text}`,
            pointerEvents: "none",
          }}
        />
      </div>
    </div>
  );
}
