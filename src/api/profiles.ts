/** Profile endpoints. Translates snake_case DTOs to camelCase domain types. */

import type { Language, Profile } from "@/types/domain";

import { deleteJson, deleteResource, getJson, patchJson, postForm } from "./client";
import type { ProfileDTO } from "./types";

function toProfile(dto: ProfileDTO): Profile {
  // The schema marks ``id`` / ``language`` as optional because Pydantic has
  // defaults for them (id=_new_id, language="es"), but the backend always
  // serializes them in responses. The fallbacks keep TS happy without
  // splitting the Pydantic model into separate create/response variants.
  // ``sample_filename`` still exists in the DTO as a deprecated readonly
  // alias of samples[0]; the domain type only carries ``samples``.
  return {
    id: dto.id ?? "",
    name: dto.name,
    voiceId: dto.voice_id,
    lang: (dto.language ?? "es") as Language,
    speed: dto.speed,
    pitch: dto.pitch,
    volume: dto.volume,
    samples: dto.samples ?? [],
    sampleDuration: dto.sample_duration ?? null,
    castilianAnchor: dto.castilian_anchor ?? false,
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
  castilianAnchor?: boolean;
}

export async function createProfile(input: CreateProfileInput): Promise<Profile> {
  const fd = new FormData();
  fd.append("name", input.name);
  fd.append("voice_id", input.voiceId);
  fd.append("language", input.language);
  fd.append("speed", String(input.speed));
  fd.append("pitch", String(input.pitch));
  fd.append("volume", String(input.volume));
  if (input.castilianAnchor) fd.append("castilian_anchor", "true");
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
  castilianAnchor?: boolean;
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
  if (input.castilianAnchor !== undefined) body["castilian_anchor"] = input.castilianAnchor;
  const dto = await patchJson<ProfileDTO>(`/profiles/${profileId}`, body);
  return toProfile(dto);
}

export async function deleteProfile(profileId: string): Promise<void> {
  await deleteResource(`/profiles/${profileId}`);
}

export async function getProfile(profileId: string): Promise<Profile> {
  const dto = await getJson<ProfileDTO>(`/profiles/${profileId}`);
  return toProfile(dto);
}

/** Append a sample to a profile's conditioning set (max 5, VOZ-10).
 * Returns the refreshed profile. */
export async function addProfileSample(profileId: string, file: File): Promise<Profile> {
  const fd = new FormData();
  fd.append("sample", file);
  fd.append("profile_id", profileId);
  await postForm("/voices/upload-sample", fd);
  return getProfile(profileId);
}

/** Detach a sample from a profile and delete its file on the backend. */
export async function removeProfileSample(
  profileId: string,
  filename: string,
): Promise<Profile> {
  const dto = await deleteJson<ProfileDTO>(
    `/profiles/${profileId}/samples/${encodeURIComponent(filename)}`,
  );
  return toProfile(dto);
}
