/** Chapter-level synthesis + chunk regen + audio upload API. */

import { API_BASE, ApiError, getJson, postForm, postJson } from "./client";

export interface ChunkInfo {
  index: number;
  text: string;
  status: string;
  take_id: string | null;
  duration: number;
  /** ASR-diff QC score in [0,1]; null until a QC pass runs (or when no
   * per-chunk audio was available to transcribe). */
  qc_score: number | null;
  qc_flagged: boolean;
  qc_transcript: string | null;
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

export interface ChunkQCInfo {
  index: number;
  qc_score: number | null;
  qc_flagged: boolean;
  expected_text: string;
  transcript: string | null;
}

export interface ChapterQCResponse {
  generation_id: string;
  threshold: number;
  total: number;
  scored: number;
  flagged: number;
  skipped: number;
  chunks: ChunkQCInfo[];
}

/** Run ASR-diff QC on the chapter's completed generation: transcribe
 * each chunk and flag the ones whose transcript diverges from the
 * chapter text. Scores persist server-side — `getChunkMap` reflects
 * them on every subsequent load. */
export function runChapterQC(
  chapterId: string,
  signal?: AbortSignal,
): Promise<ChapterQCResponse> {
  return postJson<ChapterQCResponse, Record<string, never>>(
    `/chapters/${chapterId}/qc`,
    {},
    signal,
  );
}

export interface RegenChunkResult {
  /** Audio of the regenerated chunk (for auditioning). */
  blob: Blob;
  /** True if the whole-chapter audio was rebuilt so the player/export
   * reflect the change; false means only this chunk's take was updated
   * (e.g. cloned voices don't persist per-chunk audio yet). */
  respliced: boolean;
  engine: string;
}

export async function regenerateChunk(
  chapterId: string,
  chunkIndex: number,
  signal?: AbortSignal,
): Promise<RegenChunkResult> {
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
  const respliced = res.headers.get("X-Chapter-Respliced") === "true";
  const engine = res.headers.get("X-Audio-Engine") ?? "edge-tts";
  const blob = await res.blob();
  return { blob, respliced, engine };
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
