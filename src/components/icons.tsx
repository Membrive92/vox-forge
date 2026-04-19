/** Inline SVG icon set. No external dependencies. */

const base = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const };
const SIZE_MD = { width: 18, height: 18 };
const SIZE_SM = { width: 16, height: 16 };
const SIZE_XS = { width: 14, height: 14 };
const SIZE_LG = { width: 22, height: 22 };

export const Waveform = () => (
  <svg viewBox="0 0 24 24" {...base} strokeWidth="1.5" style={SIZE_LG}>
    <path d="M2 12h2m4-6v12m4-9v6m4-9v12m4-6h2" />
  </svg>
);

export const Play = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" style={SIZE_MD}>
    <path d="M8 5v14l11-7z" />
  </svg>
);

export const Pause = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" style={SIZE_MD}>
    <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
  </svg>
);

export const Stop = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" style={SIZE_MD}>
    <rect x="6" y="6" width="12" height="12" rx="1" />
  </svg>
);

export const Download = () => (
  <svg viewBox="0 0 24 24" {...base} style={SIZE_MD}>
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
  </svg>
);

export const Upload = () => (
  <svg viewBox="0 0 24 24" {...base} style={SIZE_LG}>
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
  </svg>
);

export const Mic = () => (
  <svg viewBox="0 0 24 24" {...base} style={SIZE_MD}>
    <rect x="9" y="1" width="6" height="11" rx="3" />
    <path d="M19 10v1a7 7 0 01-14 0v-1M12 19v4M8 23h8" />
  </svg>
);

export const Trash = () => (
  <svg viewBox="0 0 24 24" {...base} style={SIZE_SM}>
    <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
  </svg>
);

export const Edit = () => (
  <svg viewBox="0 0 24 24" {...base} style={SIZE_SM}>
    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

export const Check = () => (
  <svg viewBox="0 0 24 24" {...base} strokeWidth="2.5" style={SIZE_SM}>
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

export const Globe = () => (
  <svg viewBox="0 0 24 24" {...base} strokeWidth="1.5" style={SIZE_SM}>
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10A15.3 15.3 0 0112 2z" />
  </svg>
);

export const Settings = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={SIZE_MD}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
  </svg>
);

export const ChevDown = () => (
  <svg viewBox="0 0 24 24" {...base} style={SIZE_XS}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export const User = () => (
  <svg viewBox="0 0 24 24" {...base} style={SIZE_SM}>
    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

export const Volume = () => (
  <svg viewBox="0 0 24 24" {...base} style={SIZE_SM}>
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" />
  </svg>
);

// ─── Tab icons (Phase 4 — one unique per nav tab) ────────────────────

/** Book — Workbench (default tab, project authoring). */
export const Book = () => (
  <svg viewBox="0 0 24 24" {...base} strokeWidth="1.5" style={SIZE_MD}>
    <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
  </svg>
);

/** Zap — Quick Synth (fast one-shot synthesis). */
export const Zap = () => (
  <svg viewBox="0 0 24 24" {...base} strokeWidth="1.5" style={SIZE_MD}>
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

/** Mic2 — Voices (more mic-like than the generic Mic used for recording). */
export const Mic2 = () => (
  <svg viewBox="0 0 24 24" {...base} strokeWidth="1.5" style={SIZE_MD}>
    <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
    <path d="M19 10v2a7 7 0 01-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

/** Sliders — Audio Tools (DSP + voice conversion). */
export const SlidersIcon = () => (
  <svg viewBox="0 0 24 24" {...base} strokeWidth="1.5" style={SIZE_MD}>
    <line x1="4" y1="21" x2="4" y2="14" />
    <line x1="4" y1="10" x2="4" y2="3" />
    <line x1="12" y1="21" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12" y2="3" />
    <line x1="20" y1="21" x2="20" y2="16" />
    <line x1="20" y1="12" x2="20" y2="3" />
    <line x1="1" y1="14" x2="7" y2="14" />
    <line x1="9" y1="8" x2="15" y2="8" />
    <line x1="17" y1="16" x2="23" y2="16" />
  </svg>
);

/** Clock — Activity (history + monitoring). */
export const Clock = () => (
  <svg viewBox="0 0 24 24" {...base} strokeWidth="1.5" style={SIZE_MD}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

/** Scissors — Studio editor (cut/trim). */
export const Scissors = () => (
  <svg viewBox="0 0 24 24" {...base} strokeWidth="1.5" style={SIZE_MD}>
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <line x1="20" y1="4" x2="8.12" y2="15.88" />
    <line x1="14.47" y1="14.48" x2="20" y2="20" />
    <line x1="8.12" y1="8.12" x2="12" y2="12" />
  </svg>
);
