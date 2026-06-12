/**
 * Thin aggregate progress bar rendered under the tab nav (UX-01).
 *
 * Visible only while at least one registered job is running. Jobs that
 * report a fraction are averaged into a determinate fill; if none does,
 * an indeterminate sweep keeps the activity visible anyway.
 */
import { useJobs } from "@/hooks/jobsContext";
import { colors } from "@/theme/tokens";

interface Props {
  /** Accessible name of the progressbar (i18n). */
  label: string;
}

export function JobsProgressBar({ label }: Props) {
  const jobs = useJobs();
  const running = jobs.filter((j) => j.status === "running");
  if (running.length === 0) return null;

  const determinate = running.filter((j) => j.progress !== null);
  const fraction =
    determinate.length > 0
      ? determinate.reduce((acc, j) => acc + (j.progress ?? 0), 0) / determinate.length
      : null;

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      {...(fraction !== null ? { "aria-valuenow": Math.round(fraction * 100) } : {})}
      style={{
        position: "relative",
        zIndex: 10,
        height: 3,
        background: colors.primarySoft,
        overflow: "hidden",
      }}
    >
      {fraction !== null ? (
        <div
          style={{
            height: "100%",
            width: `${Math.round(fraction * 100)}%`,
            background: `linear-gradient(90deg, ${colors.primary}, ${colors.accent})`,
            transition: "width 300ms ease",
          }}
        />
      ) : (
        <div
          style={{
            height: "100%",
            width: "40%",
            background: `linear-gradient(90deg, transparent, ${colors.primary}, transparent)`,
            animation: "vf-progress-sweep 1.4s ease-in-out infinite",
          }}
        />
      )}
    </div>
  );
}
