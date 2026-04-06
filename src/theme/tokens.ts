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

  text: "#e2e8f0",
  textMuted: "#94a3b8",
  textDim: "#64748b",
  textFaint: "#475569",
  textGhost: "#334155",
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

  success: "#4ade80",
  successSoft: "rgba(34,197,94,0.12)",
  danger: "#f87171",
  dangerSoft: "rgba(239,68,68,0.08)",
  dangerBorder: "rgba(239,68,68,0.15)",
} as const;

export const fonts = {
  sans: "'DM Sans', sans-serif",
  mono: "'JetBrains Mono', monospace",
  serif: "'Playfair Display', serif",
} as const;

export const radii = {
  sm: 6,
  md: 8,
  lg: 10,
  xl: 14,
} as const;

export const fontsHref =
  "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Playfair+Display:wght@700;800&display=swap";
