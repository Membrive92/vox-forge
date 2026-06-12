/**
 * Header job tray (UX-01).
 *
 * Hidden while nothing is tracked; otherwise a compact button showing a
 * spinner + running count (or a check while finished jobs linger) that
 * toggles a dropdown listing every tracked job. Clicking an entry fires
 * the navigation intent back to the job's origin tab.
 */
import { useEffect, useId, useRef, useState } from "react";

import * as Icons from "@/components/icons";
import { useJobs } from "@/hooks/jobsContext";
import type { JobKind, TrackedJob } from "@/hooks/jobsRegistry";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, typography } from "@/theme/tokens";
import type { TabId } from "@/types/domain";

interface Props {
  t: Translations;
  /** Navigation intent: take the user to the job's origin tab. */
  onNavigate: (tab: TabId) => void;
}

function kindLabel(t: Translations, kind: JobKind): string {
  switch (kind) {
    case "quick-synth": return t.jobKindQuickSynth;
    case "chapter-synth": return t.jobKindChapterSynth;
    case "conversion": return t.jobKindConversion;
    case "video-render": return t.jobKindVideoRender;
    case "transcription": return t.jobKindTranscription;
    case "cross-lingual": return t.jobKindCrossLingual;
  }
}

function statusText(t: Translations, job: TrackedJob): string {
  if (job.status === "done") return t.jobsDone;
  if (job.chunksTotal !== null && job.chunksTotal > 0) {
    return `${job.chunksDone ?? 0}/${job.chunksTotal}`;
  }
  if (job.progress !== null) return `${Math.round(job.progress * 100)}%`;
  return t.jobsRunning;
}

export function JobsTray({ t, onNavigate }: Props) {
  const jobs = useJobs();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const runningCount = jobs.filter((j) => j.status === "running").length;

  // Close when clicking anywhere outside the tray.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // When the last lingering job is cleaned up, the whole tray unmounts —
  // make sure a stale "open" doesn't flash if jobs reappear later.
  useEffect(() => {
    if (jobs.length === 0) setOpen(false);
  }, [jobs.length]);

  if (jobs.length === 0) return null;

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        type="button"
        aria-label={t.jobsTrayLabel}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: colors.primarySoft,
          border: `1px solid ${colors.primaryBorder}`,
          borderRadius: radii.md,
          padding: "8px 14px",
          color: colors.primaryLight,
          cursor: "pointer",
          fontSize: typography.size.sm,
          fontWeight: typography.weight.semibold,
          fontFamily: fonts.sans,
        }}
      >
        {runningCount > 0 ? (
          <>
            <span
              aria-hidden
              style={{
                display: "inline-block",
                width: 12,
                height: 12,
                border: "2px solid currentColor",
                borderRightColor: "transparent",
                borderRadius: "50%",
                animation: "vf-spin 0.7s linear infinite",
              }}
            />
            {runningCount}
          </>
        ) : (
          <Icons.Check />
        )}
      </button>

      {open && (
        <div
          id={panelId}
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            zIndex: 50,
            minWidth: 300,
            maxWidth: 380,
            display: "flex",
            flexDirection: "column",
            gap: 4,
            padding: 8,
            background: "#101827",
            border: `1px solid ${colors.border}`,
            borderRadius: radii.lg,
            boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
          }}
        >
          {jobs.map((job) => (
            <button
              key={job.id}
              type="button"
              title={t.jobsGoToOrigin}
              onClick={() => {
                setOpen(false);
                onNavigate(job.originTab);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                padding: "8px 10px",
                background: colors.surfaceSubtle,
                border: `1px solid ${colors.borderFaint}`,
                borderRadius: radii.sm,
                color: colors.text,
                cursor: "pointer",
                fontFamily: fonts.sans,
                fontSize: typography.size.sm,
                textAlign: "left",
              }}
            >
              <span style={{ fontWeight: typography.weight.semibold, flexShrink: 0 }}>
                {kindLabel(t, job.kind)}
              </span>
              {job.label && (
                <span
                  style={{
                    color: colors.textDim,
                    fontSize: typography.size.xs,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    minWidth: 0,
                    flex: 1,
                  }}
                >
                  {job.label}
                </span>
              )}
              <span
                style={{
                  marginLeft: "auto",
                  flexShrink: 0,
                  fontFamily: fonts.mono,
                  fontSize: typography.size.xs,
                  fontWeight: typography.weight.bold,
                  color: job.status === "done" ? colors.success : colors.primaryLight,
                }}
              >
                {statusText(t, job)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
