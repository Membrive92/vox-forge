/** Character-cast synthesis: different voice profiles for different characters. */

import { API_BASE, ApiError, postJson } from "./client";

export interface CharacterMapping {
  character: string;
  profile_id?: string | null;
  voice_id?: string;
}

export interface ExtractCharactersResponse {
  characters: string[];
}

export interface CastSynthesisResult {
  blob: Blob;
  duration: number;
  segments: number;
  unmapped: string[];
}

export function extractCharacters(text: string): Promise<ExtractCharactersResponse> {
  return postJson<ExtractCharactersResponse, { text: string }>(
    "/character-synth/extract-characters",
    { text },
  );
}

export async function castSynthesize(
  text: string,
  cast: CharacterMapping[],
  outputFormat: string = "mp3",
): Promise<CastSynthesisResult> {
  const res = await fetch(`${API_BASE}/character-synth/synthesize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, cast, output_format: outputFormat }),
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const b = (await res.json()) as { detail?: string };
      if (b.detail) detail = b.detail;
    } catch { /* ignore */ }
    throw new ApiError(res.status, detail);
  }

  const duration = Number.parseFloat(res.headers.get("X-Audio-Duration") ?? "0");
  const segments = Number.parseInt(res.headers.get("X-Audio-Segments") ?? "0", 10);
  const unmappedRaw = res.headers.get("X-Unmapped-Characters") ?? "";
  const unmapped = unmappedRaw ? unmappedRaw.split(",").filter(Boolean) : [];
  const blob = await res.blob();
  return { blob, duration, segments, unmapped };
}
