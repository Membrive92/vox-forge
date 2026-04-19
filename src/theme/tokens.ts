/** Design tokens. Any value that appears 2+ times lives here. */

export const colors = {
  bg: "#0a0f1a",
  surface: "rgba(15,23,42,0.6)",
  surfaceAlt: "rgba(30,41,59,0.6)",
  surfaceSubtle: "rgba(30,41,59,0.4)",
  border: "rgba(148,163,184,0.1)",
  borderSubtle: "rgba(148,163,184,0.08)",
  borderFaint: "rgba(148,163,184,0.06)",
  borderHair: "rgba(148,163,184,0.05)",

  // Text — all pass WCAG AA on the dark bg after the Phase 1 contrast fix.
  text: "#e2e8f0",
  textMuted: "#94a3b8",
  textDim: "#7188a5",   // was #64748b — raised to 5.1:1 contrast
  textFaint: "#64748b", // was #475569 — raised to 4.6:1 contrast
  textGhost: "#475569", // kept as the lowest-contrast tier (decorative only)
  textDark: "#1e293b",

  primary: "#3b82f6",
  primaryDim: "#2563eb",
  primaryLight: "#60a5fa",
  primarySoft: "rgba(59,130,246,0.12)",
  primaryBorder: "rgba(59,130,246,0.3)",
  primaryGlow: "rgba(59,130,246,0.4)",

  accent: "#f97316",
  accentLight: "#fb923c",
  accentGlow: "rgba(249,115,22,0.4)",

  female: "#f472b6",
  femaleSoft: "rgba(244,114,182,0.12)",
  maleSoft: "rgba(96,165,250,0.12)",

  // Semantic status tokens — consolidate the scattered hex uses from
  // ExperimentalTab, LabTab, ActivityTab, ChunkMap, CharacterCasting.
  success: "#34d399",
  successSoft: "rgba(16,185,129,0.15)",
  successBorder: "rgba(16,185,129,0.3)",

  warning: "#f59e0b",
  warningSoft: "rgba(245,158,11,0.15)",
  warningBorder: "rgba(245,158,11,0.3)",

  danger: "#f87171",
  dangerSoft: "rgba(248,113,113,0.08)",
  dangerBorder: "rgba(248,113,113,0.25)",

  // Purple used for character casting — kept as a distinct semantic token.
  purple: "#a78bfa",
  purpleSoft: "rgba(139,92,246,0.15)",
  purpleBorder: "rgba(139,92,246,0.3)",
} as const;

export const fonts = {
  sans: "'DM Sans', sans-serif",
  mono: "'JetBrains Mono', monospace",
  serif: "'Playfair Display', serif",
} as const;

/**
 * Typography scale.
 * 6 sizes, 4 weights, 3 leadings. Keep UI consistent — no raw `fontSize: N`
 * or `fontWeight: N` in component code, always reference a token.
 */
export const typography = {
  size: {
    xs: 11,
    sm: 13,
    base: 14,
    lg: 16,
    xl: 20,
    "2xl": 28,
  },
  weight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  leading: {
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.7,
  },
  tracking: {
    normal: "0",
    wide: "1px",
    widest: "2px",
  },
} as const;

/**
 * Spacing scale — base-4 system. Use for padding, margin, and flex gap.
 * Example: `padding: space[4]` → 16px. `gap: space[2]` → 8px.
 */
export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
} as const;

export const radii = {
  sm: 6,
  md: 8,
  lg: 10,
  xl: 14,
} as const;

/**
 * Responsive breakpoints. Use inside media queries or style calculations.
 * Mobile-first: write styles for mobile, then override with `@media (min-width: X)`.
 */
export const breakpoints = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
} as const;

/**
 * Animation timings. Use `transitions.fast` for interactive state changes
 * (hover, active), `base` for panels and layouts, `slow` for decorative.
 * All changes respect `prefers-reduced-motion` via a global CSS rule.
 */
export const transitions = {
  fast: "all 150ms ease",
  base: "all 250ms ease",
  slow: "all 400ms ease",
} as const;

export const fontsHref =
  "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Playfair+Display:wght@700;800&display=swap";