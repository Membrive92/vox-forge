/** Voice conversion endpoint (audio-to-audio). */

import { API_BASE, ApiError } from "./client";

export interface ConversionResult {
  blob: Blob;
  duration: number;
  sizeBytes: number;
}

export interface ConvertOptions {
  profileId?: string | undefined;
  targetSample?: File | undefined;
  outputFormat?: string | undefined;
  pitchShift?: number | undefined;
  formantShift?: number | undefined;
  bassBoostDb?: number | undefined;
}

export async function convertVoice(
  audioFile: File,
  options: ConvertOptions,
  signal?: AbortSignal,
): Promise<ConversionResult> {
  const fd = new FormData();
  fd.append("audio", audioFile);
  if (options.profileId) fd.append("profile_id", options.profileId);
  if (options.targetSample) fd.append("target_sample", options.targetSample);
  fd.append("output_format", options.outputFormat ?? "mp3");
  fd.append("pitch_shift", String(options.pitchShift ?? 0));
  fd.append("formant_shift", String(options.formantShift ?? 0));
  fd.append("bass_boost_db", String(options.bassBoostDb ?? 0));

  const init: RequestInit = { method: "POST", body: fd };
  if (signal) init.signal = signal;
  const res = await fetch(`${API_BASE}/convert`, init);

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch { /* ignore */ }
    throw new ApiError(res.status, detail);
  }

  const duration = Number.parseFloat(res.headers.get("X-Audio-Duration") ?? "0");
  const sizeBytes = Number.parseInt(res.headers.get("X-Audio-Size") ?? "0", 10);
  const blob = await res.blob();
  return { blob, duration, sizeBytes };
}
