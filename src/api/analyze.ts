/** Voice sample quality analysis. */

import { API_BASE, ApiError } from "./client";

export interface SampleAnalysis {
  duration_s: number;
  sample_rate: number;
  channels: number;
  peak_dbfs: number;
  rms: number;
  snr_db: number;
  clip_ratio: number;
  silence_ratio: number;
  rating: "excellent" | "good" | "fair" | "poor";
  issues: string[];
}

export async function analyzeSample(file: File): Promise<SampleAnalysis> {
  const fd = new FormData();
  fd.append("audio", file);

  const res = await fetch(`${API_BASE}/analyze/sample`, { method: "POST", body: fd });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const b = (await res.json()) as { detail?: string };
      if (b.detail) detail = b.detail;
    } catch { /* ignore */ }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as SampleAnalysis;
}
