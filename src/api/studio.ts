/** Studio module API client. */

import {
  API_BASE,
  ApiError,
  deleteResource,
  getJson,
  postForm,
  postJson,
} from "./client";
import type {
  MediaAssetDTO,
  MediaAssetsResponseDTO,
  MediaGenerateRequestDTO,
} from "./types";

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

export function getGenerationAudioUrl(filePath: string): string {
  // Generations live in OUTPUT_DIR, which is in the allowed roots for /studio/audio.
  return `${API_BASE}/studio/audio?path=${encodeURIComponent(filePath)}`;
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

// ── Scene detection (PROD-03) ─────────────────────────────────────

export interface DetectedScene {
  start_s: number;
  end_s: number;
  /** First words spoken in the scene — label for its image slot. */
  text_summary: string;
}

interface DetectScenesResponse {
  scenes: DetectedScene[];
  count: number;
}

/**
 * Group an SRT transcript into ~`targetSceneSeconds` scenes, each a slot
 * for one slideshow image (feeds `renderVideo`'s `images` list).
 *
 * No UI consumer yet by design: the montage UI arrives with UX-03/M5
 * (`internal-docs/studio-montage-redesign.md`) — do not prune.
 */
export async function detectScenes(
  srtPath: string,
  targetSceneSeconds = 25,
  signal?: AbortSignal,
): Promise<DetectedScene[]> {
  const body = await postJson<DetectScenesResponse>(
    "/studio/scenes/detect",
    { srt_path: srtPath, target_scene_seconds: targetSceneSeconds },
    signal,
  );
  return body.scenes;
}

// ── Video rendering (Phase B.2) ───────────────────────────────────

export interface VideoOptions {
  resolution: "1920x1080" | "1280x720";
  ken_burns: boolean;
  waveform_overlay: boolean;
  title_text: string | null;
  subtitles_mode: "none" | "burn" | "soft";
  crossfade_s: number;
}

export const DEFAULT_VIDEO_OPTIONS: VideoOptions = {
  resolution: "1920x1080",
  ken_burns: true,
  waveform_overlay: true,
  title_text: null,
  subtitles_mode: "burn",
  crossfade_s: 1.0,
};

export interface VideoImage {
  /** Absolute path — must live under one of the allowed Studio roots. */
  path: string;
  /** When this image should start showing, in seconds from audio start. */
  start_s: number;
}

export interface CoverUploadResult {
  filename: string;
  path: string;
  size_kb: number;
  content_type: string;
}

export interface RenderVideoPayload {
  audio_path: string;
  /** Optional when ``images`` is provided. */
  cover_path?: string | null;
  subtitles_path?: string | null;
  project_id?: string | null;
  chapter_id?: string | null;
  /** If non-empty, slideshow mode — one image per scene, chained by xfade. */
  images?: VideoImage[] | null;
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

// ── Image generation (Phase B.3) ──────────────────────────────────

export type ImageAspectRatio = "16:9" | "9:16" | "1:1" | "4:3";

export interface GenerateImageResult {
  filename: string;
  path: string;
  provider: string;
  aspect_ratio: ImageAspectRatio;
  seed: number;
  size_kb: number;
}

export interface ImageProviderStatus {
  name: string;
  available: boolean;
  server_url: string | null;
  error: string | null;
}

/** Probe the configured image provider (PROD-02, plan F2). The
 * generation dialog warns up front instead of letting the user write a
 * prompt that is guaranteed to fail. */
export function getImageProviderStatus(signal?: AbortSignal): Promise<ImageProviderStatus> {
  return getJson<ImageProviderStatus>("/studio/image-provider/status", signal);
}

export function generateImage(
  prompt: string,
  aspectRatio: ImageAspectRatio = "16:9",
  seed?: number,
  signal?: AbortSignal,
): Promise<GenerateImageResult> {
  const body: Record<string, unknown> = {
    prompt,
    aspect_ratio: aspectRatio,
  };
  if (seed !== undefined) body["seed"] = seed;
  return postJson<GenerateImageResult>("/studio/generate-image", body, signal);
}

// ── Media library (T2I-2 / UX-03 M1-M2) ──────────────────────────

/** CamelCase view of a ``media_assets`` row. The backend serves the
 * binary by id, so the client never touches ``filename`` directly —
 * use {@link mediaFileUrl}. */
export interface MediaAsset {
  id: string;
  kind: "image" | "clip";
  filename: string;
  thumbFilename: string | null;
  origin: "upload" | "imported" | "generated";
  sourcePath: string | null;
  metaJson: string | null;
  width: number | null;
  height: number | null;
  durationS: number | null;
  prompt: string | null;
  seed: number | null;
  aspectRatio: string | null;
  createdAt: string;
}

function toMediaAsset(dto: MediaAssetDTO): MediaAsset {
  return {
    id: dto.id,
    kind: (dto.kind === "clip" ? "clip" : "image"),
    filename: dto.filename,
    thumbFilename: dto.thumb_filename ?? null,
    origin: (dto.origin as MediaAsset["origin"]),
    sourcePath: dto.source_path ?? null,
    metaJson: dto.meta_json ?? null,
    width: dto.width ?? null,
    height: dto.height ?? null,
    durationS: dto.duration_s ?? null,
    prompt: dto.prompt ?? null,
    seed: dto.seed ?? null,
    aspectRatio: dto.aspect_ratio ?? null,
    createdAt: dto.created_at,
  };
}

export interface GenerateIntoLibraryInput {
  prompt: string;
  aspectRatio?: ImageAspectRatio;
  seed?: number;
  count?: number;
}

/** Generate ``count`` images straight into the media library. Each one
 * becomes its own asset row (``origin='generated'``); the batch runs
 * sequentially on the backend (one shared GPU). */
export async function generateIntoLibrary(
  input: GenerateIntoLibraryInput,
  signal?: AbortSignal,
): Promise<MediaAsset[]> {
  const body: MediaGenerateRequestDTO = {
    prompt: input.prompt,
    aspect_ratio: input.aspectRatio ?? "16:9",
    count: input.count ?? 1,
  };
  if (input.seed !== undefined) body.seed = input.seed;
  const res = await postJson<MediaAssetsResponseDTO, MediaGenerateRequestDTO>(
    "/studio/media/generate",
    body,
    signal,
  );
  return res.assets.map(toMediaAsset);
}

export interface ListMediaOptions {
  kind?: "image" | "clip";
  origin?: "upload" | "imported" | "generated";
  /** Case-insensitive substring match against the prompt. */
  query?: string;
}

export async function listMedia(
  options: ListMediaOptions = {},
  signal?: AbortSignal,
): Promise<MediaAsset[]> {
  const params = new URLSearchParams();
  if (options.kind) params.set("kind", options.kind);
  if (options.origin) params.set("origin", options.origin);
  if (options.query) params.set("q", options.query);
  const qs = params.toString();
  const res = await getJson<MediaAssetsResponseDTO>(
    `/studio/media${qs ? `?${qs}` : ""}`,
    signal,
  );
  return res.assets.map(toMediaAsset);
}

export async function deleteMedia(assetId: string): Promise<void> {
  await deleteResource(`/studio/media/${assetId}`);
}

/** Direct URL to an asset's bytes, served by id. Use as an ``<img>``
 * src; pass ``thumb`` for the 256px thumbnail. */
export function mediaFileUrl(assetId: string, thumb = false): string {
  return `${API_BASE}/studio/media/file/${encodeURIComponent(assetId)}${thumb ? "?thumb=true" : ""}`;
}

export async function renderVideo(
  payload: RenderVideoPayload,
  signal?: AbortSignal,
): Promise<RenderVideoResult> {
  // Strip keys the backend doesn't need (cover_path is optional now;
  // sending it as undefined is fine but explicit null is cleaner).
  const body: Record<string, unknown> = {
    audio_path: payload.audio_path,
    options: { ...DEFAULT_VIDEO_OPTIONS, ...(payload.options ?? {}) },
  };
  if (payload.cover_path) body["cover_path"] = payload.cover_path;
  if (payload.subtitles_path) body["subtitles_path"] = payload.subtitles_path;
  if (payload.project_id) body["project_id"] = payload.project_id;
  if (payload.chapter_id) body["chapter_id"] = payload.chapter_id;
  if (payload.images && payload.images.length > 0) body["images"] = payload.images;

  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
