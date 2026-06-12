/**
 * QC-01 UI contract for ChunkMap:
 * - flagged chunks render an amber QC badge with the score;
 * - clicking the badge expands the expected-vs-transcribed comparison;
 * - the "Audio QC" button POSTs to /chapters/:id/qc, toasts the
 *   summary and reloads the chunk map so badges appear.
 *
 * Every test ends by awaiting the studio-edits chip, which only
 * renders after loadMap's trailing studio-renders fetch settles —
 * otherwise happy-dom's window teardown aborts the in-flight request
 * and pollutes the output with a spurious AbortError.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { server } from "@/__tests__/mocks/server";
import type { ChunkInfo } from "@/api/chapterSynth";
import { es } from "@/i18n/es";

import { ChunkMap } from "./ChunkMap";

function chunk(overrides: Partial<ChunkInfo>): ChunkInfo {
  return {
    index: 0,
    text: "La noche era oscura y tranquila.",
    status: "done",
    take_id: "take-1",
    duration: 2,
    qc_score: null,
    qc_flagged: false,
    qc_transcript: null,
    ...overrides,
  };
}

function mockChunkMap(chunks: ChunkInfo[], rendersCount = 1): void {
  server.use(
    http.get("/api/chapters/:id/chunks", () =>
      HttpResponse.json({ generation_id: "gen-1", chunks, total: chunks.length }),
    ),
    http.get("/api/studio/renders", () =>
      HttpResponse.json({
        renders: Array.from({ length: rendersCount }, (_, i) => ({ id: `r${i}` })),
      }),
    ),
  );
}

/** Resolves once the studio-renders fetch has settled and rendered. */
function editsChipSettled(n: number): Promise<HTMLElement> {
  return screen.findByText(es.chunkEditedCount.replace("{n}", String(n)));
}

function renderChunkMap(onToast = vi.fn()) {
  render(
    <ChunkMap
      t={es}
      chapterId="ch-1"
      chapterTitle="Capítulo 1"
      onToast={onToast}
      onOpenStudioWithSource={vi.fn()}
    />,
  );
  return onToast;
}

describe("ChunkMap QC badges", () => {
  it("shows an amber QC badge only on flagged chunks", async () => {
    mockChunkMap([
      chunk({ index: 0, qc_score: 1.0 }),
      chunk({
        index: 1,
        qc_score: 0.62,
        qc_flagged: true,
        qc_transcript: "La noche era whisky en el bar.",
      }),
    ]);
    renderChunkMap();

    const badge = await screen.findByRole("button", { name: "QC 62%" });
    expect(badge).toHaveAttribute("title", es.chunkQcBadgeHint);
    expect(screen.queryByRole("button", { name: "QC 100%" })).toBeNull();
    await editsChipSettled(1);
  });

  it("expands expected vs transcribed text when the badge is clicked", async () => {
    mockChunkMap([
      chunk({
        index: 0,
        qc_score: 0.5,
        qc_flagged: true,
        qc_transcript: "Texto transcrito divergente.",
      }),
    ]);
    renderChunkMap();
    const user = userEvent.setup();

    const badge = await screen.findByRole("button", { name: "QC 50%" });
    expect(screen.queryByText("Texto transcrito divergente.")).toBeNull();
    await user.click(badge);
    expect(screen.getByText("Texto transcrito divergente.")).toBeInTheDocument();
    expect(screen.getByText(`${es.chunkQcExpected}:`)).toBeInTheDocument();
    expect(screen.getByText(`${es.chunkQcTranscribed}:`)).toBeInTheDocument();
    await editsChipSettled(1);
  });

  it("runs QC from the header button, toasts the summary and reloads badges", async () => {
    let qcCalled = false;
    mockChunkMap([chunk({ index: 0 })]);
    server.use(
      http.post("/api/chapters/:id/qc", () => {
        qcCalled = true;
        return HttpResponse.json({
          generation_id: "gen-1",
          threshold: 0.9,
          total: 1,
          scored: 1,
          flagged: 1,
          skipped: 0,
          chunks: [
            {
              index: 0,
              qc_score: 0.7,
              qc_flagged: true,
              expected_text: "La noche era oscura y tranquila.",
              transcript: "La noche era rara.",
            },
          ],
        });
      }),
    );
    const onToast = renderChunkMap();
    const user = userEvent.setup();

    const qcButton = await screen.findByRole("button", { name: es.chunkQcRun });
    await editsChipSettled(1); // initial loadMap fully settled

    // The reload after QC must surface the freshly persisted flag.
    mockChunkMap(
      [chunk({ index: 0, qc_score: 0.7, qc_flagged: true, qc_transcript: "La noche era rara." })],
      2,
    );
    await user.click(qcButton);

    await waitFor(() => expect(qcCalled).toBe(true));
    await waitFor(() =>
      expect(onToast).toHaveBeenCalledWith(
        es.chunkQcToast.replace("{flagged}", "1").replace("{scored}", "1"),
      ),
    );
    expect(await screen.findByRole("button", { name: "QC 70%" })).toBeInTheDocument();
    await editsChipSettled(2); // second loadMap fully settled
  });
});
