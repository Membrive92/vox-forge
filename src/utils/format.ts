/**
 * Format a number of seconds as a "M:SS" clock (e.g. 75 → "1:15").
 * Non-finite or negative input renders as "0:00" so a not-yet-loaded
 * duration never shows "NaN:NaN".
 */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
