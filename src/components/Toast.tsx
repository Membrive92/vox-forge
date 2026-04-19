/**
 * Toast stack — renders a vertical column of toasts in the top-right corner.
 *
 * Each toast has:
 *  - Type-specific icon + color (info / success / warning / error)
 *  - Message
 *  - Dismiss × button
 *  - Progress bar at the bottom showing time-to-dismiss
 *  - Slide-in animation from the right
 */
import type { ToastItem, ToastType } from "@/hooks/useToast";
import { colors, fonts, radii, space, typography } from "@/theme/tokens";

import { Check } from "./icons";

interface ToastListProps {
  toasts: readonly ToastItem[];
  onDismiss: (id: string) => void;
}

export function Toast({ toasts, onDismiss }: ToastListProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        top: 20,
        right: 20,
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        gap: space[2],
        maxWidth: 360,
        pointerEvents: "none",
      }}
    >
      {toasts.map((t) => (
        <ToastRow key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

interface ToastRowProps {
  toast: ToastItem;
  onDismiss: () => void;
}

function ToastRow({ toast, onDismiss }: ToastRowProps) {
  const config = TYPE_CONFIG[toast.type];

  return (
    <div
      style={{
        position: "relative",
        background: config.bg,
        border: `1px solid ${config.border}`,
        borderRadius: radii.lg,
        padding: `${space[3]}px ${space[4]}px`,
        fontSize: typography.size.sm,
        fontWeight: typography.weight.medium,
        color: colors.text,
        fontFamily: fonts.sans,
        display: "flex",
        alignItems: "center",
        gap: space[2],
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        backdropFilter: "blur(12px)",
        animation: "vf-slide-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
        pointerEvents: "auto",
        overflow: "hidden",
        minWidth: 220,
      }}
    >
      <span
        aria-hidden
        style={{
          color: config.iconColor,
          display: "flex",
          flexShrink: 0,
        }}
      >
        {config.icon}
      </span>
      <span style={{ flex: 1, lineHeight: typography.leading.normal }}>{toast.message}</span>
      <button
        onClick={onDismiss}
        aria-label="Dismiss notification"
        style={{
          background: "none",
          border: "none",
          color: colors.textFaint,
          cursor: "pointer",
          padding: 4,
          fontSize: typography.size.lg,
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        ×
      </button>

      {/* Auto-dismiss progress bar */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          bottom: 0,
          height: 2,
          background: config.iconColor,
          opacity: 0.6,
          animation: `vf-toast-progress ${toast.durationMs}ms linear forwards`,
        }}
      />
    </div>
  );
}

// ── Type configurations ────────────────────────────────────────────

const TYPE_CONFIG: Record<ToastType, { bg: string; border: string; iconColor: string; icon: React.ReactNode }> = {
  info: {
    bg: colors.surface,
    border: colors.primaryBorder,
    iconColor: colors.primaryLight,
    icon: <InfoIcon />,
  },
  success: {
    bg: colors.surface,
    border: colors.successBorder,
    iconColor: colors.success,
    icon: <Check />,
  },
  warning: {
    bg: colors.surface,
    border: colors.warningBorder,
    iconColor: colors.warning,
    icon: <WarningIcon />,
  },
  error: {
    bg: colors.surface,
    border: colors.dangerBorder,
    iconColor: colors.danger,
    icon: <ErrorIcon />,
  },
};

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}
