/**
 * BAJO-31 — the operation queue exposes per-row reorder buttons wired to
 * the session's moveOperation(from, to). Edge rows have the impossible
 * direction disabled so the queue can't be moved out of bounds.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { StudioOperation } from "@/api/studio";
import { es } from "@/i18n/es";

import { EditOperationsPanel } from "./EditOperationsPanel";

const OPS: StudioOperation[] = [
  { type: "fade_in", params: { duration_ms: 1000 } },
  { type: "normalize", params: { headroom_db: -1 } },
  { type: "fade_out", params: { duration_ms: 500 } },
];

function renderPanel(operations: StudioOperation[] = OPS) {
  const onMove = vi.fn();
  render(
    <EditOperationsPanel
      t={es}
      region={null}
      operations={operations}
      isProcessing={false}
      outputFormat="mp3"
      onAdd={vi.fn()}
      onRemove={vi.fn()}
      onMove={onMove}
      onClear={vi.fn()}
      onApply={vi.fn()}
      onApplyPreview={vi.fn()}
      onCancelApply={vi.fn()}
      onClearRegion={vi.fn()}
      onOutputFormatChange={vi.fn()}
      onNeedRegion={vi.fn()}
    />,
  );
  return onMove;
}

describe("EditOperationsPanel info tips (BAJO-21)", () => {
  it("exposes each DSP tip as a toggle button with aria-expanded/aria-controls", async () => {
    renderPanel();
    const user = userEvent.setup();

    const lufsToggle = screen.getByRole("button", { name: es.studioLufsTarget });
    expect(lufsToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(es.studioLufsTip)).not.toBeInTheDocument();

    await user.click(lufsToggle);
    expect(lufsToggle).toHaveAttribute("aria-expanded", "true");
    const panel = document.getElementById(lufsToggle.getAttribute("aria-controls")!);
    expect(panel).toHaveTextContent(es.studioLufsTip);

    await user.click(lufsToggle);
    expect(lufsToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(es.studioLufsTip)).not.toBeInTheDocument();
  });

  it("opening another tip closes the previous one", async () => {
    renderPanel();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: es.studioLufsTarget }));
    expect(screen.getByText(es.studioLufsTip)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: es.studioDenoiseStrength }));
    expect(screen.getByText(es.studioDenoiseTip)).toBeInTheDocument();
    expect(screen.queryByText(es.studioLufsTip)).not.toBeInTheDocument();
  });
});

describe("EditOperationsPanel reorder", () => {
  it("moves an operation up and down via the row buttons", async () => {
    const onMove = renderPanel();
    const user = userEvent.setup();

    const upButtons = screen.getAllByRole("button", { name: es.studioMoveOpUp });
    const downButtons = screen.getAllByRole("button", { name: es.studioMoveOpDown });
    expect(upButtons).toHaveLength(3);
    expect(downButtons).toHaveLength(3);

    await user.click(upButtons[1]!);
    expect(onMove).toHaveBeenCalledWith(1, 0);

    await user.click(downButtons[1]!);
    expect(onMove).toHaveBeenCalledWith(1, 2);
  });

  it("disables up on the first row and down on the last row", () => {
    renderPanel();

    const upButtons = screen.getAllByRole("button", { name: es.studioMoveOpUp });
    const downButtons = screen.getAllByRole("button", { name: es.studioMoveOpDown });

    expect(upButtons[0]).toBeDisabled();
    expect(upButtons[2]).toBeEnabled();
    expect(downButtons[0]).toBeEnabled();
    expect(downButtons[2]).toBeDisabled();
  });
});
