import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { IconButton } from "./IconButton";

describe("IconButton", () => {
  it("renders the child icon", () => {
    render(
      <IconButton aria-label="Play">
        <span data-testid="icon">▶</span>
      </IconButton>,
    );
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });

  it("requires an aria-label and exposes it as accessible name", () => {
    render(
      <IconButton aria-label="Pause">
        <span>II</span>
      </IconButton>,
    );
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });

  it("applies variant class", () => {
    render(
      <IconButton aria-label="Delete" variant="danger">
        <span>x</span>
      </IconButton>,
    );
    expect(screen.getByRole("button")).toHaveClass("vf-icon-btn-danger");
  });

  it("disables pointer events when disabled", () => {
    render(
      <IconButton aria-label="Stop" disabled>
        <span>■</span>
      </IconButton>,
    );
    const btn = screen.getByRole("button") as HTMLButtonElement;
    expect(btn).toBeDisabled();
    expect(btn.style.pointerEvents).toBe("none");
  });
});
