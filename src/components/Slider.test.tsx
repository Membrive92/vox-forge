import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Slider } from "./Slider";

describe("Slider", () => {
  it("renders label and value", () => {
    render(<Slider label="Speed" value={75} onChange={() => {}} unit="%" />);
    expect(screen.getByText("Speed")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
  });

  it("has an accessible range input", () => {
    render(<Slider label="Volume" value={50} onChange={() => {}} min={0} max={100} />);
    const input = screen.getByRole("slider");
    expect(input).toHaveAttribute("min", "0");
    expect(input).toHaveAttribute("max", "100");
    expect(input).toHaveAttribute("aria-label", "Volume");
  });

  it("calls onChange when dragged", () => {
    const onChange = vi.fn();
    render(<Slider label="Pitch" value={0} onChange={onChange} min={-10} max={10} />);
    const input = screen.getByRole("slider");
    fireEvent.change(input, { target: { value: "5" } });
    expect(onChange).toHaveBeenCalledWith(5);
  });
});
