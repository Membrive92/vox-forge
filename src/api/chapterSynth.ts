/** Chapter-level synthesis + chunk regen API. */

import { API_BASE, ApiError, getJson } from "./client";

export interface ChunkInfo {
  index: number;
  text: string;
  status: string;
  take_id: string | null;
  duration: number;
}

export interface ChunkMapResponse {
  generation_id: string | null;
  chunks: ChunkInfo[];
  total: number;
}

export interface ChapterSynthResult {
  blob: Blob;
  duration: number;
  generationId: string;
  engine: string;
  chunks: number;
}

export async function synthesizeChapter(
  chapterId: string,
  signal?: AbortSignal,
): Promise<ChapterSynthResult> {
  const init: RequestInit = { method: "POST" };
  if (signal) init.signal = signal;
  const res = await fetch(`${API_BASE}/chapters/${chapterId}/synthesize`, init);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const b = (await res.json()) as { detail?: string };
      if (b.detail) detail = b.detail;
    } catch { /* ignore */ }
    throw new ApiError(res.status, detail);
  }
  const duration = Number.parseFloat(res.headers.get("X-Audio-Duration") ?? "0");
  const generationId = res.headers.get("X-Generation-ID") ?? "";
  const engine = res.headers.get("X-Audio-Engine") ?? "edge-tts";
  const chunks = Number.parseInt(res.headers.get("X-Audio-Chunks") ?? "1", 10);
  const blob = await res.blob();
  return { blob, duration, generationId, engine, chunks };
}

export function getChunkMap(chapterId: string): Promise<ChunkMapResponse> {
  return getJson<ChunkMapResponse>(`/chapters/${chapterId}/chunks`);
}

export async function regenerateChunk(
  chapterId: string,
  chunkIndex: number,
  signal?: AbortSignal,
): Promise<Blob> {
  const init: RequestInit = { method: "POST" };
  if (signal) init.signal = signal;
  const res = await fetch(
    `${API_BASE}/chapters/${chapterId}/regenerate-chunk/${chunkIndex}`,
    init,
  );
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const b = (await res.json()) as { detail?: string };
      if (b.detail) detail = b.detail;
    } catch { /* ignore */ }
    throw new ApiError(res.status, detail);
  }
  return res.blob();
}
