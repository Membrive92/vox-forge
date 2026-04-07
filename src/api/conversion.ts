/** Voice conversion endpoint (audio-to-audio). */

import { API_BASE, ApiError } from "./client";

export interface ConversionResult {
  blob: Blob;
  duration: number;
  sizeBytes: number;
}

export async function convertVoice(
  audioFile: File,
  options: {
    profileId?: string | undefined;
    targetSample?: File | undefined;
    outputFormat?: string | undefined;
  },
): Promise<ConversionResult> {
  const fd = new FormData();
  fd.append("audio", audioFile);
  if (options.profileId) fd.append("profile_id", options.profileId);
  if (options.targetSample) fd.append("target_sample", options.targetSample);
  fd.append("output_format", options.outputFormat ?? "mp3");

  const res = await fetch(`${API_BASE}/convert`, { method: "POST", body: fd });

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
