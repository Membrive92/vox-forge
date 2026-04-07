/** Domain types shared across the app (camelCase). */

export type Language = "es" | "en";
export type Gender = "M" | "F";
export type AudioFormat = "mp3" | "wav" | "ogg" | "flac";

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
  sampleName: string | null;
  sampleDuration: number | null;
}

export interface SynthesisParams {
  text: string;
  voiceId: string;
  format: AudioFormat;
  speed: number;
  pitch: number;
  volume: number;
  profileId?: string | undefined;
}

export interface UploadedSample {
  file: File;
  name: string;
  sizeKb: string;
  duration: string;
}
