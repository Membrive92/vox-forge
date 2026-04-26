/** Experimental cross-lingual endpoint. */

import { API_BASE, ApiError, getJson } from "./client";

export interface CrossLingualOptions {
  language?: string;
  outputFormat?: string;
  speed?: number;
  /** B — Prepend a Castilian-only warm-up phrase + silence and trim it
   * after synthesis. Anchors the accent toward Castilian when the user
   * speaker_wav is non-Spanish.
   */
  castilianWarmup?: boolean;
  /** D1 — Replace the user's voice_sample with the operator-configured
   * Castilian reference voice. Sacrifices timbre for guaranteed accent.
   */
  useCastilianReference?: boolean;
}

export interface CrossLingualResult {
  blob: Blob;
  duration: number;
}

export interface CandidateTake {
  id: string;
  /** Backend-side absolute path; serve via getStudioAudioUrl. */
  path: string;
  durationS: number;
}

export interface CandidatesResult {
  candidates: CandidateTake[];
  count: number;
  language: string;
  castilianWarmup: boolean;
  castilianReference: boolean;
}

export interface ReferenceVoiceStatus {
  configured: boolean;
  filename?: string;
  durationS?: number;
}

function buildFormData(
  text: string,
  voiceSample: File,
  options: CrossLingualOptions,
): FormData {
  const fd = new FormData();
  fd.append("text", text);
  fd.append("voice_sample", voiceSample);
  fd.append("language", options.language ?? "es");
  fd.append("output_format", options.outputFormat ?? "mp3");
  fd.append("speed", String(options.speed ?? 100));
  if (options.castilianWarmup) fd.append("castilian_warmup", "true");
  if (options.useCastilianReference) fd.append("use_castilian_reference", "true");
  return fd;
}

export async function crossLingualSynthesize(
  text: string,
  voiceSample: File,
  options: CrossLingualOptions = {},
  signal?: AbortSignal,
): Promise<CrossLingualResult> {
  const fd = buildFormData(text, voiceSample, options);
  const init: RequestInit = { method: "POST", body: fd };
  if (signal) init.signal = signal;
  const res = await fetch(`${API_BASE}/experimental/cross-lingual`, init);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const b = (await res.json()) as { detail?: string };
      if (b.detail) detail = b.detail;
    } catch {
      /* swallow */
    }
    throw new ApiError(res.status, detail);
  }
  const duration = Number.parseFloat(res.headers.get("X-Audio-Duration") ?? "0");
  return { blob: await res.blob(), duration };
}

export async function crossLingualCandidates(
  text: string,
  voiceSample: File,
  count: number,
  options: CrossLingualOptions = {},
  signal?: AbortSignal,
): Promise<CandidatesResult> {
  const fd = buildFormData(text, voiceSample, options);
  fd.append("candidates", String(count));
  const init: RequestInit = { method: "POST", body: fd };
  if (signal) init.signal = signal;
  const res = await fetch(`${API_BASE}/experimental/cross-lingual/candidates`, init);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const b = (await res.json()) as { detail?: string };
      if (b.detail) detail = b.detail;
    } catch {
      /* swallow */
    }
    throw new ApiError(res.status, detail);
  }
  const body = (await res.json()) as {
    candidates: { id: string; path: string; duration_s: number }[];
    count: number;
    language: string;
    castilian_warmup: boolean;
    castilian_reference: boolean;
  };
  return {
    candidates: body.candidates.map((c) => ({
      id: c.id,
      path: c.path,
      durationS: c.duration_s,
    })),
    count: body.count,
    language: body.language,
    castilianWarmup: body.castilian_warmup,
    castilianReference: body.castilian_reference,
  };
}

export function getReferenceVoiceStatus(): Promise<ReferenceVoiceStatus> {
  return getJson<{ configured: boolean; filename?: string; duration_s?: number }>(
    "/experimental/reference-voice",
  ).then((r) => ({
    configured: r.configured,
    ...(r.filename !== undefined && { filename: r.filename }),
    ...(r.duration_s !== undefined && { durationS: r.duration_s }),
  }));
}
