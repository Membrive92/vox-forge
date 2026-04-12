/** Ambient audio library + mixer API. */

import { API_BASE, ApiError, deleteResource, getJson } from "./client";

export interface AmbienceTrack {
  id: string;
  name: string;
  filename: string;
  duration_s: number;
  size_bytes: number;
  tags: string[];
}

export interface AmbienceListResponse {
  tracks: AmbienceTrack[];
  count: number;
}

export function listAmbience(): Promise<AmbienceListResponse> {
  return getJson<AmbienceListResponse>("/ambience");
}

export function getAmbienceAudioUrl(trackId: string): string {
  return `${API_BASE}/ambience/${trackId}/audio`;
}

export async function uploadAmbience(
  audio: File,
  name: string,
  tags: string[] = [],
): Promise<AmbienceTrack> {
  const fd = new FormData();
  fd.append("audio", audio);
  fd.append("name", name);
  fd.append("tags", tags.join(","));

  const res = await fetch(`${API_BASE}/ambience`, { method: "POST", body: fd });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const b = (await res.json()) as { detail?: string };
      if (b.detail) detail = b.detail;
    } catch { /* ignore */ }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as AmbienceTrack;
}

export function deleteAmbience(trackId: string): Promise<void> {
  return deleteResource(`/ambience/${trackId}`);
}

export interface MixChapterResult {
  blob: Blob;
  duration: number;
}

export async function mixChapter(
  chapterId: string,
  ambientTrackId: string,
  volumeDb: number = -15,
  fadeInMs: number = 3000,
  fadeOutMs: number = 3000,
): Promise<MixChapterResult> {
  const fd = new FormData();
  fd.append("ambient_track_id", ambientTrackId);
  fd.append("ambient_volume_db", String(volumeDb));
  fd.append("fade_in_ms", String(fadeInMs));
  fd.append("fade_out_ms", String(fadeOutMs));

  const res = await fetch(`${API_BASE}/ambience/mix-chapter/${chapterId}`, {
    method: "POST",
    body: fd,
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
  const blob = await res.blob();
  return { blob, duration };
}
