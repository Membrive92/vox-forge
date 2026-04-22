/** Experimental cross-lingual endpoint. */

import { API_BASE, ApiError } from "./client";

export interface CrossLingualResult {
  blob: Blob;
  duration: number;
}

export async function crossLingualSynthesize(
  text: string,
  voiceSample: File,
  language: string = "es",
  outputFormat: string = "mp3",
  signal?: AbortSignal,
): Promise<CrossLingualResult> {
  const fd = new FormData();
  fd.append("text", text);
  fd.append("voice_sample", voiceSample);
  fd.append("language", language);
  fd.append("output_format", outputFormat);

  const init: RequestInit = { method: "POST", body: fd };
  if (signal) init.signal = signal;
  const res = await fetch(`${API_BASE}/experimental/cross-lingual`, init);
  if (!res.ok) {
    let detail = res.statusText;
    try { const b = (await res.json()) as { detail?: string }; if (b.detail) detail = b.detail; } catch { /* */ }
    throw new ApiError(res.status, detail);
  }
  const duration = Number.parseFloat(res.headers.get("X-Audio-Duration") ?? "0");
  return { blob: await res.blob(), duration };
}
