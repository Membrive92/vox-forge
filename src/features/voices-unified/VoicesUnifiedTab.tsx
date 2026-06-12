/**
 * Unified Voices tab.
 *
 * Two sections:
 * 1. System voices + upload card (built-in Edge-TTS voices on the
 *    left, profile-creation form on the right; quality analyzer
 *    runs inline when a sample is uploaded).
 * 2. My profiles — saved cloned-voice cards.
 *
 * Form state and profile handlers come from SynthFormContext (BAJO-30);
 * the profile list comes from the shared ProfilesContext. The leaves
 * below stay prop-driven — they are the consumers, not the drillers.
 *
 * The Compare panel was removed in Sprint C — undiscoverable, mostly
 * unused, and overlapped with the per-card preview buttons. Quick
 * cross-voice trials happen in the Lab section (VoicesPlusLab).
 */
import { useState } from "react";

import { analyzeSample, type SampleAnalysis } from "@/api/analyze";
import { useSharedProfiles } from "@/hooks/profilesContext";
import type { Translations } from "@/i18n";
import { colors, fonts, typography } from "@/theme/tokens";
import type { UploadedSample } from "@/types/domain";

import type { ProfileDraft } from "../state";

import { ProfilesTab } from "./ProfilesTab";
import { QualityFeedback } from "./QualityFeedback";
import { useSynthForm } from "./synthFormContext";
import { VoicesTab } from "./VoicesTab";

interface Props {
  t: Translations;
  onToast: (msg: string) => void;
}

export function VoicesUnifiedTab({ t, onToast }: Props) {
  const {
    settings,
    draft,
    dragOver,
    setDragOver,
    saveProfile,
    useProfile,
    editProfile,
    deleteProfile,
    toggleCastilianAnchor,
    voicePreview,
    samplePlayer,
  } = useSynthForm();
  const { profiles } = useSharedProfiles();

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
          onSaveProfile={saveProfile}
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
          onUse={useProfile}
          onEdit={editProfile}
          onDelete={(id) => void deleteProfile(id)}
          onToggleCastilianAnchor={(id, v) => void toggleCastilianAnchor(id, v)}
          onNew={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          onToast={onToast}
          samplePlayer={samplePlayer}
          voicePreview={voicePreview}
        />
      </Section>
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
