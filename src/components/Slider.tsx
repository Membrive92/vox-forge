import { colors, fonts } from "@/theme/tokens";

interface SliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

export function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  unit = "",
}: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: colors.textMuted, fontFamily: fonts.sans }}>
          {label}
        </span>
        <span
          style={{
            fontSize: 12,
            color: colors.text,
            fontFamily: fonts.mono,
            fontWeight: 600,
          }}
        >
          {value}
          {unit}
        </span>
      </div>
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
