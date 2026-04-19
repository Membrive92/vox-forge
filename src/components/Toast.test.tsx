import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ToastItem } from "@/hooks/useToast";

import { Toast } from "./Toast";

function makeToast(overrides: Partial<ToastItem> = {}): ToastItem {
  return {
    id: "t1",
    message: "Saved!",
    type: "success",
    durationMs: 3000,
    ...overrides,
  };
}

describe("Toast", () => {
  it("renders all messages in the stack", () => {
    render(
      <Toast
        toasts={[
          makeToast({ id: "a", message: "First" }),
          makeToast({ id: "b", message: "Second" }),
        ]}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("has accessible role", () => {
    render(<Toast toasts={[makeToast({ message: "Info" })]} onDismiss={() => {}} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders an empty container when the stack is empty", () => {
    render(<Toast toasts={[]} onDismiss={() => {}} />);
    const region = screen.getByRole("status");
    expect(region.children.length).toBe(0);
  });

  it("calls onDismiss when × button is clicked", () => {
    const onDismiss = vi.fn();
    render(
      <Toast
        toasts={[makeToast({ id: "x", message: "Click me" })]}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByLabelText("Dismiss notification"));
    expect(onDismiss).toHaveBeenCalledWith("x");
  });
});
