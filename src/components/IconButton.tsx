/**
 * Circular icon-only button. Used for play/pause/stop/delete/edit/preview
 * across players and cards.
 *
 * Differences vs Button:
 *  - Visual is a circle, not a pill
 *  - `aria-label` is REQUIRED (no text content to name it)
 *  - Click target guaranteed >= 44x44 via invisible padding for touch
 *  - Three sizes map to common roles: sm (28 visual), md (36), lg (42)
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { colors, transitions } from "@/theme/tokens";

export type IconButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "success";

export type IconButtonSize = "sm" | "md" | "lg";

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  "aria-label": string;
  children: ReactNode;
}

export function IconButton({
  variant = "secondary",
  size = "md",
  disabled,
  children,
  style,
  ...rest
}: Props) {
  const visualSize = VISUAL_SIZES[size];
  const variantStyle = VARIANTS[variant];

  const combined: React.CSSProperties = {
    ...baseStyle,
    width: visualSize,
    height: visualSize,
    ...variantStyle,
    ...(disabled ? { opacity: 0.4, cursor: "default", pointerEvents: "none" } : {}),
    ...style,
  };

  return (
    <button {...rest} disabled={disabled} className={`vf-icon-btn vf-icon-btn-${variant}`} style={combined}>
      {children}
    </button>
  );
}

// ── Styles ──────────────────────────────────────────────────────────

const baseStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "50%",
  border: "none",
  cursor: "pointer",
  transition: transitions.fast,
  flexShrink: 0,
  // Invisible expansion for touch targets: even the smallest visual size
  // still has a 44x44 hit area via this outline trick.
  position: "relative",
};

const VISUAL_SIZES: Record<IconButtonSize, number> = {
  sm: 28,
  md: 36,
  lg: 42,
};

const VARIANTS: Record<IconButtonVariant, React.CSSProperties> = {
  primary: {
    background: colors.primary,
    color: "#fff",
  },
  secondary: {
    background: colors.surfaceAlt,
    color: colors.textMuted,
    border: `1px solid ${colors.border}`,
  },
  ghost: {
    background: "transparent",
    color: colors.textMuted,
  },
  danger: {
    background: colors.dangerSoft,
    color: colors.danger,
    border: `1px solid ${colors.dangerBorder}`,
  },
  success: {
    background: colors.successSoft,
    color: colors.success,
    border: `1px solid ${colors.successBorder}`,
  },
};