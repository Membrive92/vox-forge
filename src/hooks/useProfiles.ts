import { useCallback, useEffect, useState } from "react";

import {
  addProfileSample,
  createProfile,
  deleteProfile,
  listProfiles,
  removeProfileSample,
  updateProfile,
  type CreateProfileInput,
  type UpdateProfileInput,
} from "@/api/profiles";
import type { Profile } from "@/types/domain";

export interface ProfilesState {
  profiles: Profile[];
  error: string | null;
  create: (input: CreateProfileInput) => Promise<Profile>;
  update: (id: string, input: UpdateProfileInput) => Promise<Profile>;
  remove: (id: string) => Promise<void>;
  /** Append a conditioning sample to a profile (max 5, VOZ-10). */
  addSample: (id: string, file: File) => Promise<Profile>;
  /** Detach a sample and delete its file on the backend. */
  removeSample: (id: string, filename: string) => Promise<Profile>;
}

export function useProfiles(): ProfilesState {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listProfiles()
      .then((list) => {
        if (!cancelled) setProfiles(list);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const create = useCallback(async (input: CreateProfileInput) => {
    const created = await createProfile(input);
    setProfiles((prev) => [...prev, created]);
    return created;
  }, []);

  const update = useCallback(async (id: string, input: UpdateProfileInput) => {
    const updated = await updateProfile(id, input);
    setProfiles((prev) => prev.map((p) => (p.id === id ? updated : p)));
    return updated;
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteProfile(id);
    setProfiles((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const addSample = useCallback(async (id: string, file: File) => {
    const updated = await addProfileSample(id, file);
    setProfiles((prev) => prev.map((p) => (p.id === id ? updated : p)));
    return updated;
  }, []);

  const removeSample = useCallback(async (id: string, filename: string) => {
    const updated = await removeProfileSample(id, filename);
    setProfiles((prev) => prev.map((p) => (p.id === id ? updated : p)));
    return updated;
  }, []);

  return { profiles, error, create, update, remove, addSample, removeSample };
}
