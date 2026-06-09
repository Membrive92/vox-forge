/**
 * Simple confirmation dialog for destructive actions.
 *
 * - Renders as a fixed-position overlay + dialog in the center
 * - ESC or Cancel button cancels, Confirm button confirms
 * - Background click cancels
 */
import { useEffect, useRef } from "react";

import { useFocusTrap } from "@/hooks/useFocusTrap";
import { colors, radii, typography } from "@/theme/tokens";

import { Button } from "./Button";

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  confirmVariant?: "primary" | "danger";
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = "Confirm",
  confirmVariant = "primary",
  cancelText = "Cancel",
  onConfirm,
  onCancel,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: radii.xl,
          padding: 20,
          width: "90%",
          maxWidth: 400,
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        <h2 id="confirm-title" style={{ margin: "0 0 12px", fontSize: typography.size.lg, fontWeight: 700 }}>
          {title}
        </h2>

        <p id="confirm-message" style={{ margin: "0 0 20px", fontSize: typography.size.sm, color: colors.text }}>
          {message}
        </p>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onCancel}>
            {cancelText}
          </Button>
          <Button variant={confirmVariant} onClick={onConfirm}>
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
}
