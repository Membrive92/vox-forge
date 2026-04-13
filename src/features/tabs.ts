/**
 * New tab structure (5 tabs, user-workflow-oriented).
 *
 * See `internal-docs/ux-restructure-plan.md` for the full migration plan.
 * This file coexists with the old Tab type in App.tsx during the migration.
 * Once Phase 6 (cleanup) is done, the old Tab type is removed and this
 * becomes the single source of truth.
 */

export type NewTab =
  | "workbench"
  | "quick-synth"
  | "voices"
  | "audio-tools"
  | "activity";

export const NEW_TAB_ORDER: readonly NewTab[] = [
  "workbench",
  "quick-synth",
  "voices",
  "audio-tools",
  "activity",
] as const;

/**
 * Maps each old tab to its destination in the new structure.
 * Used during phases 1-5 to redirect users who had muscle memory
 * for the old tab names.
 */
export const OLD_TO_NEW_TAB: Record<string, NewTab> = {
  synth: "quick-synth",
  experimental: "quick-synth",
  workbench: "workbench",
  voices: "voices",
  profiles: "voices",
  compare: "voices",
  convert: "audio-tools",
  lab: "audio-tools",
  pronunciation: "activity",
  activity: "activity",
};
