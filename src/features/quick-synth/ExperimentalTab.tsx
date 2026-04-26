import { useEffect, useRef, useState } from "react";

import { API_BASE, isAbortError } from "@/api/client";
import {
  type CandidateTake,
  crossLingualCandidates,
  crossLingualSynthesize,
  getReferenceVoiceStatus,
  type ReferenceVoiceStatus,
} from "@/api/experimental";
import type { CreateProfileInput } from "@/api/profiles";
import { getStudioAudioUrl } from "@/api/studio";
import { AudioRecorder } from "@/components/AudioRecorder";
import { Button } from "@/components/Button";
import { PromptDialog } from "@/components/PromptDialog";
import * as Icons from "@/components/icons";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { useProfiles } from "@/hooks/useProfiles";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, typography } from "@/theme/tokens";
import type { Language, Profile } from "@/types/domain";

interface ExperimentalTabProps {
  t: Translations;
  onToast: (msg: string) => void;
  onCreateProfile?: (input: CreateProfileInput) => Promise<unknown>;
}

export function ExperimentalTab({ t, onToast, onCreateProfile }: ExperimentalTabProps) {
  const [text, setText] = useState("");
  const [sampleFile, setSampleFile] = useState<File | null>(null);
  const [language, setLanguage] = useState("es");
  const [speed, setSpeed] = useState(100);
  // B — anchor accent toward Castilian via warm-up + trim
  const [castilianWarmup, setCastilianWarmup] = useState(false);
  // D1 — replace user sample with backend's Castilian reference
  const [useCastilianReference, setUseCastilianReference] = useState(false);
  // C — generate N takes and pick the best
  const [candidatesCount, setCandidatesCount] = useState(1);
  const [candidates, setCandidates] = useState<CandidateTake[]>([]);
  const [referenceStatus, setReferenceStatus] = useState<ReferenceVoiceStatus>({
    configured: false,
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [saveProfileOpen, setSaveProfileOpen] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const sampleInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const player = useAudioPlayer();
  const { profiles, create: defaultCreateProfile } = useProfiles();
  const createProfile = onCreateProfile || defaultCreateProfile;
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);

  // Profiles that have an attached audio sample — those can be used here
  // as the speaker_wav source. Profiles without a sample (preset-only)
  // are filtered out.
  const profilesWithSample = profiles.filter((p) => p.sampleName);

  const handlePickProfile = async (profile: Profile): Promise<void> => {
    if (!profile.sampleName) return;
    try {
      const res = await fetch(`${API_BASE}/voices/samples/${profile.sampleName}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], profile.sampleName, {
        type: blob.type || "audio/wav",
      });
      setSampleFile(file);
      setSelectedProfileId(profile.id);
    } catch (e) {
      onToast(`Error: ${e instanceof Error ? e.message : "load profile"}`);
    }
  };

  // If the user uploads/records a NEW sample, drop the profile-link
  const setSampleFromUpload = (file: File | null): void => {
    setSampleFile(file);
    setSelectedProfileId(null);
  };

  // Find out whether the operator has dropped a Castilian reference voice
  // under data/voices/reference/. If not, the D1 toggle stays disabled.
  useEffect(() => {
    let cancelled = false;
    getReferenceVoiceStatus()
      .then((s) => {
        if (!cancelled) setReferenceStatus(s);
      })
      .catch(() => {
        // Silently ignore — toggle stays disabled
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const isSpanish = language === "es";
  const showAccentControls = isSpanish;

  const canGenerate = text.trim().length > 0 && sampleFile !== null && !isGenerating;

  const buildOptions = (): {
    language: string;
    outputFormat: string;
    speed: number;
    castilianWarmup: boolean;
    useCastilianReference: boolean;
  } => ({
    language,
    outputFormat: "mp3",
    speed,
    castilianWarmup: isSpanish && castilianWarmup,
    useCastilianReference:
      isSpanish && useCastilianReference && referenceStatus.configured,
  });

  const handleGenerate = async (): Promise<void> => {
    if (!sampleFile || !text.trim()) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setIsGenerating(true);
    setCandidates([]);
    try {
      const opts = buildOptions();
      if (candidatesCount > 1) {
        const result = await crossLingualCandidates(
          text,
          sampleFile,
          candidatesCount,
          opts,
          controller.signal,
        );
        setCandidates(result.candidates);
        // Clear single-take player so the multi-take grid is the only result
        player.unload();
        onToast(t.expCandidatesReady.replace("{n}", String(result.count)));
      } else {
        const result = await crossLingualSynthesize(
          text,
          sampleFile,
          opts,
          controller.signal,
        );
        player.load(result.blob, result.duration);
        onToast(t.expReady);
      }
    } catch (e) {
      if (isAbortError(e)) {
        onToast(t.synthesisCancelled);
      } else {
        onToast(`Error: ${e instanceof Error ? e.message : t.unknownError}`);
      }
    } finally {
      setIsGenerating(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const handleCancel = (): void => {
    abortRef.current?.abort();
  };

  const handleDownload = (): void => {
    if (!player.url) return;
    const a = document.createElement("a");
    a.href = player.url;
    a.download = "voxforge_crosslingual.mp3";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // Save the experimental sample as a reusable profile.
  const handleSaveAsProfile = async (name: string): Promise<void> => {
    if (!sampleFile || !name.trim()) return;
    setSavingProfile(true);
    try {
      await createProfile({
        name: name.trim(),
        voiceId: "",
        language: language as Language,
        speed: 100,
        pitch: 0,
        volume: 80,
        sampleFile,
      });
      onToast(t.expSavedAsProfile.replace("{name}", name.trim()));
      setSaveProfileOpen(false);
    } catch (e) {
      onToast(`Error: ${e instanceof Error ? e.message : t.unknownError}`);
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <div className="vf-grid-editor-sidebar">
      {/* Left: text + result */}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Warning banner */}
        <div style={{
          background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)",
          borderRadius: radii.lg, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10,
          fontSize: typography.size.sm, color: "#f59e0b",
        }}>
          <span style={{ fontSize: typography.size.lg }}>&#9888;</span>
          {t.expWarning}
        </div>

        {/* Text input */}
        <div style={{
          background: colors.surface, border: `1px solid ${colors.border}`,
          borderRadius: radii.xl, overflow: "hidden", backdropFilter: "blur(12px)",
        }}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t.expTextPlaceholder}
            style={{
              width: "100%", minHeight: 300, padding: 20, resize: "vertical",
              background: "none", border: "none", color: colors.text,
              fontSize: typography.size.base, lineHeight: 1.7, fontFamily: fonts.sans,
              outline: "none", boxSizing: "border-box",
            }}
          />
          <div style={{
            padding: "10px 20px", borderTop: `1px solid ${colors.borderFaint}`,
            fontSize: typography.size.xs, color: colors.textFaint, fontFamily: fonts.mono,
          }}>
            {text.length} {t.charCount}
          </div>
        </div>

        {/* Single-take player */}
        {player.url && candidates.length === 0 && (
          <div style={{
            background: colors.surface, border: `1px solid ${colors.border}`,
            borderRadius: radii.xl, padding: 20, backdropFilter: "blur(12px)",
          }}>
            <audio ref={player.audioRef} src={player.url}
              onPlay={() => player.setIsPlaying(true)}
              onPause={() => player.setIsPlaying(false)}
              onEnded={() => player.setIsPlaying(false)}
              style={{ display: "none" }}
            />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button onClick={player.toggle} aria-label={player.isPlaying ? t.pause : t.play} style={{
                  width: 42, height: 42, borderRadius: "50%",
                  background: player.isPlaying ? colors.accent : "#f59e0b",
                  border: "none", color: "#fff", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>{player.isPlaying ? <Icons.Pause /> : <Icons.Play />}</button>
                <button onClick={player.stop} disabled={!player.isPlaying} aria-label={t.stop} style={{
                  width: 42, height: 42, borderRadius: "50%",
                  background: colors.textDark, border: `1px solid ${colors.border}`,
                  color: colors.textMuted, cursor: player.isPlaying ? "pointer" : "default",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  opacity: player.isPlaying ? 1 : 0.3,
                }}><Icons.Stop /></button>
                {player.duration > 0 && (
                  <span style={{ fontSize: typography.size.xs, color: colors.textDim, fontFamily: fonts.mono }}>{player.duration.toFixed(1)}s</span>
                )}
                <span style={{ fontSize: 9, fontWeight: 700, fontFamily: fonts.mono, padding: "2px 6px", borderRadius: 4, background: "rgba(245,158,11,0.2)", color: "#f59e0b", textTransform: "uppercase" }}>EXPERIMENTAL</span>
              </div>
              <button onClick={handleDownload} style={{
                display: "flex", alignItems: "center", gap: 6, padding: "10px 18px",
                borderRadius: radii.md, background: "rgba(59,130,246,0.15)",
                border: `1px solid ${colors.primaryBorder}`, color: colors.primaryLight,
                cursor: "pointer", fontSize: typography.size.sm, fontWeight: 600, fontFamily: fonts.sans,
              }}><Icons.Download /> {t.download}</button>
            </div>
          </div>
        )}

        {/* Multi-candidate grid */}
        {candidates.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{
              margin: 0, fontSize: typography.size.sm, color: colors.textDim,
            }}>
              {t.expCandidatesPickHint}
            </p>
            {candidates.map((take, idx) => (
              <CandidateRow
                key={take.id}
                t={t}
                index={idx + 1}
                take={take}
              />
            ))}
          </div>
        )}
      </div>

      {/* Right: voice sample + language + generate */}
      <div style={{
        background: colors.surface, border: `1px solid ${colors.border}`,
        borderRadius: radii.xl, padding: 24, backdropFilter: "blur(12px)",
        display: "flex", flexDirection: "column", gap: 16,
      }}>
        <h3 style={{ margin: 0, fontSize: typography.size.lg, fontWeight: 700 }}>{t.expTitle}</h3>
        <p style={{ margin: 0, fontSize: typography.size.sm, color: colors.textDim }}>{t.expDesc}</p>

        {/* Voice sample upload */}
        <div>
          <label style={{ fontSize: typography.size.xs, color: colors.textDim, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 8, display: "block" }}>
            {t.expVoiceSample}
          </label>

          <AudioRecorder
            onRecorded={setSampleFromUpload}
            labelRecord={t.recordVoice}
            labelStop={t.stopRecording}
            labelRecording={t.recording}
          />

          <div style={{ textAlign: "center", fontSize: typography.size.xs, color: colors.textDim, margin: "6px 0" }}>{t.or}</div>

          <input ref={sampleInputRef} type="file" accept=".wav,.mp3,.ogg,.flac" style={{ display: "none" }}
            onChange={(e) => setSampleFromUpload(e.target.files?.[0] ?? null)}
          />
          <button onClick={() => sampleInputRef.current?.click()} style={{
            width: "100%", padding: "12px 0", borderRadius: radii.lg,
            background: sampleFile && !selectedProfileId ? colors.primarySoft : colors.surfaceAlt,
            border: sampleFile && !selectedProfileId ? `1px solid ${colors.primaryBorder}` : `1px solid ${colors.border}`,
            color: sampleFile && !selectedProfileId ? colors.primaryLight : colors.textMuted,
            cursor: "pointer", fontSize: typography.size.sm, fontWeight: 600, fontFamily: fonts.sans,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}>
            <Icons.Upload />
            {sampleFile && !selectedProfileId ? sampleFile.name : t.expVoiceSample}
          </button>

          {/* Use a saved profile that already has a voice sample */}
          {profilesWithSample.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <label style={{
                fontSize: typography.size.xs, color: colors.textDim,
                fontWeight: 600, textTransform: "uppercase",
                letterSpacing: "1.5px", marginBottom: 6, display: "block",
              }}>
                {t.expOrPickProfile}
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {profilesWithSample.map((p) => {
                  const active = selectedProfileId === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => void handlePickProfile(p)}
                      style={{
                        textAlign: "left",
                        padding: "8px 12px",
                        borderRadius: radii.md,
                        background: active ? "rgba(245,158,11,0.15)" : colors.surfaceAlt,
                        border: active
                          ? "1px solid rgba(245,158,11,0.5)"
                          : `1px solid ${colors.border}`,
                        color: active ? "#f59e0b" : colors.textMuted,
                        cursor: "pointer",
                        fontSize: typography.size.sm,
                        fontFamily: fonts.sans,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <Icons.Mic />
                      <span style={{ flex: 1, fontWeight: 600 }}>{p.name}</span>
                      <span style={{
                        fontSize: typography.size.xs, color: colors.textFaint,
                        fontFamily: fonts.mono,
                      }}>
                        {p.sampleDuration ? `${p.sampleDuration}s` : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {sampleFile && !selectedProfileId && (
            <div style={{ marginTop: 8, textAlign: "center" }}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSaveProfileOpen(true)}
              >
                {t.expSaveAsProfile}
              </Button>
            </div>
          )}
        </div>

        {/* Target language */}
        <div>
          <label style={{ fontSize: typography.size.xs, color: colors.textDim, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 8, display: "block" }}>
            {t.expTargetLang}
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            {[
              { id: "es", label: "Español" },
              { id: "en", label: "English" },
            ].map((l) => (
              <button key={l.id} onClick={() => setLanguage(l.id)} style={{
                flex: 1, padding: "8px 0", borderRadius: radii.sm, fontSize: typography.size.sm, fontWeight: 600,
                background: language === l.id ? "#f59e0b" : colors.surfaceAlt,
                color: language === l.id ? "#fff" : colors.textDim,
                border: "none", cursor: "pointer", fontFamily: fonts.sans,
              }}>{l.label}</button>
            ))}
          </div>
        </div>

        {/* Castilian-accent controls (only when target is Spanish) */}
        {showAccentControls && (
          <div style={{
            border: `1px solid ${colors.borderFaint}`,
            borderRadius: radii.md,
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}>
            <label style={{
              fontSize: typography.size.xs, color: colors.textDim, fontWeight: 600,
              textTransform: "uppercase", letterSpacing: "1.5px",
            }}>
              {t.expAccentSection}
            </label>

            {/* B — Castilian warm-up */}
            <ToggleRow
              checked={castilianWarmup}
              onChange={setCastilianWarmup}
              label={t.expCastilianWarmup}
              hint={t.expCastilianWarmupHint}
            />

            {/* D1 — Castilian reference */}
            <ToggleRow
              checked={useCastilianReference}
              onChange={setUseCastilianReference}
              disabled={!referenceStatus.configured}
              label={t.expCastilianReference}
              hint={
                referenceStatus.configured
                  ? t.expCastilianReferenceHint.replace(
                      "{file}",
                      referenceStatus.filename ?? "",
                    )
                  : t.expCastilianReferenceMissing
              }
            />
          </div>
        )}

        {/* Speed control */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <label style={{ fontSize: typography.size.xs, color: colors.textDim, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px" }}>
              {t.speed}
            </label>
            <span style={{ fontSize: typography.size.sm, color: colors.textDim, fontFamily: fonts.mono }}>{speed}%</span>
          </div>
          <input
            type="range"
            min={50}
            max={200}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            style={{ width: "100%", accentColor: colors.primary }}
          />
        </div>

        {/* Candidates count (C) */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <label style={{ fontSize: typography.size.xs, color: colors.textDim, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px" }}>
              {t.expCandidatesLabel}
            </label>
            <span style={{ fontSize: typography.size.sm, color: colors.textDim, fontFamily: fonts.mono }}>
              {candidatesCount}×
            </span>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                onClick={() => setCandidatesCount(n)}
                style={{
                  flex: 1, padding: "8px 0", borderRadius: radii.sm,
                  fontSize: typography.size.sm, fontWeight: 600,
                  background: candidatesCount === n ? "#f59e0b" : colors.surfaceAlt,
                  color: candidatesCount === n ? "#fff" : colors.textDim,
                  border: "none", cursor: "pointer", fontFamily: fonts.sans,
                }}
              >
                {n}
              </button>
            ))}
          </div>
          <p style={{
            margin: "6px 0 0", fontSize: typography.size.xs, color: colors.textFaint,
            lineHeight: 1.4,
          }}>
            {t.expCandidatesHint}
          </p>
        </div>

        {/* Generate / Cancel */}
        {isGenerating ? (
          <Button
            variant="danger"
            size="lg"
            fullWidth
            onClick={handleCancel}
          >
            {t.cancel}
          </Button>
        ) : (
          <Button
            variant="warning"
            size="lg"
            icon={<Icons.Waveform />}
            disabled={!canGenerate}
            fullWidth
            onClick={() => void handleGenerate()}
          >
            {t.expGenerate}
          </Button>
        )}
      </div>

      <PromptDialog
        open={saveProfileOpen}
        title={t.expSaveAsProfileTitle}
        label={t.profileName}
        confirmText={savingProfile ? t.generating : t.saveProfile}
        cancelText={t.cancel}
        initialValue=""
        onConfirm={(name) => void handleSaveAsProfile(name)}
        onCancel={() => setSaveProfileOpen(false)}
      />
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────

interface ToggleRowProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
  disabled?: boolean;
}

function ToggleRow({ checked, onChange, label, hint, disabled }: ToggleRowProps) {
  return (
    <div
      style={{
        display: "flex", flexDirection: "column", gap: 4,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <label
        style={{
          display: "flex", alignItems: "center", gap: 8,
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-label={label}
          onChange={(e) => onChange(e.target.checked)}
          style={{ accentColor: "#f59e0b", cursor: disabled ? "not-allowed" : "pointer" }}
        />
        <span style={{ fontSize: typography.size.sm, fontWeight: 600, color: colors.text }}>
          {label}
        </span>
      </label>
      <span style={{ fontSize: typography.size.xs, color: colors.textFaint, paddingLeft: 24, lineHeight: 1.4 }}>
        {hint}
      </span>
    </div>
  );
}

interface CandidateRowProps {
  t: Translations;
  index: number;
  take: CandidateTake;
}

function CandidateRow({ t, index, take }: CandidateRowProps) {
  const url = getStudioAudioUrl(take.path);
  const downloadHref = url; // backend serves with proper content-type
  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: radii.lg,
        padding: 14,
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div
        style={{
          width: 32, height: 32, borderRadius: "50%",
          background: "#f59e0b", color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 700, fontFamily: fonts.mono,
          flexShrink: 0,
        }}
      >
        {index}
      </div>
      <audio
        controls
        src={url}
        style={{ flex: 1, height: 36 }}
      />
      <span style={{
        fontSize: typography.size.xs, fontFamily: fonts.mono, color: colors.textDim,
        minWidth: 50, textAlign: "right",
      }}>
        {take.durationS.toFixed(1)}s
      </span>
      <a
        href={downloadHref}
        download={`voxforge_candidate_${index}.mp3`}
        aria-label={t.download}
        style={{
          padding: "8px 12px", borderRadius: radii.md,
          background: "rgba(59,130,246,0.15)",
          border: `1px solid ${colors.primaryBorder}`,
          color: colors.primaryLight,
          fontSize: typography.size.xs, fontWeight: 600, fontFamily: fonts.sans,
          textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4,
        }}
      >
        <Icons.Download /> {t.download}
      </a>
    </div>
  );
}
