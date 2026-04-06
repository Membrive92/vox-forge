/** Backend DTOs (snake_case). */

import type { AudioFormat, Language } from "@/types/domain";

export interface ProfileDTO {
  id: string;
  name: string;
  voice_id: string;
  language: Language;
  speed: number;
  pitch: number;
  volume: number;
  sample_filename: string | null;
  sample_duration: number | null;
  created_at: string;
  updated_at: string;
}

export interface SynthesisRequestDTO {
  text: string;
  voice_id: string;
  output_format: AudioFormat;
  speed: number;
  pitch: number;
  volume: number;
  profile_id: string | null;
}

export interface ApiErrorBody {
  detail: string;
  code?: string;
}
