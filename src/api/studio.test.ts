/**
 * S1: "subtitles, no waveform" is the natural default. The burned-in
 * waveform overlaps the subtitle band, so a fresh render should ship with
 * the waveform off and subtitles ready to burn once a transcript exists.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_VIDEO_OPTIONS } from "./studio";

describe("DEFAULT_VIDEO_OPTIONS", () => {
  it("ships with the waveform overlay disabled (S1)", () => {
    expect(DEFAULT_VIDEO_OPTIONS.waveform_overlay).toBe(false);
  });

  it("keeps subtitles set to burn so a transcript renders subs by default", () => {
    expect(DEFAULT_VIDEO_OPTIONS.subtitles_mode).toBe("burn");
  });
});
