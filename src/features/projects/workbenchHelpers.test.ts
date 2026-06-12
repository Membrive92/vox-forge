/**
 * UX-02: the "Will export: …" label must render every backend-resolved
 * export-source kind, distinguishing one-click masters from manual
 * Studio edits and stamping the edit's age.
 */
import { describe, expect, it } from "vitest";

import type { ChapterExportSource } from "@/api/chapterSynth";
import { es } from "@/i18n/es";

import { exportSourceLabel } from "./workbenchHelpers";

function source(overrides: Partial<ChapterExportSource>): ChapterExportSource {
  return {
    chapter_id: "ch-1",
    kind: "active_take",
    render_id: null,
    generation_id: null,
    created_at: null,
    mastered: false,
    ...overrides,
  };
}

describe("exportSourceLabel", () => {
  it("labels a manual Studio edit with its age", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    const label = exportSourceLabel(
      source({ kind: "studio_edit", render_id: "r1", created_at: fiveMinAgo }),
      es,
    );
    expect(label).toBe(
      es.chapterExportSourceStudio.replace(
        "{when}",
        es.timeMinutesAgo.replace("{n}", "5"),
      ),
    );
  });

  it("labels a mastered render distinctly from a manual edit", () => {
    const label = exportSourceLabel(
      source({
        kind: "studio_edit",
        render_id: "r1",
        mastered: true,
        created_at: new Date().toISOString(),
      }),
      es,
    );
    expect(label).toBe(
      es.chapterExportSourceMastered.replace("{when}", es.timeJustNow),
    );
  });

  it("labels the active take", () => {
    expect(exportSourceLabel(source({ kind: "active_take" }), es)).toBe(
      es.chapterExportSourceActive,
    );
  });

  it("labels the latest synthesis fallback", () => {
    expect(exportSourceLabel(source({ kind: "latest_generation" }), es)).toBe(
      es.chapterExportSourceLatest,
    );
  });

  it("labels fresh synthesis when nothing exists on disk", () => {
    expect(exportSourceLabel(source({ kind: "fresh_synthesis" }), es)).toBe(
      es.chapterExportSourceFresh,
    );
  });
});
