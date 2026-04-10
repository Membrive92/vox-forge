import { useRef, useState } from "react";

import { crossLingualSynthesize } from "@/api/experimental";
import { AudioRecorder } from "@/components/AudioRecorder";
import * as Icons from "@/components/icons";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import type { Translations } from "@/i18n";
import { colors, fonts, radii } from "@/theme/tokens";

interface ExperimentalTabProps {
  t: Translations;
  onToast: (msg: string) => void;
}

export function ExperimentalTab({ t, onToast }: ExperimentalTabProps) {
  const [text, setText] = useState("");
  const [sampleFile, setSampleFile] = useState<File | null>(null);
  const [language, setLanguage] = useState("es");
  const [isGenerating, setIsGenerating] = useState(false);
  const sampleInputRef = useRef<HTMLInputElement>(null);
  const player = useAudioPlayer();

  const canGenerate = text.trim().length > 0 && sampleFile !== null && !isGenerating;

  const handleGenerate = async (): Promise<void> => {
    if (!sampleFile || !text.trim()) return;
    setIsGenerating(true);
    try {
      const result = await crossLingualSynthesize(text, sampleFile, language);
      player.load(result.blob, result.duration);
      onToast(t.expReady);
    } catch (e) {
      onToast(`Error: ${e instanceof Error ? e.message : "Unknown"}`);
    } finally {
      setIsGenerating(false);
    }
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

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 24 }}>
      {/* Left: text + result */}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Warning banner */}
        <div style={{
          background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)",
          borderRadius: radii.lg, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10,
          fontSize: 12, color: "#f59e0b",
        }}>
          <span style={{ fontSize: 16 }}>&#9888;</span>
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
              fontSize: 15, lineHeight: 1.7, fontFamily: fonts.sans,
              outline: "none", boxSizing: "border-box",
            }}
          />
          <div style={{
            padding: "10px 20px", borderTop: `1px solid ${colors.borderFaint}`,
            fontSize: 11, color: colors.textFaint, fontFamily: fonts.mono,
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
                  <span style={{ fontSize: 11, color: colors.textDim, fontFamily: fonts.mono }}>{player.duration.toFixed(1)}s</span>
                )}
                <span style={{ fontSize: 9, fontWeight: 700, fontFamily: fonts.mono, padding: "2px 6px", borderRadius: 4, background: "rgba(245,158,11,0.2)", color: "#f59e0b", textTransform: "uppercase" }}>EXPERIMENTAL</span>
              </div>
              <button onClick={handleDownload} style={{
                display: "flex", alignItems: "center", gap: 6, padding: "10px 18px",
                borderRadius: radii.md, background: "rgba(59,130,246,0.15)",
                border: `1px solid ${colors.primaryBorder}`, color: colors.primaryLight,
                cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: fonts.sans,
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
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{t.expTitle}</h3>
        <p style={{ margin: 0, fontSize: 12, color: colors.textDim }}>{t.expDesc}</p>

        {/* Voice sample upload */}
        <div>
          <label style={{ fontSize: 11, color: colors.textDim, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 8, display: "block" }}>
            {t.expVoiceSample}
          </label>

          <AudioRecorder
            onRecorded={setSampleFile}
            labelRecord={t.recordVoice}
            labelStop={t.stopRecording}
            labelRecording={t.recording}
          />

          <div style={{ textAlign: "center", fontSize: 11, color: colors.textDim, margin: "6px 0" }}>{t.or}</div>

          <input ref={sampleInputRef} type="file" accept=".wav,.mp3,.ogg,.flac" style={{ display: "none" }}
            onChange={(e) => setSampleFile(e.target.files?.[0] ?? null)}
          />
          <button onClick={() => sampleInputRef.current?.click()} style={{
            width: "100%", padding: "12px 0", borderRadius: radii.lg,
            background: sampleFile ? colors.primarySoft : colors.surfaceAlt,
            border: sampleFile ? `1px solid ${colors.primaryBorder}` : `1px solid ${colors.border}`,
            color: sampleFile ? colors.primaryLight : colors.textMuted,
            cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: fonts.sans,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}>
            <Icons.Upload />
            {sampleFile ? sampleFile.name : t.expVoiceSample}
          </button>
        </div>

        {/* Target language */}
        <div>
          <label style={{ fontSize: 11, color: colors.textDim, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 8, display: "block" }}>
            {t.expTargetLang}
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            {[
              { id: "es", label: "Español" },
              { id: "en", label: "English" },
            ].map((l) => (
              <button key={l.id} onClick={() => setLanguage(l.id)} style={{
                flex: 1, padding: "8px 0", borderRadius: radii.sm, fontSize: 12, fontWeight: 600,
                background: language === l.id ? "#f59e0b" : colors.surfaceAlt,
                color: language === l.id ? "#fff" : colors.textDim,
                border: "none", cursor: "pointer", fontFamily: fonts.sans,
              }}>{l.label}</button>
            ))}
          </div>
        </div>

        {/* Generate */}
        <button
          onClick={() => void handleGenerate()}
          disabled={!canGenerate}
          style={{
            width: "100%", padding: "14px 0", borderRadius: radii.lg,
            background: canGenerate ? "linear-gradient(135deg, #f59e0b, #d97706)" : colors.textDark,
            border: "none", color: "#fff", fontSize: 14, fontWeight: 700,
            cursor: canGenerate ? "pointer" : "default",
            fontFamily: fonts.sans, opacity: canGenerate ? 1 : 0.4,
            boxShadow: canGenerate ? "0 4px 24px rgba(245,158,11,0.35)" : "none",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}
        >
          <Icons.Waveform />
          {isGenerating ? t.expGenerating : t.expGenerate}
        </button>
      </div>
    </div>
  );
}
