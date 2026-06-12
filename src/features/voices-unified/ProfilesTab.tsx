import { useRef, useState } from "react";

import { analyzeSample, type SampleAnalysis } from "@/api/analyze";
import { API_BASE } from "@/api/client";
import { AudioRecorder } from "@/components/AudioRecorder";
import { Button } from "@/components/Button";
import { useConfirm } from "@/components/ConfirmProvider";
import { IconButton } from "@/components/IconButton";
import { logger } from "@/logging/logger";
import { downloadBlob } from "@/utils/download";
import * as Icons from "@/components/icons";
import { ALL_VOICES } from "@/constants/voices";
import { useSharedProfiles } from "@/hooks/profilesContext";
import type { SamplePlayerState } from "@/hooks/useSamplePlayer";
import type { VoicePreviewState } from "@/hooks/useVoicePreview";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, typography } from "@/theme/tokens";
import type { Profile } from "@/types/domain";

import { QualityFeedback } from "./QualityFeedback";

const MAX_SAMPLES = 5;

interface ProfilesTabProps {
  t: Translations;
  profiles: readonly Profile[];
  onUse: (profile: Profile) => void;
  onEdit: (profile: Profile) => void;
  onDelete: (profileId: string) => void;
  onToggleCastilianAnchor: (profileId: string, value: boolean) => void;
  onNew: () => void;
  onToast: (msg: string) => void;
  samplePlayer: SamplePlayerState;
  voicePreview: VoicePreviewState;
}

export function ProfilesTab({ t, profiles, onUse, onEdit, onDelete, onToggleCastilianAnchor, onNew, onToast, samplePlayer, voicePreview }: ProfilesTabProps) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{t.savedProfiles}</h3>
        <Button variant="primary" size="sm" onClick={onNew}>
          + {t.newProfile}
        </Button>
      </div>

      {profiles.length === 0 ? (
        <EmptyState t={t} />
      ) : (
        <div className="vf-grid-2col">
          {profiles.map((p) => (
            <ProfileCard
              key={p.id}
              t={t}
              profile={p}
              onUse={() => onUse(p)}
              onEdit={() => onEdit(p)}
              onDelete={() => onDelete(p.id)}
              onToggleCastilianAnchor={(v) => onToggleCastilianAnchor(p.id, v)}
              onToast={onToast}
              samplePlayer={samplePlayer}
              voicePreview={voicePreview}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ t }: { t: Translations }) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "60px 20px",
        background: colors.surfaceSubtle,
        borderRadius: radii.xl,
        border: `1px solid ${colors.borderSubtle}`,
      }}
    >
      <div style={{ color: colors.textGhost, marginBottom: 12 }}>
        <Icons.Mic />
      </div>
      <p style={{ margin: 0, fontSize: typography.size.base, color: colors.textDim, fontWeight: 500 }}>
        {t.noProfiles}
      </p>
      <p style={{ margin: "8px 0 0", fontSize: typography.size.sm, color: colors.textFaint }}>
        {t.noProfilesHint}
      </p>
    </div>
  );
}

interface ProfileCardProps {
  t: Translations;
  profile: Profile;
  onUse: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleCastilianAnchor: (value: boolean) => void;
  onToast: (msg: string) => void;
  samplePlayer: SamplePlayerState;
  voicePreview: VoicePreviewState;
}

