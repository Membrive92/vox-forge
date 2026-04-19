import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Button } from "./Button";

describe("Button", () => {
  it("renders children", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole("button", { name: "Click me" })).toBeInTheDocument();
  });

  it("fires onClick when clicked", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not fire onClick when disabled", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick} disabled>Go</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("shows a spinner in loading state", () => {
    render(<Button loading>Generating</Button>);
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    // Spinner is the first child (aria-hidden span)
    expect(btn.querySelector("span[aria-hidden]")).not.toBeNull();
  });

  it("applies the variant class", () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole("button")).toHaveClass("vf-btn-danger");
  });

  it("respects fullWidth", () => {
    render(<Button fullWidth>Wide</Button>);
    const btn = screen.getByRole("button") as HTMLButtonElement;
    expect(btn.style.width).toBe("100%");
  });
});