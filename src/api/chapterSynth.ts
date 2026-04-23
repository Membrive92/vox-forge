/** Chapter-level synthesis + chunk regen + audio upload API. */

import { API_BASE, ApiError, getJson, postForm } from "./client";

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

export interface UploadedChapterGeneration {
  id: string;
  chapter_id: string;
  engine: string;
  status: string;
  duration: number;
  file_path: string;
  output_format: string;
}

/** Save a pre-recorded audio file as a new generation for ``chapterId``.
 *
 * Works for both external recordings (user uploads a file) and the
 * in-app recorder's ``Blob`` output (wrap it in a ``File`` first). The
 * returned generation becomes the chapter's active take. */
export function uploadChapterAudio(
  chapterId: string,
  audio: File,
  signal?: AbortSignal,
): Promise<UploadedChapterGeneration> {
  const fd = new FormData();
  fd.append("audio", audio);
  return postForm<UploadedChapterGeneration>(
    `/chapters/${chapterId}/upload-audio`,
    fd,
    signal,
  );
}
