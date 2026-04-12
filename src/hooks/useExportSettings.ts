/**
 * Persisted export settings (ID3 metadata + filename pattern).
 *
 * The filename pattern supports these tokens:
 *   {story}    → storyTitle, sanitized (spaces → underscores)
 *   {artist}   → artist, sanitized
 *   {track}    → trackNumber, zero-padded to 2 digits
 *   {date}     → today's date in YYYY-MM-DD
 *   {time}     → HH-MM-SS
 *   {fmt}      → output format (mp3, wav, …)
 *
 * Example: "{story}_cap{track}_{date}.{fmt}" → "La_Torre_cap03_2026-04-11.mp3"
 */
import { useCallback, useEffect, useState } from "react";

import { logger } from "@/logging/logger";
import type { ExportSettings } from "@/types/domain";

const STORAGE_KEY = "voxforge.export.settings";

const DEFAULTS: ExportSettings = {
  storyTitle: "",
  artist: "",
  album: "",
  trackNumber: 1,
  filenamePattern: "voxforge_{date}.{fmt}",
};

function loadSettings(): ExportSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<ExportSettings>;
    return { ...DEFAULTS, ...parsed };
  } catch (err) {
    logger.warn("Failed to load export settings", {
      error: err instanceof Error ? err.message : String(err),
    });
    return DEFAULTS;
  }
}

export function useExportSettings(): {
  settings: ExportSettings;
  update: (patch: Partial<ExportSettings>) => void;
  renderFilename: (fmt: string) => string;
} {
  const [settings, setSettings] = useState<ExportSettings>(loadSettings);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (err) {
      logger.warn("Failed to save export settings", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [settings]);

  const update = useCallback((patch: Partial<ExportSettings>): void => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const renderFilename = useCallback(
    (fmt: string): string => applyPattern(settings.filenamePattern, settings, fmt),
    [settings],
  );

  return { settings, update, renderFilename };
}

function sanitize(s: string): string {
  return s.trim().replace(/[^\w\-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function applyPattern(pattern: string, settings: ExportSettings, fmt: string): string {
  const now = new Date();
  const date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const time = `${pad2(now.getHours())}-${pad2(now.getMinutes())}-${pad2(now.getSeconds())}`;
  const replacements: Record<string, string> = {
    "{story}": sanitize(settings.storyTitle) || "voxforge",
    "{artist}": sanitize(settings.artist) || "unknown",
    "{track}": pad2(settings.trackNumber),
    "{date}": date,
    "{time}": time,
    "{fmt}": fmt,
  };
  let out = pattern;
  for (const [token, value] of Object.entries(replacements)) {
    out = out.split(token).join(value);
  }
  // Fallback extension if user's pattern forgot {fmt}
  if (!out.toLowerCase().endsWith(`.${fmt.toLowerCase()}`)) {
    out = `${out}.${fmt}`;
  }
  return out;
}
