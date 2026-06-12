/**
 * Pure registry of in-flight background jobs (UX-01).
 *
 * Every long-running operation (quick synth, chapter synthesis, voice
 * conversion, video render, transcription) registers itself here so the
 * global job tray, the aggregate progress bar and the per-tab badges can
 * surface progress regardless of which tab the user is looking at. The
 * polling/awaiting stays in the OWNER hook or component — this registry
 * only mirrors its state; it never fetches anything itself.
 *
 * The reducer is pure and side-effect free; `jobsContext.tsx` owns the
 * React wiring (provider, timers, mirror hook).
 */
import type { TabId } from "@/types/domain";

export type JobKind =
  | "quick-synth"
  | "chapter-synth"
  | "conversion"
  | "video-render"
  | "transcription"
  | "cross-lingual";

/** "done" entries linger briefly in the tray before being removed. */
export type JobStatus = "running" | "done";

export interface TrackedJob {
  id: string;
  kind: JobKind;
  /** Free-text detail — chapter title, source file name. May be empty. */
  label: string;
  /** Overall fraction 0–1, or null when the job can't report progress. */
  progress: number | null;
  chunksDone: number | null;
  chunksTotal: number | null;
  /** Tab to navigate back to when the user clicks the tray entry. */
  originTab: TabId;
  status: JobStatus;
}

export interface RegisterJobInput {
  id: string;
  kind: JobKind;
  originTab: TabId;
  label?: string;
  progress?: number | null;
  chunksDone?: number | null;
  chunksTotal?: number | null;
}

export type JobUpdatePatch = Partial<
  Pick<TrackedJob, "label" | "progress" | "chunksDone" | "chunksTotal">
>;

export type JobsAction =
  | { type: "register"; job: RegisterJobInput }
  | { type: "update"; id: string; patch: JobUpdatePatch }
  | { type: "complete"; id: string }
  | { type: "remove"; id: string };

export function jobsReducer(
  state: readonly TrackedJob[],
  action: JobsAction,
): readonly TrackedJob[] {
  switch (action.type) {
    case "register": {
      const job: TrackedJob = {
        id: action.job.id,
        kind: action.job.kind,
        originTab: action.job.originTab,
        label: action.job.label ?? "",
        progress: action.job.progress ?? null,
        chunksDone: action.job.chunksDone ?? null,
        chunksTotal: action.job.chunksTotal ?? null,
        status: "running",
      };
      // Re-registering an id replaces the stale entry instead of duplicating.
      return [...state.filter((j) => j.id !== job.id), job];
    }
    case "update": {
      // Unknown ids (already cleaned up) and finished jobs are no-ops:
      // a late poll must not resurrect or mutate a completed entry.
      const idx = state.findIndex((j) => j.id === action.id && j.status === "running");
      if (idx === -1) return state;
      const next = [...state];
      next[idx] = { ...state[idx]!, ...action.patch };
      return next;
    }
    case "complete": {
      const idx = state.findIndex((j) => j.id === action.id && j.status === "running");
      if (idx === -1) return state;
      const next = [...state];
      next[idx] = { ...state[idx]!, status: "done" };
      return next;
    }
    case "remove": {
      if (!state.some((j) => j.id === action.id)) return state;
      return state.filter((j) => j.id !== action.id);
    }
  }
}
