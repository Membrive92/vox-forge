/**
 * Unified Voices tab (Phase 1).
 *
 * Replaces the separate Voices, Profiles, and Compare tabs. Three sections:
 * 1. System voices (built-in Edge-TTS voices)
 * 2. My profiles (custom profiles + upload new)
 * 3. Compare (collapsible A/B + quick preview)
 *
 * Inline quality analyzer runs when a sample is uploaded, giving the user
 * immediate feedback on whether the sample is usable for cloning.
 */
import { useState } from "react";

import { analyzeSample, type SampleAnalysis } from "@/api/analyze";
import * as Icons from "@/components/icons";
import type { SamplePlayerState } from "@/hooks/useSamplePlayer";
import type { VoicePreviewState } from "@/hooks/useVoicePreview";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, typography } from "@/theme/tokens";
import type { Profile, UploadedSample } from "@/types/domain";

import type { ProfileDraft, SynthSettings } from "../state";

import { CompareTab } from "./CompareTab";
import { ProfilesTab } from "./ProfilesTab";
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
  onToast: (msg: string) => void;
  voicePreview: VoicePreviewState;
  samplePlayer: SamplePlayerState;
}

export function VoicesUnifiedTab({
  t, settings, draft, profiles, dragOver, setDragOver,
  onSaveProfile, onUseProfile, onEditProfile, onDeleteProfile,
  onToast, voicePreview, samplePlayer,
}: Props) {
  const [showCompare, setShowCompare] = useState(false);
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
          onNew={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          samplePlayer={samplePlayer}
          voicePreview={voicePreview}
        />
      </Section>

      {/* ── Compare (collapsible) ── */}
      <div>
        <button
          onClick={() => setShowCompare((v) => !v)}
          style={{
            width: "100%",
            padding: "14px 20px",
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: radii.xl,
            color: colors.text,
            fontFamily: fonts.sans,
            fontSize: typography.size.base,
            fontWeight: 700,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>{t.sectionCompare}</span>
          <span style={{
            transform: showCompare ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s",
            color: colors.textDim,
          }}>
            <Icons.ChevDown />
          </span>
        </button>
        {showCompare && (
          <div style={{ marginTop: 12 }}>
            <CompareTab t={t} profiles={profiles} onToast={onToast} />
          </div>
        )}
      </div>
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

interface QualityProps {
  t: Translations;
  analysis: SampleAnalysis | null;
  analyzing: boolean;
}

function QualityFeedback({ t, analysis, analyzing }: QualityProps) {
  if (analyzing) {
    return (
      <div style={feedbackBoxStyle(colors.surfaceAlt, colors.border)}>
        <span style={{ color: colors.textDim, fontSize: typography.size.sm }}>
          {t.sampleQuality}: ...
        </span>
      </div>
    );
  }
  if (!analysis) return null;

  const ratingColor: Record<SampleAnalysis["rating"], string> = {
    excellent: "#34d399",
    good: "#60a5fa",
    fair: "#fbbf24",
    poor: "#f87171",
  };
  const ratingLabel: Record<SampleAnalysis["rating"], string> = {
    excellent: t.sampleQualityExcellent,
    good: t.sampleQualityGood,
    fair: t.sampleQualityFair,
    poor: t.sampleQualityPoor,
  };

  const color = ratingColor[analysis.rating];

  return (
    <div style={feedbackBoxStyle(`${color}15`, `${color}40`)}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <div style={{
          width: 8, height: 8, borderRadius: "50%", background: color,
        }} />
        <span style={{ fontSize: typography.size.sm, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "1px" }}>
          {t.sampleQuality}: {ratingLabel[analysis.rating]}
        </span>
        <span style={{ fontSize: typography.size.xs, color: colors.textDim, fontFamily: fonts.mono, marginLeft: "auto" }}>
          {analysis.duration_s.toFixed(1)}s · SNR {analysis.snr_db.toFixed(1)}dB · peak {analysis.peak_dbfs.toFixed(1)}dBFS
        </span>
      </div>
      {analysis.issues.length > 0 && (
        <ul style={{
          margin: "6px 0 0", paddingLeft: 18, fontSize: typography.size.xs,
          color: colors.textDim, lineHeight: 1.6,
        }}>
          {analysis.issues.map((issue, i) => (
            <li key={i}>{issue}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function feedbackBoxStyle(bg: string, border: string): React.CSSProperties {
  return {
    padding: "10px 14px",
    background: bg,
    border: `1px solid ${border}`,
    borderRadius: radii.md,
    fontFamily: fonts.sans,
  };
}
