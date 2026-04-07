/** Voice lab API client. */

import { API_BASE, ApiError, getJson } from "./client";

export interface VoiceLabParams {
  pitch_semitones: number;
  formant_shift: number;
  bass_boost_db: number;
  warmth_db: number;
  compression: number;
  reverb: number;
  speed: number;
}

export interface Preset {
  name: string;
  description: string;
  category: string;
  params: VoiceLabParams;
}

export async function listPresets(): Promise<Preset[]> {
  const data = await getJson<{ presets: Preset[] }>("/voice-lab/presets");
  return data.presets;
}

export async function randomPreset(): Promise<Preset> {
  return getJson<Preset>("/voice-lab/presets/random");
}

export interface LabResult {
  blob: Blob;
  duration: number;
}

export async function processAudio(
  audioFile: File,
  params: VoiceLabParams,
  outputFormat: string = "mp3",
): Promise<LabResult> {
  const fd = new FormData();
  fd.append("audio", audioFile);
  fd.append("pitch_semitones", String(params.pitch_semitones));
  fd.append("formant_shift", String(params.formant_shift));
  fd.append("bass_boost_db", String(params.bass_boost_db));
  fd.append("warmth_db", String(params.warmth_db));
  fd.append("compression", String(params.compression));
  fd.append("reverb", String(params.reverb));
  fd.append("speed", String(params.speed));
  fd.append("output_format", outputFormat);

  const res = await fetch(`${API_BASE}/voice-lab/process`, { method: "POST", body: fd });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch { /* ignore */ }
    throw new ApiError(res.status, detail);
  }

  const duration = Number.parseFloat(res.headers.get("X-Audio-Duration") ?? "0");
  const blob = await res.blob();
  return { blob, duration };
}
