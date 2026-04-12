/** TTS synthesis endpoint. */

import type { SynthesisParams } from "@/types/domain";

import { API_BASE, ApiError, getJson, type AudioResponse } from "./client";
import type { SynthesisRequestDTO } from "./types";

export interface JobProgressDTO {
  job_id: string;
  status: string;
  chunks_done: number;
  chunks_total: number;
  current_step: string;
  error: string | null;
}

export function newJobId(): string {
  return Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8);
}

export async function synthesize(
  params: SynthesisParams,
  jobId?: string,
): Promise<AudioResponse> {
  const body: SynthesisRequestDTO = {
    text: params.text,
    voice_id: params.voiceId,
    output_format: params.format,
    speed: params.speed,
    pitch: params.pitch,
    volume: params.volume,
    profile_id: params.profileId ?? null,
    title: params.title ?? null,
    artist: params.artist ?? null,
    album: params.album ?? null,
    track_number: params.trackNumber ?? null,
  };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (jobId) headers["X-Synthesis-Job-ID"] = jobId;

  const res = await fetch(`${API_BASE}/synthesize`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const errBody = (await res.json()) as { detail?: string };
      if (errBody.detail) detail = errBody.detail;
    } catch { /* ignore */ }
    throw new ApiError(res.status, detail);
  }

  const duration = Number.parseFloat(res.headers.get("X-Audio-Duration") ?? "0");
  const sizeBytes = Number.parseInt(res.headers.get("X-Audio-Size") ?? "0", 10);
  const chunks = Number.parseInt(res.headers.get("X-Audio-Chunks") ?? "1", 10);
  const textLength = Number.parseInt(res.headers.get("X-Text-Length") ?? "0", 10);
  const engine = res.headers.get("X-Audio-Engine") ?? "edge-tts";
  const requestId = res.headers.get("X-Request-ID") ?? undefined;
  const blob = await res.blob();
  return { blob, duration, sizeBytes, chunks, textLength, engine, requestId };
}

export function fetchProgress(jobId: string): Promise<JobProgressDTO> {
  return getJson<JobProgressDTO>(`/synthesize/progress/${encodeURIComponent(jobId)}`);
}

export interface IncompleteJobDTO {
  job_id: string;
  engine: string;
  created_at: number;
  updated_at: number;
  chunks_available: number;
  text_preview: string;
  title: string | null;
  output_format: string;
  profile_id: string | null;
}

export interface IncompleteJobsResponse {
  jobs: IncompleteJobDTO[];
  count: number;
}

export function listIncompleteJobs(): Promise<IncompleteJobsResponse> {
  return getJson<IncompleteJobsResponse>("/synthesize/incomplete");
}

export async function resumeJob(jobId: string): Promise<AudioResponse> {
  const res = await fetch(`${API_BASE}/synthesize/resume/${encodeURIComponent(jobId)}`, {
    method: "POST",
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const errBody = (await res.json()) as { detail?: string };
      if (errBody.detail) detail = errBody.detail;
    } catch { /* ignore */ }
    throw new ApiError(res.status, detail);
  }
  const duration = Number.parseFloat(res.headers.get("X-Audio-Duration") ?? "0");
  const sizeBytes = Number.parseInt(res.headers.get("X-Audio-Size") ?? "0", 10);
  const chunks = Number.parseInt(res.headers.get("X-Audio-Chunks") ?? "1", 10);
  const textLength = Number.parseInt(res.headers.get("X-Text-Length") ?? "0", 10);
  const engine = res.headers.get("X-Audio-Engine") ?? "edge-tts";
  const requestId = res.headers.get("X-Request-ID") ?? undefined;
  const blob = await res.blob();
  return { blob, duration, sizeBytes, chunks, textLength, engine, requestId };
}

export async function discardJob(jobId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/synthesize/incomplete/${encodeURIComponent(jobId)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new ApiError(res.status, res.statusText);
  }
}
