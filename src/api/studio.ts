/** Studio module API client. */

import {
  API_BASE,
  ApiError,
  deleteResource,
  getJson,
  postForm,
  postJson,
} from "./client";

export type EditOperationType =
  | "trim"
  | "delete_region"
  | "fade_in"
  | "fade_out"
  | "normalize"
  | "loudness"
  | "denoise"
  | "compressor";

export interface StudioOperation {
  type: EditOperationType;
  params: Record<string, number>;
}

export interface StudioSource {
  id: string;
  kind: "chapter" | "mix";
  project_id: string | null;
  chapter_id: string | null;
  project_name: string;
  chapter_title: string;
  source_path: string;
  duration_s: number;
  created_at: string;
}

interface StudioSourcesResponse {
  sources: StudioSource[];
  count: number;
}

export interface StudioEditResult {
  blob: Blob;
  operationsCount: number;
}

export async function listStudioSources(): Promise<StudioSource[]> {
  const body = await getJson<StudioSourcesResponse>("/studio/sources");
  return body.sources;
}

export function getStudioAudioUrl(path: string): string {
  return `${API_BASE}/studio/audio?path=${encodeURIComponent(path)}`;
}

export interface SrtEntry {
  index: number;
  start_s: number;
  end_s: number;
  text: string;
}

export interface TranscribeResult {
  srt_path: string;
  duration_s: number;
  word_count: number;
  language: string;
  engine: string;
  entries: SrtEntry[];
}

export function transcribeSource(
  sourcePath: string,
  options: { model?: string; language?: string } = {},
  signal?: AbortSignal,
): Promise<TranscribeResult> {
  return postJson<TranscribeResult>(
    "/studio/transcribe",
    {
      source_path: sourcePath,
      model: options.model ?? "small",
      language: options.language ?? null,
    },
    signal,
  );
}

// ── Video rendering (Phase B.2) ───────────────────────────────────

export interface VideoOptions {
  resolution: "1920x1080" | "1280x720";
  ken_burns: boolean;
  waveform_overlay: boolean;
  title_text: string | null;
  subtitles_mode: "none" | "burn" | "soft";
}

export const DEFAULT_VIDEO_OPTIONS: VideoOptions = {
  resolution: "1920x1080",
  ken_burns: true,
  waveform_overlay: true,
  title_text: null,
  subtitles_mode: "burn",
};

export interface CoverUploadResult {
  filename: string;
  path: string;
  size_kb: number;
  content_type: string;
}

export interface RenderVideoPayload {
  audio_path: string;
  cover_path: string;
  subtitles_path?: string | null;
  project_id?: string | null;
  chapter_id?: string | null;
  options?: Partial<VideoOptions>;
}

export interface RenderVideoResult {
  blob: Blob;
  durationS: number;
  sizeBytes: number;
  resolution: string;
}

export interface StudioRender {
  id: string;
  kind: "audio" | "video";
  source_path: string;
  output_path: string;
  operations: string | null;
  project_id: string | null;
  chapter_id: string | null;
  duration_s: number;
  size_bytes: number;
  created_at: string;
}

interface StudioRendersResponse {
  renders: StudioRender[];
  count: number;
}

export async function uploadCover(file: File): Promise<CoverUploadResult> {
  const fd = new FormData();
  fd.append("cover", file);
  return postForm<CoverUploadResult>("/studio/upload-cover", fd);
}

export async function renderVideo(
  payload: RenderVideoPayload,
  signal?: AbortSignal,
): Promise<RenderVideoResult> {
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...payload,
      options: { ...DEFAULT_VIDEO_OPTIONS, ...(payload.options ?? {}) },
    }),
  };
  if (signal) init.signal = signal;
  const res = await fetch(`${API_BASE}/studio/render-video`, init);
  if (!res.ok) {
    let detail = res.statusText;
    let code: string | undefined;
    try {
      const b = (await res.json()) as { detail?: string; code?: string };
      if (b.detail) detail = b.detail;
      code = b.code;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail, code);
  }
  const durationS = Number.parseFloat(res.headers.get("X-Video-Duration") ?? "0");
  const sizeBytes = Number.parseInt(res.headers.get("X-Video-Size") ?? "0", 10);
  const resolution = res.headers.get("X-Video-Resolution") ?? "";
  const blob = await res.blob();
  return { blob, durationS, sizeBytes, resolution };
}

export interface ListRendersOptions {
  kind?: "audio" | "video";
  chapterId?: string;
  limit?: number;
}

export async function listStudioRenders(
  options: ListRendersOptions = {},
): Promise<StudioRender[]> {
  const params = new URLSearchParams();
  if (options.kind) params.set("kind", options.kind);
  if (options.chapterId) params.set("chapter_id", options.chapterId);
  params.set("limit", String(options.limit ?? 50));
  const body = await getJson<StudioRendersResponse>(`/studio/renders?${params.toString()}`);
  return body.renders;
}

export async function deleteStudioRender(renderId: string): Promise<void> {
  await deleteResource(`/studio/renders/${renderId}`);
}

// ── Audio edit (Phase A) ─────────────────────────────────────────

export interface ApplyEditContext {
  projectId?: string | null;
  chapterId?: string | null;
}

export async function applyEdit(
  sourcePath: string,
  operations: StudioOperation[],
  outputFormat: string,
  context: ApplyEditContext = {},
  signal?: AbortSignal,
): Promise<StudioEditResult> {
  const body: Record<string, unknown> = {
    source_path: sourcePath,
    operations,
    output_format: outputFormat,
  };
  if (context.projectId) body["project_id"] = context.projectId;
  if (context.chapterId) body["chapter_id"] = context.chapterId;

  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
  if (signal) init.signal = signal;
  const res = await fetch(`${API_BASE}/studio/edit`, init);
  if (!res.ok) {
    let detail = res.statusText;
    let code: string | undefined;
    try {
      const b = (await res.json()) as { detail?: string; code?: string };
      if (b.detail) detail = b.detail;
      code = b.code;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail, code);
  }
  const operationsCount = Number.parseInt(
    res.headers.get("X-Operations-Count") ?? String(operations.length),
    10,
  );
  const blob = await res.blob();
  return { blob, operationsCount };
}
