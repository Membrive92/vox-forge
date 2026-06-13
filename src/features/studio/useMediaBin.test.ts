import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  deleteMedia,
  generateIntoLibrary,
  listMedia,
  mediaFileUrl,
} from "@/api/studio";
import { resetMedia, seedMediaAsset } from "@/__tests__/mocks/handlers";

import { useMediaBin } from "./useMediaBin";

afterEach(() => resetMedia());

describe("studio media API client", () => {
  it("generates into the library and returns camelCase assets", async () => {
    const assets = await generateIntoLibrary({
      prompt: "a quiet forest",
      aspectRatio: "9:16",
      seed: 42,
      count: 2,
    });
    expect(assets).toHaveLength(2);
    expect(assets[0]?.prompt).toBe("a quiet forest");
    expect(assets[0]?.aspectRatio).toBe("9:16");
    // Batch steps the seed per image.
    expect(assets[0]?.seed).toBe(42);
    expect(assets[1]?.seed).toBe(43);
    expect(assets[0]?.kind).toBe("image");
    expect(assets[0]?.origin).toBe("generated");
  });

  it("lists assets and filters by prompt substring", async () => {
    seedMediaAsset({ prompt: "tower at dusk" });
    seedMediaAsset({ prompt: "ocean waves" });
    const all = await listMedia({ kind: "image" });
    expect(all).toHaveLength(2);
    const filtered = await listMedia({ kind: "image", query: "ocean" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.prompt).toBe("ocean waves");
  });

  it("builds a by-id file url with an optional thumbnail flag", () => {
    expect(mediaFileUrl("abc")).toMatch(/\/studio\/media\/file\/abc$/);
    expect(mediaFileUrl("abc", true)).toMatch(/\/studio\/media\/file\/abc\?thumb=true$/);
  });

  it("deletes an asset by id", async () => {
    const seeded = seedMediaAsset({ prompt: "to delete" });
    await deleteMedia(seeded.id);
    const remaining = await listMedia({ kind: "image" });
    expect(remaining).toHaveLength(0);
  });
});

describe("useMediaBin", () => {
  it("loads existing images on mount", async () => {
    seedMediaAsset({ prompt: "first" });
    const { result } = renderHook(() => useMediaBin());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.assets).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it("prepends freshly generated assets without a reload", async () => {
    const { result } = renderHook(() => useMediaBin());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const generated = await generateIntoLibrary({ prompt: "new one", count: 1 });
    act(() => result.current.prepend(generated));

    expect(result.current.assets).toHaveLength(1);
    expect(result.current.assets[0]?.prompt).toBe("new one");

    // Prepending the same id again is a no-op (no duplicate tile).
    act(() => result.current.prepend(generated));
    expect(result.current.assets).toHaveLength(1);
  });

  it("removes an asset from the list", async () => {
    const seeded = seedMediaAsset({ prompt: "remove me" });
    const { result } = renderHook(() => useMediaBin());
    await waitFor(() => expect(result.current.assets).toHaveLength(1));

    await act(async () => {
      await result.current.remove(seeded.id);
    });
    expect(result.current.assets).toHaveLength(0);
  });

  it("refreshes with a prompt query", async () => {
    seedMediaAsset({ prompt: "keep this" });
    seedMediaAsset({ prompt: "drop this" });
    const { result } = renderHook(() => useMediaBin());
    await waitFor(() => expect(result.current.assets).toHaveLength(2));

    await act(async () => {
      await result.current.refresh({ kind: "image", query: "keep" });
    });
    expect(result.current.assets).toHaveLength(1);
    expect(result.current.assets[0]?.prompt).toBe("keep this");
  });
});