function ProfileCard({ t, profile, onUse, onEdit, onDelete, onToggleCastilianAnchor, onToast, samplePlayer, voicePreview }: ProfileCardProps) {
  const confirm = useConfirm();
  const voice = ALL_VOICES.find((v) => v.id === profile.voiceId);
  const hasSamples = profile.samples.length > 0;

  const params = [
    { label: t.speed, value: `${profile.speed}%` },
    { label: t.pitch, value: `${profile.pitch > 0 ? "+" : ""}${profile.pitch}st` },
    { label: t.volume, value: `${profile.volume}%` },
  ] as const;
  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: radii.xl,
        padding: 20,
        backdropFilter: "blur(12px)",
        transition: "all 0.2s",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 16,
        }}
      >
        <div>
          <h4 style={{ margin: 0, fontSize: typography.size.base, fontWeight: 700 }}>{profile.name}</h4>
          <p style={{ margin: "4px 0 0", fontSize: typography.size.xs, color: colors.textDim }}>
            {voice?.name ?? "—"} · {voice?.accent ?? "—"} · {profile.lang.toUpperCase()}
          </p>
        </div>
        <span
          style={{
            padding: "3px 8px",
            borderRadius: 4,
            fontSize: 9,
            fontWeight: 700,
            background: hasSamples ? colors.successSoft : "rgba(148,163,184,0.08)",
            color: hasSamples ? colors.success : colors.textDim,
            textTransform: "uppercase",
            letterSpacing: "1px",
            fontFamily: fonts.mono,
          }}
        >
          {hasSamples ? t.badgeWithSample : t.badgePreset}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 8,
          marginBottom: 16,
        }}
      >
        {params.map((param) => (
          <div
            key={param.label}
            style={{
              padding: "8px 10px",
              borderRadius: radii.md,
              background: "rgba(30,41,59,0.5)",
              textAlign: "center",
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: 9,
                color: colors.textDim,
                textTransform: "uppercase",
                letterSpacing: "1px",
              }}
            >
              {param.label}
            </p>
            <p
              style={{
                margin: "2px 0 0",
                fontSize: typography.size.base,
                fontWeight: 700,
                fontFamily: fonts.mono,
                color: colors.text,
              }}
            >
              {param.value}
            </p>
          </div>
        ))}
      </div>

      <ProfileSamples t={t} profile={profile} onToast={onToast} samplePlayer={samplePlayer} />

      {/* Preview: cloned profiles route through the clone engine (real
          cloned voice); preset profiles preview their base voice. */}
      {(() => {
        const isCloned = hasSamples;
        const previewKey = isCloned ? profile.id : profile.voiceId;
        const isActive = voicePreview.previewingId === previewKey;
        const isLoading = voicePreview.loadingId === previewKey;
        const label = isLoading
          ? t.previewGenerating
          : isActive
            ? t.stop
            : isCloned
              ? t.previewClonedVoice
              : `${t.previewVoice} ${voice?.name ?? ""}`;
        return (
          <button
            onClick={() =>
              isCloned
                ? voicePreview.toggle(profile.voiceId, profile.lang, profile.id)
                : voicePreview.toggle(profile.voiceId, profile.lang)
            }
            style={{
              width: "100%",
              padding: "6px 0",
              borderRadius: radii.sm,
              marginBottom: 8,
              background: isActive ? colors.primarySoft : "transparent",
              border: `1px solid ${colors.borderFaint}`,
              color: colors.textMuted,
              cursor: "pointer",
              fontSize: typography.size.xs,
              fontWeight: 500,
              fontFamily: fonts.sans,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              transition: "all 0.2s",
              opacity: isLoading ? 0.7 : 1,
            }}
          >
            {isActive ? <Icons.Stop /> : <Icons.Volume />}
            {label}
          </button>
        );
      })()}

      {/* Castilian anchor toggle: prepend the configured reference voice
          to this profile's primary sample at synthesis time. Off by default. */}
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 10px",
          borderRadius: radii.md,
          background: profile.castilianAnchor
            ? "rgba(245,158,11,0.1)"
            : "rgba(30,41,59,0.4)",
          border: `1px solid ${profile.castilianAnchor ? "rgba(245,158,11,0.4)" : colors.borderFaint}`,
          cursor: "pointer",
          marginBottom: 12,
        }}
      >
        <input
          type="checkbox"
          checked={profile.castilianAnchor}
          // Toggle from React state (not e.target.checked) so we don't
          // depend on the DOM being in sync — under hot-reload or race
          // conditions the DOM can lag the props by one frame.
          onChange={() => onToggleCastilianAnchor(!profile.castilianAnchor)}
          aria-label={t.profileCastilianAnchor}
          style={{ accentColor: "#f59e0b", cursor: "pointer" }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
          <span style={{ fontSize: typography.size.xs, fontWeight: 600, color: colors.text }}>
            {t.profileCastilianAnchor}
          </span>
          <span style={{ fontSize: 10, color: colors.textFaint, lineHeight: 1.3 }}>
            {t.profileCastilianAnchorHint}
          </span>
        </div>
      </label>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <div style={{ flex: 1 }}>
          <Button variant="primary" size="sm" fullWidth onClick={onUse}>
            {t.useProfile}
          </Button>
        </div>
        <IconButton aria-label={t.editProfile} variant="secondary" size="md" onClick={onEdit}>
          <Icons.Edit />
        </IconButton>
        <IconButton
          aria-label={t.deleteProfile}
          variant="danger"
          size="md"
          onClick={async () => {
            if (
              await confirm({
                title: t.confirmDeleteTitle,
                message: t.confirmDeleteProfile.replace("{name}", profile.name),
                confirmText: t.actionDelete,
                cancelText: t.cancel,
                confirmVariant: "danger",
              })
            ) {
              onDelete();
            }
          }}
        >
          <Icons.Trash />
        </IconButton>
      </div>
    </div>
  );
}

