/**
 * localStorage-backed custom Lab presets.
 *
 * Kept separate from server presets so built-ins can't be clobbered.
 * The UI merges both lists and tags user presets with `category: "custom"`.
 */
import { useCallback, useEffect, useState } from "react";

import type { Preset, VoiceLabParams } from "@/api/voiceLab";
import { logger } from "@/logging/logger";

const STORAGE_KEY = "voxforge.lab.customPresets";

function load(): Preset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Preset[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    logger.warn("Failed to load custom Lab presets", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

export function useCustomLabPresets(): {
  presets: Preset[];
  save: (name: string, description: string, params: VoiceLabParams) => void;
  remove: (name: string) => void;
} {
  const [presets, setPresets] = useState<Preset[]>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
    } catch (err) {
      logger.warn("Failed to save custom Lab presets", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [presets]);

  const save = useCallback((name: string, description: string, params: VoiceLabParams): void => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setPresets((prev) => {
      const without = prev.filter((p) => p.name !== trimmed);
      const next: Preset = {
        name: trimmed,
        description: description.trim() || "Custom preset",
        category: "custom",
        params: { ...params },
      };
      return [...without, next];
    });
  }, []);

  const remove = useCallback((name: string): void => {
    setPresets((prev) => prev.filter((p) => p.name !== name));
  }, []);

  return { presets, save, remove };
}
