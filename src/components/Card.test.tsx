import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Card } from "./Card";

describe("Card", () => {
  it("renders children", () => {
    render(<Card><p>Inside</p></Card>);
    expect(screen.getByText("Inside")).toBeInTheDocument();
  });

  it("applies md padding by default", () => {
    render(<Card data-testid="c">x</Card>);
    const el = screen.getByTestId("c") as HTMLDivElement;
    expect(el.style.padding).toBe("20px");
  });

  it("applies sm padding when requested", () => {
    render(<Card padding="sm" data-testid="c">x</Card>);
    expect((screen.getByTestId("c") as HTMLDivElement).style.padding).toBe("12px");
  });

  it("has the vf-card class", () => {
    render(<Card data-testid="c">x</Card>);
    expect(screen.getByTestId("c")).toHaveClass("vf-card");
  });
});
