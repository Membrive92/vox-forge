/** Endpoints de perfiles. Traduce DTOs snake_case a dominio camelCase. */

import type { Language, Profile } from "@/types/domain";

import { deleteResource, getJson, patchJson, postForm } from "./client";
import type { ProfileDTO } from "./types";

function toProfile(dto: ProfileDTO): Profile {
  return {
    id: dto.id,
    name: dto.name,
    voiceId: dto.voice_id,
    lang: dto.language,
    speed: dto.speed,
    pitch: dto.pitch,
    volume: dto.volume,
    sampleName: dto.sample_filename,
    sampleDuration: dto.sample_duration,
  };
}

export async function listProfiles(): Promise<Profile[]> {
  const dtos = await getJson<ProfileDTO[]>("/profiles");
  return dtos.map(toProfile);
}

export interface CreateProfileInput {
  name: string;
  voiceId: string;
  language: Language;
  speed: number;
  pitch: number;
  volume: number;
  sampleFile: File | null;
}

export async function createProfile(input: CreateProfileInput): Promise<Profile> {
  const fd = new FormData();
  fd.append("name", input.name);
  fd.append("voice_id", input.voiceId);
  fd.append("language", input.language);
  fd.append("speed", String(input.speed));
  fd.append("pitch", String(input.pitch));
  fd.append("volume", String(input.volume));
  if (input.sampleFile) fd.append("sample", input.sampleFile);
  const dto = await postForm<ProfileDTO>("/profiles", fd);
  return toProfile(dto);
}

export interface UpdateProfileInput {
  name?: string;
  voiceId?: string;
  language?: Language;
  speed?: number;
  pitch?: number;
  volume?: number;
}

export async function updateProfile(
  profileId: string,
  input: UpdateProfileInput,
): Promise<Profile> {
  const body: Record<string, unknown> = {};
  if (input.name !== undefined) body["name"] = input.name;
  if (input.voiceId !== undefined) body["voice_id"] = input.voiceId;
  if (input.language !== undefined) body["language"] = input.language;
  if (input.speed !== undefined) body["speed"] = input.speed;
  if (input.pitch !== undefined) body["pitch"] = input.pitch;
  if (input.volume !== undefined) body["volume"] = input.volume;
  const dto = await patchJson<ProfileDTO>(`/profiles/${profileId}`, body);
  return toProfile(dto);
}

export async function deleteProfile(profileId: string): Promise<void> {
  await deleteResource(`/profiles/${profileId}`);
}
