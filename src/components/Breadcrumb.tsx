/**
 * Breadcrumb — horizontal path indicator.
 *
 * Takes a list of items (each with label + optional onClick) and renders
 * them separated by a chevron. The last item is the current location and
 * is styled as non-interactive even if onClick is provided.
 */
import type { ReactNode } from "react";

import { colors, fonts, space, typography } from "@/theme/tokens";

export interface BreadcrumbItem {
  label: ReactNode;
  onClick?: () => void;
  title?: string;
}

interface Props {
  items: readonly BreadcrumbItem[];
}

export function Breadcrumb({ items }: Props) {
  if (items.length === 0) return null;
  return (
    <nav
      aria-label="Breadcrumb"
      style={{
        display: "flex",
        alignItems: "center",
        gap: space[2],
        fontSize: typography.size.sm,
        color: colors.textDim,
        fontFamily: fonts.sans,
        marginBottom: space[3],
        minHeight: 20,
      }}
    >
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1;
        const clickable = !isLast && item.onClick !== undefined;
        return (
          <span key={idx} style={{ display: "flex", alignItems: "center", gap: space[2] }}>
            {idx > 0 && (
              <span aria-hidden style={{ color: colors.textFaint }}>›</span>
            )}
            {clickable ? (
              <button
                onClick={item.onClick}
                title={item.title}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  color: colors.textMuted,
                  fontFamily: fonts.sans,
                  fontSize: typography.size.sm,
                  cursor: "pointer",
                }}
              >
                {item.label}
              </button>
            ) : (
              <span
                title={item.title}
                style={{
                  color: isLast ? colors.text : colors.textMuted,
                  fontWeight: isLast ? typography.weight.semibold : typography.weight.regular,
                }}
              >
                {item.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
