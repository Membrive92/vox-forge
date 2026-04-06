import { useCallback, useEffect, useState } from "react";

import {
  createProfile,
  deleteProfile,
  listProfiles,
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

  return { profiles, error, create, update, remove };
}
