/**
 * Regression tests for StudioWaveform.
 *
 * Backstory: an earlier zoom implementation caused an infinite render
 * loop because the timeupdate event (~60fps) drove a state update that
 * re-triggered a zoom useEffect, which re-zoomed wavesurfer, which fired
 * another event, etc. The fix removed React-driven zoom entirely.
 *
 * These tests catch a specific class of regression: the absence of zoom
 * state and effect in the source. They cannot exercise the live
 * wavesurfer/canvas/audio-context loop in jsdom — that's what the
 * Playwright E2E tests are for.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  resolve(__dirname, "StudioWaveform.tsx"),
  "utf-8",
);

describe("StudioWaveform — guard against the zoom loop regression", () => {
  it("does not declare a zoom React state", () => {
    // useState(40) for zoom was the entry point of the loop. If you
    // need a zoom UI in the future, drive it imperatively (refs +
    // direct ws.zoom() calls) — see the commit history for context.
    expect(SOURCE).not.toMatch(/useState[^}]*zoom/);
    expect(SOURCE).not.toMatch(/setZoom\(/);
  });

  it("does not register a useEffect on a zoom dependency", () => {
    // The original bug: useEffect(..., [zoom]) re-ran on every state
    // change, and ws.zoom() emitted events that flipped state again.
    expect(SOURCE).not.toMatch(/useEffect\([^)]*\[\s*zoom\s*\]/);
    expect(SOURCE).not.toMatch(/\}\s*,\s*\[\s*zoom[\s,\]]/);
  });

  it("throttles timeupdate state updates so playback does not flood React", () => {
    // The other half of the loop: timeupdate -> setCurrentTime every
    // frame. Must be throttled (currently via a 100ms timer ref).
    expect(SOURCE).toMatch(/timeupdate/);
    expect(SOURCE).toMatch(/displayUpdateTimerRef|throttle|setTimeout/);
  });

  it("memoizes the onRegionChange callback so the wavesurfer effect is stable", () => {
    // Recreating WaveSurfer on every render is another path to a loop —
    // the parent's region callback identity must be stable.
    expect(SOURCE).toMatch(/useCallback/);
  });
});
