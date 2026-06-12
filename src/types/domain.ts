/** Domain types shared across the app (camelCase). */

export type Language = "es" | "en";
export type Gender = "M" | "F";
export type AudioFormat = "mp3" | "wav" | "ogg" | "flac";

/**
 * Top-level tab hosts. Studio has no nav entry (it opens from a chapter
 * via a navigation intent) but is still a navigable destination — jobs
 * record it as their origin so the tray can lead back to it (UX-01).
 */
export type TabId = "workbench" | "voices" | "audio-tools" | "studio" | "activity";

export interface Voice {
  id: string;
  name: string;
  gender: Gender;
  accent: string;
}

export interface Profile {
  id: string;
  name: string;
  voiceId: string;
  lang: Language;
  speed: number;
  pitch: number;
  volume: number;
  /** Stored sample filenames (0-5). Every one is passed to XTTS as a
   * conditioning reference (VOZ-10 — the model averages the latents). */
  samples: string[];
  /** Duration in seconds of the first sample, when known. */
  sampleDuration: number | null;
  /** When true, the configured Castilian reference voice is concatenated
   * to the profile's primary sample before XTTS sees it (production
   * audio anchor). Off by default. */
  castilianAnchor: boolean;
}

export interface SynthesisParams {
  text: string;
  voiceId: string;
  format: AudioFormat;
  speed: number;
  pitch: number;
  volume: number;
  profileId?: string | undefined;
  title?: string | undefined;
  artist?: string | undefined;
  album?: string | undefined;
  trackNumber?: number | undefined;
}

export interface ExportSettings {
  storyTitle: string;
  artist: string;
  album: string;
  trackNumber: number;
  filenamePattern: string;
}

export interface UploadedSample {
  file: File;
  name: string;
  sizeKb: string;
  duration: string;
}
