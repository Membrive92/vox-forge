import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { resetProfiles } from "@/__tests__/mocks/handlers";

import { useProfiles } from "./useProfiles";

afterEach(() => resetProfiles());

describe("useProfiles", () => {
  it("starts empty and loads from API", async () => {
    const { result } = renderHook(() => useProfiles());
    // Initially empty
    expect(result.current.profiles).toEqual([]);

    // Loads from mock (empty list)
    await waitFor(() => {
      expect(result.current.error).toBeNull();
    });
  });

  it("creates a profile and adds to list", async () => {
    const { result } = renderHook(() => useProfiles());
    await waitFor(() => expect(result.current.error).toBeNull());

    let created: Awaited<ReturnType<typeof result.current.create>> | undefined;
    await act(async () => {
      created = await result.current.create({
        name: "Nuevo",
        voiceId: "es-ES-AlvaroNeural",
        language: "es",
        speed: 100,
        pitch: 0,
        volume: 80,
        sampleFile: null,
      });
    });

    expect(created?.name).toBe("Nuevo");
    expect(result.current.profiles).toHaveLength(1);
    expect(result.current.profiles[0]?.name).toBe("Nuevo");
  });

  it("updates a profile in the list", async () => {
    const { result } = renderHook(() => useProfiles());
    await waitFor(() => expect(result.current.error).toBeNull());

    let id = "";
    await act(async () => {
      const created = await result.current.create({
        name: "Original",
        voiceId: "es-ES-AlvaroNeural",
        language: "es",
        speed: 100,
        pitch: 0,
        volume: 80,
        sampleFile: null,
      });
      id = created.id;
    });

    await act(async () => {
      await result.current.update(id, { name: "Editado" });
    });

    expect(result.current.profiles[0]?.name).toBe("Editado");
  });

  it("removes a profile from the list", async () => {
    const { result } = renderHook(() => useProfiles());
    await waitFor(() => expect(result.current.error).toBeNull());

    let id = "";
    await act(async () => {
      const created = await result.current.create({
        name: "Borrar",
        voiceId: "es-ES-AlvaroNeural",
        language: "es",
        speed: 100,
        pitch: 0,
        volume: 80,
        sampleFile: null,
      });
      id = created.id;
    });

    await act(async () => {
      await result.current.remove(id);
    });

    expect(result.current.profiles).toHaveLength(0);
  });
});
