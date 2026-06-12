import { createContext, useContext } from "react";

import type { ProfilesState } from "./useProfiles";

/**
 * Single source of truth for voice profiles. App owns one `useProfiles()`
 * instance and provides it here; every other consumer (Workbench,
 * CharacterCasting, ExperimentalTab) reads from this context instead of
 * spinning up its own independent fetch+state, which previously left the
 * profile lists out of sync across tabs.
 */
export const ProfilesContext = createContext<ProfilesState | null>(null);

// Inert fallback for components rendered in isolation (unit tests) with no
// provider. Returns an empty list; mutators reject loudly since reaching
// them without a provider is a wiring mistake.
const INERT: ProfilesState = {
  profiles: [],
  error: null,
  create: () => Promise.reject(new Error("ProfilesContext provider is missing")),
  update: () => Promise.reject(new Error("ProfilesContext provider is missing")),
  remove: () => Promise.reject(new Error("ProfilesContext provider is missing")),
  addSample: () => Promise.reject(new Error("ProfilesContext provider is missing")),
  removeSample: () => Promise.reject(new Error("ProfilesContext provider is missing")),
};

export function useSharedProfiles(): ProfilesState {
  return useContext(ProfilesContext) ?? INERT;
}
