/**
 * Autosave a text draft to localStorage with debounce + restore on mount.
 *
 * The draft is written at most once every `debounceMs` after the last edit.
 * On mount, any previously saved draft is handed to `onRestore` (typically
 * the `setText` from `useState`) if and only if the current value is empty —
 * we never overwrite something the user already has on screen.
 */
import { useEffect, useRef } from "react";

import { logger } from "@/logging/logger";

interface Options {
  key: string;
  value: string;
  onRestore: (restored: string) => void;
  debounceMs?: number;
}

export function useDraftPersistence({ key, value, onRestore, debounceMs = 1000 }: Options): void {
  const restoredRef = useRef(false);

  // Restore once, on first render.
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    try {
      const saved = localStorage.getItem(key);
      if (saved && value.length === 0) {
        onRestore(saved);
        logger.info("Draft restored from localStorage", { key, length: saved.length });
      }
    } catch (err) {
      logger.warn("Failed to restore draft", {
        key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced save on every change.
  useEffect(() => {
    if (!restoredRef.current) return;
    const handle = window.setTimeout(() => {
      try {
        if (value.length === 0) {
          localStorage.removeItem(key);
        } else {
          localStorage.setItem(key, value);
        }
      } catch (err) {
        logger.warn("Failed to persist draft", {
          key,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, debounceMs);
    return () => window.clearTimeout(handle);
  }, [key, value, debounceMs]);
}
