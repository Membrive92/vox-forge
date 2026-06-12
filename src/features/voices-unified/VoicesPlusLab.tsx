/**
 * "Mis voces" destination: the voices gallery (system voices + profile
 * creation + profile cards) stacked over the lab section (Quick Synth +
 * cross-lingual mode).
 *
 * The synth-form state (voice, sliders, draft, preview players) lives in
 * SynthFormContext (BAJO-30) — this component only composes layout.
 */
import type { Translations } from "@/i18n";
import { colors, fonts, radii, typography } from "@/theme/tokens";

import { QuickSynthTab } from "../quick-synth/QuickSynthTab";

import { useSynthForm } from "./synthFormContext";
import { VoicesUnifiedTab } from "./VoicesUnifiedTab";

/** DOM id of the lab (Quick Synth) section, where the resume-jobs UI
 * renders. App scrolls here when the user follows the Workbench
 * "resume interrupted jobs" banner. */
export const VOICES_LAB_SECTION_ID = "vf-voices-lab-section";

interface Props {
  t: Translations;
  onToast: (msg: string) => void;
}

export function VoicesPlusLab({ t, onToast }: Props) {
  const synth = useSynthForm();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      <VoicesUnifiedTab t={t} onToast={onToast} />

      {/* Anchor target for the Workbench "resume jobs" banner: the
          incomplete-jobs UI lives at the top of the lab section, far
          below the voices gallery fold (MED-UX-3). */}
      <div
        id={VOICES_LAB_SECTION_ID}
        style={{ display: "flex", flexDirection: "column", gap: 32 }}
      >
        <SectionDivider label={t.voicesLabSectionTitle} />

        <QuickSynthTab
          t={t}
          text={synth.text}
          setText={synth.setText}
          settings={synth.settings}
          onToast={onToast}
          onCreateProfile={synth.createProfile}
        />
      </div>
    </div>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        margin: "8px 0 4px",
      }}
    >
      <div
        style={{
          flex: 1,
          height: 1,
          background: colors.borderSubtle,
        }}
      />
      <span
        style={{
          fontSize: typography.size.xs,
          fontWeight: 700,
          letterSpacing: "2px",
          textTransform: "uppercase",
          color: colors.textDim,
          fontFamily: fonts.sans,
          padding: "4px 12px",
          borderRadius: radii.sm,
          background: colors.surfaceAlt,
          border: `1px solid ${colors.borderFaint}`,
        }}
      >
        {label}
      </span>
      <div
        style={{
          flex: 1,
          height: 1,
          background: colors.borderSubtle,
        }}
      />
    </div>
  );
}
