import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Toast } from "./Toast";

describe("Toast", () => {
  it("renders message", () => {
    render(<Toast message="Saved!" visible={true} />);
    expect(screen.getByText("Saved!")).toBeInTheDocument();
  });

  it("has accessible role", () => {
    render(<Toast message="Info" visible={true} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("is visually hidden when not visible (opacity 0)", () => {
    render(<Toast message="Hidden" visible={false} />);
    const el = screen.getByRole("status");
    expect(el.style.opacity).toBe("0");
  });
});
