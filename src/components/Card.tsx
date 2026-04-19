/**
 * Card primitive. Sustituye la repetición del patrón
 *   { background: colors.surface, border: `1px solid ${colors.border}`,
 *     borderRadius: radii.xl, padding: 24, backdropFilter: "blur(12px)" }
 * que aparece en 20+ sitios.
 */
import type { HTMLAttributes, ReactNode } from "react";

import { colors, radii, space } from "@/theme/tokens";

export type CardPadding = "none" | "sm" | "md" | "lg";

interface Props extends HTMLAttributes<HTMLDivElement> {
  padding?: CardPadding;
  glass?: boolean;
  subtle?: boolean;
  children?: ReactNode;
}

export function Card({
  padding = "md",
  glass = true,
  subtle = false,
  style,
  children,
  ...rest
}: Props) {
  const combined: React.CSSProperties = {
    background: subtle ? colors.surfaceSubtle : colors.surface,
    border: `1px solid ${subtle ? colors.borderFaint : colors.border}`,
    borderRadius: radii.xl,
    padding: PADDING[padding],
    ...(glass ? { backdropFilter: "blur(12px)" } : {}),
    ...style,
  };

  return (
    <div {...rest} className={`vf-card ${rest.className ?? ""}`.trim()} style={combined}>
      {children}
    </div>
  );
}

const PADDING: Record<CardPadding, number> = {
  none: 0,
  sm: space[3],
  md: space[5],
  lg: space[6],
};