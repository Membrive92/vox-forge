/**
 * UX-01 tray contract: a job registered through the mirror renders in
 * the header tray with its kind label, detail and progress, and
 * clicking the entry fires the navigation intent back to the origin
 * tab (closing the dropdown). With nothing tracked the tray is absent.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { JobsProvider, useJobMirror, type JobMirror } from "@/hooks/jobsContext";
import { es } from "@/i18n/es";

import { JobsTray } from "./JobsTray";

function Feeder(mirror: JobMirror) {
  useJobMirror(mirror);
  return null;
}

function renderTray(mirrors: JobMirror[], onNavigate = vi.fn()) {
  render(
    <JobsProvider>
      {mirrors.map((m, i) => (
        <Feeder key={i} {...m} />
      ))}
      <JobsTray t={es} onNavigate={onNavigate} />
    </JobsProvider>,
  );
  return onNavigate;
}

describe("JobsTray", () => {
  it("is hidden while nothing is tracked", () => {
    renderTray([]);
    expect(screen.queryByRole("button", { name: es.jobsTrayLabel })).toBeNull();
  });

  it("lists a registered job and navigates to its origin tab on click", async () => {
    const onNavigate = renderTray([
      { active: true, kind: "chapter-synth", originTab: "workbench", label: "Capítulo 7" },
    ]);
    const user = userEvent.setup();

    const trayButton = screen.getByRole("button", { name: es.jobsTrayLabel });
    expect(trayButton).toHaveTextContent("1"); // running count
    await user.click(trayButton);

    const row = screen.getByRole("button", { name: new RegExp(es.jobKindChapterSynth) });
    expect(row).toHaveTextContent("Capítulo 7");
    expect(row).toHaveTextContent(es.jobsRunning); // indeterminate job

    await user.click(row);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("workbench");
    // The dropdown closes after navigating.
    expect(screen.queryByText(es.jobKindChapterSynth)).toBeNull();
  });

  it("shows chunk counters when the job reports them", async () => {
    renderTray([
      {
        active: true,
        kind: "quick-synth",
        originTab: "voices",
        progress: 0.4,
        chunksDone: 2,
        chunksTotal: 5,
      },
    ]);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: es.jobsTrayLabel }));
    const row = screen.getByRole("button", { name: new RegExp(es.jobKindQuickSynth) });
    expect(row).toHaveTextContent("2/5");
  });

  it("aggregates several running jobs in the badge count", async () => {
    renderTray([
      { active: true, kind: "conversion", originTab: "audio-tools" },
      { active: true, kind: "transcription", originTab: "studio" },
    ]);
    const user = userEvent.setup();

    const trayButton = screen.getByRole("button", { name: es.jobsTrayLabel });
    expect(trayButton).toHaveTextContent("2");
    await user.click(trayButton);
    expect(screen.getByText(es.jobKindConversion)).toBeInTheDocument();
    expect(screen.getByText(es.jobKindTranscription)).toBeInTheDocument();
  });
});
