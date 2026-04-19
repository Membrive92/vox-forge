/**
 * EmptyState — centered hero for "nothing here yet" moments.
 *
 * Use when a tab or section has no content to show:
 *  - Workbench with no project selected
 *  - Profile list with zero profiles
 *  - Chunk map before synthesis
 *
 * Renders a large icon, a title, an explanatory paragraph, and an
 * optional primary action. Much more useful than "Select a project"
 * text in 12px gray.
 */
import type { ReactNode } from "react";

import { colors, fonts, space, typography } from "@/theme/tokens";

interface Props {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  children?: ReactNode;
  compact?: boolean;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  children,
  compact = false,
}: Props) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: compact ? `${space[6]}px ${space[4]}px` : `${space[10]}px ${space[5]}px`,
        minHeight: compact ? "auto" : 320,
        gap: space[3],
      }}
    >
      {icon && (
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: "50%",
            background: colors.surfaceAlt,
            border: `1px solid ${colors.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: colors.textMuted,
            marginBottom: space[1],
          }}
        >
          <div style={{ transform: "scale(1.5)" }}>{icon}</div>
        </div>
      )}
      <h2
        style={{
          margin: 0,
          fontSize: typography.size.lg,
          fontWeight: typography.weight.bold,
          color: colors.text,
          fontFamily: fonts.sans,
        }}
      >
        {title}
      </h2>
      {description && (
        <p
          style={{
            margin: 0,
            fontSize: typography.size.sm,
            color: colors.textDim,
            maxWidth: 440,
            lineHeight: typography.leading.normal,
            fontFamily: fonts.sans,
          }}
        >
          {description}
        </p>
      )}
      {action && <div style={{ marginTop: space[2] }}>{action}</div>}
      {children}
    </div>
  );
}
