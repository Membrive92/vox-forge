/**
 * Global jobs context (UX-01).
 *
 * App mounts one `JobsProvider`; owner hooks/components feed it through
 * `useJobMirror` and the chrome (tray, aggregate bar, tab badges) reads
 * it through `useJobs`. State and actions live in separate contexts so
 * feeders don't re-render on every progress tick of unrelated jobs.
 *
 * Follows the profilesContext pattern: components rendered in isolation
 * (unit tests) get inert no-op actions instead of a crash.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";

import {
  jobsReducer,
  type JobKind,
  type JobUpdatePatch,
  type RegisterJobInput,
  type TrackedJob,
} from "./jobsRegistry";
import type { TabId } from "@/types/domain";

export interface JobsActions {
  register: (job: RegisterJobInput) => void;
  update: (id: string, patch: JobUpdatePatch) => void;
  /** Mark done; the provider removes the entry after a short linger. */
  complete: (id: string) => void;
}

/** How long a completed job stays visible in the tray before vanishing. */
export const JOB_DONE_LINGER_MS = 4000;

const JobsStateContext = createContext<readonly TrackedJob[]>([]);

const INERT: JobsActions = {
  register: () => undefined,
  update: () => undefined,
  complete: () => undefined,
};
const JobsActionsContext = createContext<JobsActions>(INERT);

export function JobsProvider({ children }: { children: ReactNode }) {
  const [jobs, dispatch] = useReducer(jobsReducer, []);
  const lingerTimersRef = useRef<Map<string, number>>(new Map());

  useEffect(
    () => () => {
      for (const timer of lingerTimersRef.current.values()) window.clearTimeout(timer);
      lingerTimersRef.current.clear();
    },
    [],
  );

  const actions = useMemo<JobsActions>(
    () => ({
      register: (job) => dispatch({ type: "register", job }),
      update: (id, patch) => dispatch({ type: "update", id, patch }),
      complete: (id) => {
        dispatch({ type: "complete", id });
        // Completed jobs linger so the user sees them finish, then vanish.
        const timers = lingerTimersRef.current;
        const existing = timers.get(id);
        if (existing !== undefined) window.clearTimeout(existing);
        timers.set(
          id,
          window.setTimeout(() => {
            timers.delete(id);
            dispatch({ type: "remove", id });
          }, JOB_DONE_LINGER_MS),
        );
      },
    }),
    [],
  );

  return (
    <JobsActionsContext.Provider value={actions}>
      <JobsStateContext.Provider value={jobs}>{children}</JobsStateContext.Provider>
    </JobsActionsContext.Provider>
  );
}

export function useJobs(): readonly TrackedJob[] {
  return useContext(JobsStateContext);
}

export function useJobsActions(): JobsActions {
  return useContext(JobsActionsContext);
}

let jobSeq = 0;
function nextJobId(): string {
  jobSeq += 1;
  return `job-${jobSeq}`;
}

export interface JobMirror {
  /** The owner's in-flight flag (isGenerating, isConverting, ...). */
  active: boolean;
  kind: JobKind;
  originTab: TabId;
  label?: string;
  /** Fraction 0–1; null/undefined renders as indeterminate. */
  progress?: number | null;
  chunksDone?: number | null;
  chunksTotal?: number | null;
}

/**
 * Mirror an owner's in-flight state into the global registry. The owner
 * keeps its polling/await exactly as before; this hook registers a job
 * when `active` flips on, patches it while values change, and completes
 * it when `active` flips off or the owner unmounts (an unmounting owner
 * aborts its request, so the job really is over).
 */
export function useJobMirror(mirror: JobMirror): void {
  const { register, update, complete } = useJobsActions();
  const idRef = useRef<string | null>(null);
  // Latest snapshot so the transition effect reads fresh values without
  // depending on (and re-running for) every field.
  const mirrorRef = useRef(mirror);
  mirrorRef.current = mirror;

  useEffect(() => {
    const spec = mirrorRef.current;
    if (spec.active && idRef.current === null) {
      const id = nextJobId();
      idRef.current = id;
      register({
        id,
        kind: spec.kind,
        originTab: spec.originTab,
        label: spec.label ?? "",
        progress: spec.progress ?? null,
        chunksDone: spec.chunksDone ?? null,
        chunksTotal: spec.chunksTotal ?? null,
      });
    } else if (!spec.active && idRef.current !== null) {
      complete(idRef.current);
      idRef.current = null;
    }
  }, [mirror.active, register, complete]);

  // Mirror live fields while the job runs.
  useEffect(() => {
    if (idRef.current === null) return;
    update(idRef.current, {
      label: mirror.label ?? "",
      progress: mirror.progress ?? null,
      chunksDone: mirror.chunksDone ?? null,
      chunksTotal: mirror.chunksTotal ?? null,
    });
  }, [mirror.label, mirror.progress, mirror.chunksDone, mirror.chunksTotal, update]);

  const completeRef = useRef(complete);
  completeRef.current = complete;
  useEffect(
    () => () => {
      if (idRef.current !== null) {
        completeRef.current(idRef.current);
        idRef.current = null;
      }
    },
    [],
  );
}
