import { useEffect, useRef, useState } from "react";

import { isAbortError } from "@/api/client";
import { crossLingualSynthesize } from "@/api/experimental";
import { AudioRecorder } from "@/components/AudioRecorder";
import { Button } from "@/components/Button";
import { PromptDialog } from "@/components/PromptDialog";
import * as Icons from "@/components/icons";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { useProfiles } from "@/hooks/useProfiles";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, typography } from "@/theme/tokens";
import type { Language } from "@/types/domain";

interface ExperimentalTabProps {
  t: Translations;
  onToast: (msg: string) => void;
}

export function ExperimentalTab({ t, onToast }: ExperimentalTabProps) {
  const [text, setText] = useState("");
  const [sampleFile, setSampleFile] = useState<File | null>(null);
  const [language, setLanguage] = useState("es");
  const [isGenerating, setIsGenerating] = useState(false);
  const [saveProfileOpen, setSaveProfileOpen] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const sampleInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const player = useAudioPlayer();
  const { create: createProfile } = useProfiles();

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  const canGenerate = text.trim().length > 0 && sampleFile !== null && !isGenerating;

  const handleGenerate = async (): Promise<void> => {
    if (!sampleFile || !text.trim()) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setIsGenerating(true);
    try {
      const result = await crossLingualSynthesize(
        text,
        sampleFile,
        language,
        "mp3",
        controller.signal,
      );
      player.load(result.blob, result.duration);
      onToast(t.expReady);
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

  // Save the experimental sample as a reusable profile. The uploaded
  // sample is stored (via ``createProfile``) so the user can pick it
  // from the voice selector in any tab afterwards.
  const handleSaveAsProfile = async (name: string): Promise<void> => {
    if (!sampleFile || !name.trim()) return;
    setSavingProfile(true);
    try {
      await createProfile({
        name: name.trim(),
        voiceId: "",                       // cloned profile; no system-voice base
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

        {/* Player */}
        {player.url && (
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
            onRecorded={setSampleFile}
            labelRecord={t.recordVoice}
            labelStop={t.stopRecording}
            labelRecording={t.recording}
          />

          <div style={{ textAlign: "center", fontSize: typography.size.xs, color: colors.textDim, margin: "6px 0" }}>{t.or}</div>

          <input ref={sampleInputRef} type="file" accept=".wav,.mp3,.ogg,.flac" style={{ display: "none" }}
            onChange={(e) => setSampleFile(e.target.files?.[0] ?? null)}
          />
          <button onClick={() => sampleInputRef.current?.click()} style={{
            width: "100%", padding: "12px 0", borderRadius: radii.lg,
            background: sampleFile ? colors.primarySoft : colors.surfaceAlt,
            border: sampleFile ? `1px solid ${colors.primaryBorder}` : `1px solid ${colors.border}`,
            color: sampleFile ? colors.primaryLight : colors.textMuted,
            cursor: "pointer", fontSize: typography.size.sm, fontWeight: 600, fontFamily: fonts.sans,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}>
            <Icons.Upload />
            {sampleFile ? sampleFile.name : t.expVoiceSample}
          </button>

          {sampleFile && (
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
