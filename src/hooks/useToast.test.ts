import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useToast } from "./useToast";

describe("useToast", () => {
  it("starts with an empty stack", () => {
    const { result } = renderHook(() => useToast());
    expect(result.current.toasts).toEqual([]);
  });

  it("adds a toast and removes it after the auto-dismiss timeout", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToast());

    act(() => result.current.show("Hello"));
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0]?.message).toBe("Hello");

    // Default duration is 4000ms (info type)
    act(() => vi.advanceTimersByTime(4000));
    expect(result.current.toasts).toHaveLength(0);

    vi.useRealTimers();
  });

  it("stacks multiple toasts simultaneously", () => {
    const { result } = renderHook(() => useToast());

    act(() => result.current.show("First"));
    act(() => result.current.show("Second"));

    expect(result.current.toasts).toHaveLength(2);
    expect(result.current.toasts[0]?.message).toBe("First");
    expect(result.current.toasts[1]?.message).toBe("Second");
  });

  it("dismiss removes the matching toast immediately", () => {
    const { result } = renderHook(() => useToast());

    act(() => result.current.show("First"));
    act(() => result.current.show("Second"));
    const firstId = result.current.toasts[0]?.id ?? "";

    act(() => result.current.dismiss(firstId));
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0]?.message).toBe("Second");
  });

  it("auto-detects error type from message prefix", () => {
    const { result } = renderHook(() => useToast());
    act(() => result.current.show("Error: something failed"));
    expect(result.current.toasts[0]?.type).toBe("error");
  });

  it("auto-detects success type from message keywords", () => {
    const { result } = renderHook(() => useToast());
    act(() => result.current.show("Profile saved"));
    expect(result.current.toasts[0]?.type).toBe("success");
  });

  it("respects an explicit type override", () => {
    const { result } = renderHook(() => useToast());
    act(() => result.current.show("Heads up", "warning"));
    expect(result.current.toasts[0]?.type).toBe("warning");
  });
});
