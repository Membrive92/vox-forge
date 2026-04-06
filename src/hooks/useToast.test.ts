import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useToast } from "./useToast";

describe("useToast", () => {
  it("starts invisible", () => {
    const { result } = renderHook(() => useToast());
    expect(result.current.visible).toBe(false);
    expect(result.current.message).toBe("");
  });

  it("shows message and hides after timeout", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToast(1000));

    act(() => result.current.show("Hello"));
    expect(result.current.visible).toBe(true);
    expect(result.current.message).toBe("Hello");

    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.visible).toBe(false);

    vi.useRealTimers();
  });

  it("replaces message if shown again before timeout", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToast(2000));

    act(() => result.current.show("First"));
    act(() => vi.advanceTimersByTime(500));
    act(() => result.current.show("Second"));

    expect(result.current.message).toBe("Second");
    expect(result.current.visible).toBe(true);

    // First timer was cleared, only second counts
    act(() => vi.advanceTimersByTime(1500));
    expect(result.current.visible).toBe(true); // still within 2s of "Second"

    act(() => vi.advanceTimersByTime(500));
    expect(result.current.visible).toBe(false);

    vi.useRealTimers();
  });
});
