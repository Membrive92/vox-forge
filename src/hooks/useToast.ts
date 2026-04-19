/**
 * Toast notifications.
 *
 * Stack of multiple toasts (instead of one-at-a-time replacement),
 * each with a type (info / success / warning / error) that controls
 * icon + color, and an auto-dismiss timer rendered as a progress bar
 * by the Toast component.
 *
 * `show(msg)` keeps the existing one-arg signature — type is auto-detected:
 *  - "Error: ..." or "Failed: ..." → error
 *  - "... saved", "... ready", "... done" → success
 *  - everything else → info
 * Callers that want explicit control pass `show(msg, "warning")`.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type ToastType = "info" | "success" | "warning" | "error";

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  durationMs: number;
}

export interface ToastState {
  toasts: readonly ToastItem[];
  show: (message: string, type?: ToastType) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

const DEFAULT_DURATION_MS = 4000;
const ERROR_DURATION_MS = 6000;

function inferType(message: string): ToastType {
  const lower = message.toLowerCase();
  if (lower.startsWith("error") || lower.startsWith("failed") || lower.includes("could not")) {
    return "error";
  }
  if (lower.includes("saved") || lower.includes("ready") || lower.includes("done")) {
    return "success";
  }
  return "info";
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function useToast(): ToastState {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, number>>(new Map());

  const dismiss = useCallback((id: string): void => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const handle = timersRef.current.get(id);
    if (handle !== undefined) {
      window.clearTimeout(handle);
      timersRef.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (message: string, explicitType?: ToastType): void => {
      const id = newId();
      const type = explicitType ?? inferType(message);
      const durationMs = type === "error" ? ERROR_DURATION_MS : DEFAULT_DURATION_MS;
      const item: ToastItem = { id, message, type, durationMs };
      setToasts((prev) => [...prev, item]);

      const handle = window.setTimeout(() => dismiss(id), durationMs);
      timersRef.current.set(id, handle);
    },
    [dismiss],
  );

  const clear = useCallback((): void => {
    timersRef.current.forEach((h) => window.clearTimeout(h));
    timersRef.current.clear();
    setToasts([]);
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((h) => window.clearTimeout(h));
      timers.clear();
    };
  }, []);

  return { toasts, show, dismiss, clear };
}
