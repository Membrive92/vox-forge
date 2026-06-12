/**
 * Unified Voices tab.
 *
 * Two sections:
 * 1. System voices + upload card (built-in Edge-TTS voices on the
 *    left, profile-creation form on the right; quality analyzer
 *    runs inline when a sample is uploaded).
 * 2. My profiles — saved cloned-voice cards.
 *
 * The Compare panel was removed in Sprint C — undiscoverable, mostly
 * unused, and overlapped with the per-card preview buttons. Quick
 * cross-voice trials happen in the Lab section (VoicesPlusLab).
 */
import { useState } from "react";

import { analyzeSample, type SampleAnalysis } from "@/api/analyze";
import type { SamplePlayerState } from "@/hooks/useSamplePlayer";
import type { VoicePreviewState } from "@/hooks/useVoicePreview";
import type { Translations } from "@/i18n";
import { colors, fonts, typography } from "@/theme/tokens";
import type { Profile, UploadedSample } from "@/types/domain";

import type { ProfileDraft, SynthSettings } from "../state";

import { ProfilesTab } from "./ProfilesTab";
import { QualityFeedback } from "./QualityFeedback";
import { VoicesTab } from "./VoicesTab";

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
}

export function VoicesUnifiedTab({
  t, settings, draft, profiles, dragOver, setDragOver,
  onSaveProfile, onUseProfile, onEditProfile, onDeleteProfile,
  onToggleCastilianAnchor,
  onToast, voicePreview, samplePlayer,
}: Props) {
  const [analysis, setAnalysis] = useState<SampleAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  // Run quality analysis whenever a new sample is uploaded
  const handleSampleAnalysis = async (sample: UploadedSample | null): Promise<void> => {
    if (sample === null) {
      setAnalysis(null);
      return;
    }
    setAnalyzing(true);
    try {
      const result = await analyzeSample(sample.file);
      setAnalysis(result);
    } catch {
      setAnalysis(null);
    } finally {
      setAnalyzing(false);
    }
  };

  // Wrap the setter so the analyzer runs automatically
  const wrappedDraft: ProfileDraft = {
    ...draft,
    setUploadedFile: (sample) => {
      draft.setUploadedFile(sample);
      void handleSampleAnalysis(sample);
    },
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {/* ── System voices + My profiles (side by side, from VoicesTab) ── */}
      <Section title={t.sectionSystemVoices}>
        <VoicesTab
          t={t}
          settings={settings}
          draft={wrappedDraft}
          dragOver={dragOver}
          setDragOver={setDragOver}
          onSaveProfile={onSaveProfile}
          onToast={onToast}
          voicePreview={voicePreview}
        />
        {(analyzing || analysis) && (
          <div style={{ marginTop: 16 }}>
            <QualityFeedback t={t} analysis={analysis} analyzing={analyzing} />
          </div>
        )}
      </Section>

      {/* ── Profile cards ── */}
      <Section title={t.sectionMyProfiles}>
        <ProfilesTab
          t={t}
          profiles={profiles}
          onUse={onUseProfile}
          onEdit={onEditProfile}
          onDelete={onDeleteProfile}
          onToggleCastilianAnchor={onToggleCastilianAnchor}
          onNew={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          onToast={onToast}
          samplePlayer={samplePlayer}
          voicePreview={voicePreview}
        />
      </Section>

      {/* Compare (A/B) panel removed — it was collapsed by default,
          undiscoverable, and overlapped with the per-card preview
          buttons. The lab section in VoicesPlusLab covers the
          "try a voice quickly" need. */}
    </div>
  );
}

// ── Subcomponents ───────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 style={{
        margin: "0 0 14px",
        fontSize: typography.size.sm,
        fontWeight: 700,
        color: colors.textDim,
        textTransform: "uppercase",
        letterSpacing: "2px",
        fontFamily: fonts.sans,
      }}>
        {title}
      </h2>
      {children}
    </div>
  );
}
