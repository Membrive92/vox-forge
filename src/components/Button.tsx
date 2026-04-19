/**
 * Unified button primitive. Replaces the 8+ inline button styles in the app.
 *
 * Variants:
 *  - primary: main CTA (gradient blue)
 *  - secondary: lesser action (tinted background)
 *  - ghost: transparent background, border only
 *  - danger: destructive (red)
 *  - warning: experimental or irreversible (amber)
 *  - success: positive confirmation (green)
 *
 * Sizes: sm (28px), md (36px — default), lg (42px).
 *
 * All variants have a visible `:focus-visible` ring for keyboard users.
 * All have consistent disabled state, transitions, and hover brightness.
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { colors, fonts, radii, transitions, typography } from "@/theme/tokens";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "warning"
  | "success";

export type ButtonSize = "sm" | "md" | "lg";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  loading?: boolean;
  fullWidth?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  icon,
  loading = false,
  fullWidth = false,
  disabled,
  children,
  style,
  onClick,
  ...rest
}: Props) {
  const isDisabled = disabled || loading;
  const variantStyle = VARIANTS[variant];
  const sizeStyle = SIZES[size];

  const combinedStyle: React.CSSProperties = {
    ...baseStyle,
    ...sizeStyle,
    ...variantStyle,
    ...(fullWidth ? { width: "100%" } : {}),
    ...(isDisabled ? { opacity: 0.5, cursor: "default", pointerEvents: "none" } : {}),
    ...style,
  };

  return (
    <button
      {...rest}
      disabled={isDisabled}
      onClick={onClick}
      className={`vf-btn vf-btn-${variant}`}
      style={combinedStyle}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

// ── Styles ──────────────────────────────────────────────────────────

const baseStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  border: "none",
  borderRadius: radii.md,
  fontFamily: fonts.sans,
  fontWeight: typography.weight.semibold,
  cursor: "pointer",
  transition: transitions.fast,
  whiteSpace: "nowrap",
  userSelect: "none",
};

const SIZES: Record<ButtonSize, React.CSSProperties> = {
  sm: {
    padding: "6px 12px",
    fontSize: typography.size.xs,
    minHeight: 28,
  },
  md: {
    padding: "10px 16px",
    fontSize: typography.size.sm,
    minHeight: 36,
  },
  lg: {
    padding: "14px 22px",
    fontSize: typography.size.base,
    minHeight: 42,
  },
};

const VARIANTS: Record<ButtonVariant, React.CSSProperties> = {
  primary: {
    background: `linear-gradient(135deg, ${colors.primary}, ${colors.primaryDim})`,
    color: "#fff",
    boxShadow: "0 2px 12px rgba(59,130,246,0.25)",
  },
  secondary: {
    background: colors.primarySoft,
    color: colors.primaryLight,
    border: `1px solid ${colors.primaryBorder}`,
  },
  ghost: {
    background: "transparent",
    color: colors.textMuted,
    border: `1px solid ${colors.border}`,
  },
  danger: {
    background: colors.dangerSoft,
    color: colors.danger,
    border: `1px solid ${colors.dangerBorder}`,
  },
  warning: {
    background: `linear-gradient(135deg, ${colors.warning}, #d97706)`,
    color: "#fff",
    boxShadow: "0 2px 12px rgba(245,158,11,0.3)",
  },
  success: {
    background: `linear-gradient(135deg, ${colors.success}, #059669)`,
    color: "#fff",
    boxShadow: "0 2px 12px rgba(16,185,129,0.3)",
  },
};

// ── Spinner ─────────────────────────────────────────────────────────

function Spinner() {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: 14,
        height: 14,
        border: "2px solid currentColor",
        borderRightColor: "transparent",
        borderRadius: "50%",
        animation: "vf-spin 0.7s linear infinite",
      }}
    />
  );
}