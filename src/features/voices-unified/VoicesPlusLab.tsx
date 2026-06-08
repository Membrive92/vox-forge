/**
 * Sprint A wrapper — combines the existing VoicesUnifiedTab (gallery + create
 * + compare) with the QuickSynthTab (standard + cross-lingual lab) under a
 * single "Mis voces" destination.
 *
 * This is intentionally a *thin* composition: no behavior changes, just
 * stacks the two existing components with a divider. Sprint C will fold
 * them into a unified panel and remove the duplication.
 */
import type { CreateProfileInput } from "@/api/profiles";
import type { SamplePlayerState } from "@/hooks/useSamplePlayer";
import type { VoicePreviewState } from "@/hooks/useVoicePreview";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, typography } from "@/theme/tokens";
import type { Profile } from "@/types/domain";

import type { ProfileDraft, SynthSettings } from "../state";
import { QuickSynthTab } from "../quick-synth/QuickSynthTab";

import { VoicesUnifiedTab } from "./VoicesUnifiedTab";

interface Props {
  t: Translations;
  settings: SynthSettings;
  draft: ProfileDraft;
  profiles: readonly Profile[];
  dragOver: boolean;
  setDragOver: (v: boolean) => void;
  onSaveProfile: () => void | Promise<void>;
  onUseProfile: (profile: Profile) => void;
  onEditProfile: (profile: Profile) => void;
  onDeleteProfile: (profileId: string) => void;
  onToggleCastilianAnchor: (profileId: string, value: boolean) => void;
  onToast: (msg: string) => void;
  voicePreview: VoicePreviewState;
  samplePlayer: SamplePlayerState;
  // Lab section
  text: string;
  setText: (v: string) => void;
  onCreateProfile: (input: CreateProfileInput) => Promise<unknown>;
}

export function VoicesPlusLab(props: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      <VoicesUnifiedTab
        t={props.t}
        settings={props.settings}
        draft={props.draft}
        profiles={props.profiles}
        dragOver={props.dragOver}
        setDragOver={props.setDragOver}
        onSaveProfile={props.onSaveProfile}
        onUseProfile={props.onUseProfile}
        onEditProfile={props.onEditProfile}
        onDeleteProfile={props.onDeleteProfile}
        onToggleCastilianAnchor={props.onToggleCastilianAnchor}
        onToast={props.onToast}
        voicePreview={props.voicePreview}
        samplePlayer={props.samplePlayer}
      />

      <SectionDivider label={props.t.voicesLabSectionTitle} />

      <QuickSynthTab
        t={props.t}
        text={props.text}
        setText={props.setText}
        settings={props.settings}
        onToast={props.onToast}
        onCreateProfile={props.onCreateProfile}
      />
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
