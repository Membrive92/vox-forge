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
