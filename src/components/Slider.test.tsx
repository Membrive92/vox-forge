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

  it("marks the degraded zones on the track", () => {
    render(
      <Slider
        label="Speed"
        value={1}
        onChange={() => {}}
        min={0.5}
        max={2}
        degradedBelow={0.75}
        degradedAbove={1.25}
        degradedInfo="Voice degrades beyond this range"
      />,
    );
    expect(screen.getByTestId("slider-degraded-low")).toBeInTheDocument();
    expect(screen.getByTestId("slider-degraded-high")).toBeInTheDocument();
    // Value inside the safe range -> no warning shown
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the degraded warning when the value leaves the safe range", () => {
    render(
      <Slider
        label="Speed"
        value={1.6}
        onChange={() => {}}
        min={0.5}
        max={2}
        degradedBelow={0.75}
        degradedAbove={1.25}
        degradedInfo="Voice degrades beyond this range"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Voice degrades beyond this range",
    );
  });
});
