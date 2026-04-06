/** Endpoint de síntesis TTS. */

import type { SynthesisParams } from "@/types/domain";

import { postJsonForAudio, type AudioResponse } from "./client";
import type { SynthesisRequestDTO } from "./types";

export async function synthesize(params: SynthesisParams): Promise<AudioResponse> {
  const body: SynthesisRequestDTO = {
    text: params.text,
    voice_id: params.voiceId,
    output_format: params.format,
    speed: params.speed,
    pitch: params.pitch,
    volume: params.volume,
    profile_id: params.profileId ?? null,
  };
  return postJsonForAudio("/synthesize", body);
}