// ── Sample manager (VOZ-10) ─────────────────────────────────────────

interface ProfileSamplesProps {
  t: Translations;
  profile: Profile;
  onToast: (msg: string) => void;
  samplePlayer: SamplePlayerState;
}

/**
 * Manage a profile's conditioning samples: listen, analyze (per-sample
 * quality + rhythm), download, delete with confirm, and add new ones
 * (file upload or microphone recording) up to MAX_SAMPLES. Every stored
 * sample is passed to XTTS, which averages the conditioning latents.
 */
function ProfileSamples({ t, profile, onToast, samplePlayer }: ProfileSamplesProps) {
  const confirm = useConfirm();
  const { addSample, removeSample } = useSharedProfiles();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [analyses, setAnalyses] = useState<Record<string, SampleAnalysis | "loading">>({});

  const handleAdd = async (file: File | undefined): Promise<void> => {
    if (!file || busy) return;
    setBusy(true);
    try {
      await addSample(profile.id, file);
      onToast(t.profileSampleAdded);
    } catch (e) {
      onToast(`Error: ${e instanceof Error ? e.message : t.unknownError}`);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (filename: string): Promise<void> => {
    const ok = await confirm({
      title: t.confirmDeleteTitle,
      message: t.confirmDeleteSample.replace("{name}", filename),
      confirmText: t.actionDelete,
      cancelText: t.cancel,
      confirmVariant: "danger",
    });
    if (!ok) return;
    try {
      await removeSample(profile.id, filename);
      if (samplePlayer.playingFilename === filename) samplePlayer.toggle(filename);
      setAnalyses((prev) => {
        const next = { ...prev };
        delete next[filename];
        return next;
      });
      onToast(t.profileSampleRemoved);
    } catch (e) {
      onToast(`Error: ${e instanceof Error ? e.message : t.unknownError}`);
    }
  };

  const handleAnalyze = async (filename: string): Promise<void> => {
    setAnalyses((prev) => ({ ...prev, [filename]: "loading" }));
    try {
      const file = await fetchSampleFile(filename);
      const result = await analyzeSample(file);
      setAnalyses((prev) => ({ ...prev, [filename]: result }));
    } catch (e) {
      logger.error("Sample analysis failed", {
        profileId: profile.id,
        filename,
        error: e instanceof Error ? e.message : String(e),
      });
      setAnalyses((prev) => {
        const next = { ...prev };
        delete next[filename];
        return next;
      });
      onToast(t.profileSampleAnalysisFailed);
    }
  };

  // Downloads a stored sample named after the profile (not the opaque
  // server filename). Fetched as a blob so the anchor download works
  // regardless of API origin.
  const handleDownload = async (filename: string, index: number): Promise<void> => {
    const dot = filename.lastIndexOf(".");
    const ext = dot >= 0 ? filename.slice(dot) : ".wav";
    const base = profile.name.replace(/[^\w\s.-]/g, "_").trim() || "voice_sample";
    const suffix = profile.samples.length > 1 ? `_${index + 1}` : "";
    try {
      const res = await fetch(`${API_BASE}/voices/samples/${filename}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      downloadBlob(await res.blob(), `${base}${suffix}${ext}`);
    } catch (e) {
      logger.error("Profile sample download failed", {
        profileId: profile.id,
        filename,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const canAdd = profile.samples.length < MAX_SAMPLES;

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: typography.size.xs, fontWeight: 700, color: colors.textMuted }}>
          {t.profileSamples} ({profile.samples.length}/{MAX_SAMPLES})
        </span>
      </div>
      <p style={{ margin: "0 0 8px", fontSize: 10, color: colors.textFaint, lineHeight: 1.4 }}>
        {t.profileSamplesHint}
      </p>

      {profile.samples.map((filename, index) => {
        const analysis = analyses[filename];
        const playing = samplePlayer.playingFilename === filename;
        return (
          <div key={filename} style={{ marginBottom: 6 }}>
            <div
              style={{
                padding: "6px 10px",
                borderRadius: radii.md,
                background: "rgba(59,130,246,0.06)",
                border: "1px solid rgba(59,130,246,0.1)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <button
                onClick={() => samplePlayer.toggle(filename)}
                aria-label={playing ? t.stop : t.play}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  background: playing ? colors.accent : colors.primary,
                  border: "none",
                  color: "#fff",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  transition: "all 0.2s",
                }}
              >
                {playing ? <Icons.Stop /> : <Icons.Play />}
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: typography.size.xs, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {filename}
                </p>
                {index === 0 && profile.sampleDuration !== null && (
                  <p style={{ margin: 0, fontSize: 10, color: colors.textDim }}>
                    {profile.sampleDuration}s
                  </p>
                )}
              </div>
              <button
                onClick={() => void handleAnalyze(filename)}
                disabled={analysis === "loading"}
                style={{
                  padding: "4px 8px",
                  borderRadius: radii.sm,
                  fontSize: 10,
                  fontWeight: 600,
                  background: "transparent",
                  border: `1px solid ${colors.borderFaint}`,
                  color: colors.textMuted,
                  cursor: analysis === "loading" ? "wait" : "pointer",
                  fontFamily: fonts.sans,
                  flexShrink: 0,
                }}
              >
                {analysis === "loading" ? "..." : t.profileAnalyzeSample}
              </button>
              <IconButton
                aria-label={t.profileDownloadSample}
                variant="secondary"
                size="sm"
                onClick={() => void handleDownload(filename, index)}
              >
                <Icons.Download />
              </IconButton>
              <IconButton
                aria-label={t.profileDeleteSample}
                variant="danger"
                size="sm"
                onClick={() => void handleRemove(filename)}
              >
                <Icons.Trash />
              </IconButton>
            </div>
            {analysis !== undefined && analysis !== "loading" && (
              <div style={{ marginTop: 4 }}>
                <QualityFeedback t={t} analysis={analysis} analyzing={false} />
              </div>
            )}
          </div>
        );
      })}

      {canAdd ? (
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".wav,.mp3,.ogg,.flac"
            style={{ display: "none" }}
            onChange={(e) => {
              void handleAdd(e.target.files?.[0]);
              e.target.value = ""; // allow re-picking the same file
            }}
          />
          <div style={{ flex: 1 }}>
            <Button
              variant="secondary"
              size="sm"
              fullWidth
              loading={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              + {t.profileAddSample}
            </Button>
          </div>
          <div style={{ flex: 1 }}>
            <AudioRecorder
              onRecorded={(file) => void handleAdd(file)}
              labelRecord={t.recordVoice}
              labelStop={t.stopRecording}
              labelRecording={t.recording}
            />
          </div>
        </div>
      ) : (
        <p style={{ margin: "4px 0 0", fontSize: 10, color: colors.textFaint }}>
          {t.profileSamplesFull}
        </p>
      )}
    </div>
  );
}

async function fetchSampleFile(filename: string): Promise<File> {
  const res = await fetch(`${API_BASE}/voices/samples/${filename}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  return new File([blob], filename, { type: blob.type || "audio/wav" });
}
