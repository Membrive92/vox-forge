/** Estado de síntesis compartido entre tabs. */

import type { AudioFormat, Language, UploadedSample } from "@/types/domain";

export interface SynthSettings {
  lang: Language;
  setLang: (v: Language) => void;
  selectedVoice: string;
  setSelectedVoice: (v: string) => void;
  format: AudioFormat;
  setFormat: (v: AudioFormat) => void;
  speed: number;
  setSpeed: (v: number) => void;
  pitch: number;
  setPitch: (v: number) => void;
  volume: number;
  setVolume: (v: number) => void;
}

export interface ProfileDraft {
  name: string;
  setName: (v: string) => void;
  uploadedFile: UploadedSample | null;
  setUploadedFile: (v: UploadedSample | null) => void;
  editingId: string | null;
  setEditingId: (v: string | null) => void;
}
