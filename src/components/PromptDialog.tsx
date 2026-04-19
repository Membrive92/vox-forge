/**
 * Accessible replacement for `window.prompt()`.
 *
 * - Renders as a fixed-position overlay + a small panel in the center
 * - Two text inputs: one for the required value, one optional
 * - Focus moves to the first input on open
 * - ESC closes (cancels), Enter confirms
 * - Background click cancels
 *
 * Used by the Lab tab to capture preset name + description when saving
 * a custom preset. Can be reused wherever we need a single-shot text input.
 */
import { forwardRef, useEffect, useRef, useState } from "react";

import { colors, fonts, radii, typography } from "@/theme/tokens";

import { Button } from "./Button";

interface Props {
  open: boolean;
  title: string;
  label: string;
  secondaryLabel?: string;
  confirmText?: string;
  cancelText?: string;
  initialValue?: string;
  initialSecondary?: string;
  onConfirm: (value: string, secondary: string) => void;
  onCancel: () => void;
}

export function PromptDialog({
  open,
  title,
  label,
  secondaryLabel,
  confirmText = "Save",
  cancelText = "Cancel",
  initialValue = "",
  initialSecondary = "",
  onConfirm,
  onCancel,
}: Props) {
  const [value, setValue] = useState(initialValue);
  const [secondary, setSecondary] = useState(initialSecondary);
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(initialValue);
      setSecondary(initialSecondary);
      // Defer focus until the element is mounted
      setTimeout(() => firstInputRef.current?.focus(), 10);
    }
  }, [open, initialValue, initialSecondary]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const canConfirm = value.trim().length > 0;

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (canConfirm) onConfirm(value.trim(), secondary.trim());
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="prompt-dialog-title"
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
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: radii.xl,
          padding: 24,
          width: "90%",
          maxWidth: 420,
          backdropFilter: "blur(12px)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        <h3
          id="prompt-dialog-title"
          style={{
            margin: "0 0 16px",
            fontSize: typography.size.lg,
            fontWeight: typography.weight.bold,
            color: colors.text,
            fontFamily: fonts.sans,
          }}
        >
          {title}
        </h3>

        <Field
          ref={firstInputRef}
          label={label}
          value={value}
          onChange={setValue}
          autoFocus
        />

        {secondaryLabel !== undefined && (
          <div style={{ marginTop: 12 }}>
            <Field
              label={secondaryLabel}
              value={secondary}
              onChange={setSecondary}
            />
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 20, justifyContent: "flex-end" }}>
          <Button variant="ghost" type="button" onClick={onCancel}>
            {cancelText}
          </Button>
          <Button variant="primary" type="submit" disabled={!canConfirm}>
            {confirmText}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ── Field ───────────────────────────────────────────────────────────

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}

const Field = forwardRef<HTMLInputElement, FieldProps>(
  function FieldComponent({ label, value, onChange, autoFocus }, ref) {
    return (
      <label style={{ display: "block" }}>
        <span
          style={{
            display: "block",
            fontSize: typography.size.xs,
            fontWeight: typography.weight.semibold,
            color: colors.textDim,
            textTransform: "uppercase",
            letterSpacing: typography.tracking.wide,
            marginBottom: 6,
            fontFamily: fonts.sans,
          }}
        >
          {label}
        </span>
        <input
          ref={ref}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus={autoFocus}
          style={{
            width: "100%",
            padding: "10px 12px",
            background: colors.surfaceAlt,
            border: `1px solid ${colors.border}`,
            borderRadius: radii.md,
            color: colors.text,
            fontSize: typography.size.sm,
            fontFamily: fonts.sans,
            outline: "none",
            boxSizing: "border-box",
          }}
        />
      </label>
    );
  },
);
