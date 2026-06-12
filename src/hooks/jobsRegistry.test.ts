/**
 * Unit tests for the pure jobs reducer (UX-01): register / update /
 * complete / remove semantics, including the no-op guarantees that
 * protect against late polls touching finished or cleaned-up entries.
 */
import { describe, expect, it } from "vitest";

import { jobsReducer, type TrackedJob } from "./jobsRegistry";

function registered(overrides: Partial<Parameters<typeof jobsReducer>[1] & object> = {}) {
  return jobsReducer([], {
    type: "register",
    job: { id: "j1", kind: "chapter-synth", originTab: "workbench", label: "Cap. 1", ...overrides },
  });
}

describe("jobsReducer — register", () => {
  it("adds a running job with defaults for the optional fields", () => {
    const state = jobsReducer([], {
      type: "register",
      job: { id: "j1", kind: "quick-synth", originTab: "voices" },
    });
    expect(state).toEqual<readonly TrackedJob[]>([
      {
        id: "j1",
        kind: "quick-synth",
        originTab: "voices",
        label: "",
        progress: null,
        chunksDone: null,
        chunksTotal: null,
        status: "running",
      },
    ]);
  });

  it("replaces an existing entry with the same id instead of duplicating", () => {
    let state = registered();
    state = jobsReducer(state, {
      type: "register",
      job: { id: "j1", kind: "conversion", originTab: "audio-tools" },
    });
    expect(state).toHaveLength(1);
    expect(state[0]!.kind).toBe("conversion");
  });

  it("keeps unrelated jobs", () => {
    let state = registered();
    state = jobsReducer(state, {
      type: "register",
      job: { id: "j2", kind: "transcription", originTab: "studio" },
    });
    expect(state.map((j) => j.id)).toEqual(["j1", "j2"]);
  });
});

describe("jobsReducer — update", () => {
  it("patches progress and chunk counters of a running job", () => {
    let state = registered();
    state = jobsReducer(state, {
      type: "update",
      id: "j1",
      patch: { progress: 0.5, chunksDone: 5, chunksTotal: 10 },
    });
    expect(state[0]).toMatchObject({ progress: 0.5, chunksDone: 5, chunksTotal: 10 });
  });

  it("is a no-op (same reference) for unknown ids", () => {
    const state = registered();
    const next = jobsReducer(state, { type: "update", id: "ghost", patch: { progress: 1 } });
    expect(next).toBe(state);
  });

  it("never mutates a completed job — a late poll must not resurrect it", () => {
    let state = registered();
    state = jobsReducer(state, { type: "complete", id: "j1" });
    const next = jobsReducer(state, { type: "update", id: "j1", patch: { progress: 0.1 } });
    expect(next).toBe(state);
    expect(next[0]!.status).toBe("done");
  });
});

describe("jobsReducer — complete / remove", () => {
  it("complete marks the job done and keeps the rest intact", () => {
    let state = registered();
    state = jobsReducer(state, {
      type: "register",
      job: { id: "j2", kind: "video-render", originTab: "studio" },
    });
    state = jobsReducer(state, { type: "complete", id: "j1" });
    expect(state.find((j) => j.id === "j1")!.status).toBe("done");
    expect(state.find((j) => j.id === "j2")!.status).toBe("running");
  });

  it("complete on an unknown id is a no-op (same reference)", () => {
    const state = registered();
    expect(jobsReducer(state, { type: "complete", id: "ghost" })).toBe(state);
  });

  it("remove deletes the entry; removing an unknown id is a no-op", () => {
    const state = registered();
    expect(jobsReducer(state, { type: "remove", id: "j1" })).toHaveLength(0);
    expect(jobsReducer(state, { type: "remove", id: "ghost" })).toBe(state);
  });
});
