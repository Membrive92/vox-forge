import type { ChapterExportSource } from "@/api/chapterSynth";
import type { Translations } from "@/i18n";

/**
 * Localized "x minutes/hours/days ago" relative time, falling back to a
 * short absolute date past a week. Shared by the chapter cards and the
 * project sidebar.
 */
export function relativeTime(iso: string, t: Translations): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return t.timeJustNow;
  if (mins < 60) return t.timeMinutesAgo.replace("{n}", String(mins));
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t.timeHoursAgo.replace("{n}", String(hours));
  const days = Math.floor(hours / 24);
  if (days < 7) return t.timeDaysAgo.replace("{n}", String(days));
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Localized "Will export: …" label for a chapter's export source (UX-02).
 * The kind itself comes from the backend resolver — this only renders it.
 */
export function exportSourceLabel(source: ChapterExportSource, t: Translations): string {
  switch (source.kind) {
    case "studio_edit": {
      const template = source.mastered
        ? t.chapterExportSourceMastered
        : t.chapterExportSourceStudio;
      const when = source.created_at ? relativeTime(source.created_at, t) : "—";
      return template.replace("{when}", when);
    }
    case "active_take":
      return t.chapterExportSourceActive;
    case "latest_generation":
      return t.chapterExportSourceLatest;
    case "fresh_synthesis":
      return t.chapterExportSourceFresh;
  }
}
