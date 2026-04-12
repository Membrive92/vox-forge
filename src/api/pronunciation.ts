/** Pronunciation dictionary endpoints. */

import { deleteResource, getJson, postJson } from "./client";

export interface PronunciationListDTO {
  entries: Record<string, string>;
  count: number;
}

export interface PronunciationEntry {
  word: string;
  replacement: string;
}

export function listPronunciations(): Promise<PronunciationListDTO> {
  return getJson<PronunciationListDTO>("/pronunciations");
}

export function upsertPronunciation(entry: PronunciationEntry): Promise<PronunciationEntry> {
  return postJson<PronunciationEntry, PronunciationEntry>("/pronunciations", entry);
}

export function deletePronunciation(word: string): Promise<void> {
  return deleteResource(`/pronunciations/${encodeURIComponent(word)}`);
}
