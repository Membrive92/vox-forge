/**
 * Provider + mirror contract (UX-01): an owner's in-flight boolean,
 * mirrored via `useJobMirror`, registers a job, patches its live
 * progress, completes on deactivation (lingering briefly as "done"),
 * and completes when the owner unmounts mid-job. Components rendered
 * without a provider must not crash (inert actions).
 */
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JOB_DONE_LINGER_MS, JobsProvider, useJobMirror, useJobs } from "./jobsContext";
import type { JobKind } from "./jobsRegistry";
import type { TabId } from "@/types/domain";

interface FeederProps {
  active: boolean;
  kind?: JobKind;
  originTab?: TabId;
  label?: string;
  progress?: number | null;
  chunksDone?: number | null;
  chunksTotal?: number | null;
}

function Feeder({
  active,
  kind = "quick-synth",
  originTab = "voices",
  label,
  progress,
  chunksDone,
  chunksTotal,
}: FeederProps) {
  useJobMirror({
    active,
    kind,
    originTab,
    label: label ?? "",
    progress: progress ?? null,
    chunksDone: chunksDone ?? null,
    chunksTotal: chunksTotal ?? null,
  });
  return null;
}

function Probe() {
  const jobs = useJobs();
  return (
    <ul>
      {jobs.map((j) => (
        <li key={j.id} data-testid="job">
          {[
            j.kind,
            j.status,
            j.originTab,
            j.label || "-",
            j.progress === null ? "null" : j.progress,
            `${j.chunksDone ?? "-"}/${j.chunksTotal ?? "-"}`,
          ].join("|")}
        </li>
      ))}
    </ul>
  );
}

function Harness({ mounted, ...feeder }: FeederProps & { mounted?: boolean }) {
  return (
    <JobsProvider>
      {(mounted ?? true) && <Feeder {...feeder} />}
      <Probe />
    </JobsProvider>
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useJobMirror", () => {
  it("registers on activation, mirrors progress, completes and is cleaned up", () => {
    const { rerender } = render(<Harness active={false} />);
    expect(screen.queryByTestId("job")).toBeNull();

    // Activation registers a running job with the mirrored fields.
    rerender(<Harness active label="Capítulo 7" progress={0.2} chunksDone={1} chunksTotal={5} />);
    expect(screen.getByTestId("job").textContent).toBe(
      "quick-synth|running|voices|Capítulo 7|0.2|1/5",
    );

    // Owner progress updates are reflected without re-registering.
    rerender(<Harness active label="Capítulo 7" progress={0.8} chunksDone={4} chunksTotal={5} />);
    expect(screen.getAllByTestId("job")).toHaveLength(1);
    expect(screen.getByTestId("job").textContent).toContain("|0.8|4/5");

    // Deactivation completes the job; it lingers as "done"...
    rerender(<Harness active={false} label="Capítulo 7" />);
    expect(screen.getByTestId("job").textContent).toContain("|done|");

    // ...and the provider removes it after the linger window.
    act(() => vi.advanceTimersByTime(JOB_DONE_LINGER_MS));
    expect(screen.queryByTestId("job")).toBeNull();
  });

  it("a new activation after completion is a distinct job", () => {
    const { rerender } = render(<Harness active />);
    rerender(<Harness active={false} />);
    rerender(<Harness active />);
    const rows = screen.getAllByTestId("job");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.textContent?.split("|")[1])).toEqual(["done", "running"]);
  });

  it("completes the job when the owner unmounts mid-run", () => {
    const { rerender } = render(<Harness mounted active kind="conversion" originTab="audio-tools" />);
    expect(screen.getByTestId("job").textContent).toContain("|running|");

    // Unmounting the owner aborts its request — the entry must not stay
    // "running" forever in the tray.
    rerender(<Harness mounted={false} active kind="conversion" originTab="audio-tools" />);
    expect(screen.getByTestId("job").textContent).toContain("|done|");
    act(() => vi.advanceTimersByTime(JOB_DONE_LINGER_MS));
    expect(screen.queryByTestId("job")).toBeNull();
  });

  it("does not crash without a provider (inert actions for isolated tests)", () => {
    expect(() => {
      const { rerender } = render(<Feeder active={false} />);
      rerender(<Feeder active />);
      rerender(<Feeder active={false} />);
    }).not.toThrow();
  });
});
