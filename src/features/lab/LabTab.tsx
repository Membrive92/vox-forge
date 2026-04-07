import { useEffect, useRef, useState } from "react";

import { listPresets, processAudio, randomPreset, type Preset, type VoiceLabParams } from "@/api/voiceLab";
import { Slider } from "@/components/Slider";
import * as Icons from "@/components/icons";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import type { Translations } from "@/i18n";
import { colors, fonts, radii } from "@/theme/tokens";

interface LabTabProps {
  t: Translations;
  onToast: (msg: string) => void;
}

const DEFAULT_PARAMS: VoiceLabParams = {
  pitch_semitones: 0,
  formant_shift: 0,
  bass_boost_db: 0,
  warmth_db: 0,
  compression: 0,
  reverb: 0,
  speed: 1.0,
};

export function LabTab({ t, onToast }: LabTabProps) {
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [params, setParams] = useState<VoiceLabParams>({ ...DEFAULT_PARAMS });
  const [presets, setPresets] = useState<Preset[]>([]);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [presetFilter, setPresetFilter] = useState<string>("all");
  const [isProcessing, setIsProcessing] = useState(false);
  const [format, setFormat] = useState("mp3");
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const player = useAudioPlayer();

  useEffect(() => {
    listPresets().then(setPresets).catch(() => {});
  }, []);

  const setParam = (key: keyof VoiceLabParams, value: number): void => {
    setParams((prev) => ({ ...prev, [key]: value }));
    setActivePreset(null);
  };

  const applyPreset = (preset: Preset): void => {
    setParams({ ...preset.params });
    setActivePreset(preset.name);
  };

  const handleRandom = async (): Promise<void> => {
    try {
      const preset = await randomPreset();
      applyPreset(preset);
      onToast(preset.name);
    } catch { /* ignore */ }
  };

  const handleReset = (): void => {
    setParams({ ...DEFAULT_PARAMS });
    setActivePreset(null);
  };

  const handleProcess = async (): Promise<void> => {
    if (!sourceFile) return;
    setIsProcessing(true);
    try {
      const result = await processAudio(sourceFile, params, format);
      player.load(result.blob, result.duration);
      onToast(t.labReady);
    } catch (e) {
      onToast(`Error: ${e instanceof Error ? e.message : "Unknown"}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = (): void => {
    if (!player.url) return;
    const a = document.createElement("a");
    a.href = player.url;
    a.download = `voxforge_lab.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const filteredPresets = presetFilter === "all"
    ? presets
    : presets.filter((p) => p.category === presetFilter);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 24 }}>
      {/* Left: source + sliders + result */}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Source upload */}
        <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radii.xl, padding: 24, backdropFilter: "blur(12px)" }}>
          <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700 }}>{t.labTitle}</h3>
          <p style={{ margin: "0 0 16px", fontSize: 12, color: colors.textDim }}>{t.labDesc}</p>

          <input ref={sourceInputRef} type="file" accept=".wav,.mp3,.ogg,.flac" style={{ display: "none" }} onChange={(e) => setSourceFile(e.target.files?.[0] ?? null)} />
          <button
            onClick={() => sourceInputRef.current?.click()}
            style={{
              width: "100%", padding: "16px 0", borderRadius: radii.lg,
              background: sourceFile ? colors.primarySoft : colors.surfaceAlt,
              border: sourceFile ? `1px solid ${colors.primaryBorder}` : `2px dashed ${colors.border}`,
              color: sourceFile ? colors.primaryLight : colors.textMuted,
              cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: fonts.sans,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}
          >
            <Icons.Upload />
            {sourceFile ? sourceFile.name : t.labSourceAudio}
          </button>
        </div>

        {/* Sliders */}
        <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radii.xl, padding: 24, backdropFilter: "blur(12px)" }}>
          <Slider label={t.labPitch} value={params.pitch_semitones} onChange={(v) => setParam("pitch_semitones", v)} min={-12} max={12} step={0.5} unit="st" />
          <Slider label={t.labFormant} value={params.formant_shift} onChange={(v) => setParam("formant_shift", v)} min={-6} max={6} step={0.5} unit="st" />
          <Slider label={t.labBass} value={params.bass_boost_db} onChange={(v) => setParam("bass_boost_db", v)} min={-6} max={12} step={0.5} unit="dB" />
          <Slider label={t.labWarmth} value={params.warmth_db} onChange={(v) => setParam("warmth_db", v)} min={-3} max={6} step={0.5} unit="dB" />
          <Slider label={t.labCompression} value={params.compression} onChange={(v) => setParam("compression", v)} min={0} max={100} unit="%" />
          <Slider label={t.labReverb} value={params.reverb} onChange={(v) => setParam("reverb", v)} min={0} max={100} unit="%" />
          <Slider label={t.labSpeed} value={params.speed} onChange={(v) => setParam("speed", v)} min={0.5} max={2.0} step={0.05} unit="x" />

          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            {/* Format selector */}
            {["mp3", "wav"].map((f) => (
              <button key={f} onClick={() => setFormat(f)} style={{
                padding: "4px 12px", fontSize: 10, fontWeight: 600, borderRadius: radii.sm,
                background: format === f ? colors.primary : colors.surfaceAlt,
                color: format === f ? "#fff" : colors.textDim,
                border: format === f ? `1px solid ${colors.primary}` : `1px solid ${colors.border}`,
                cursor: "pointer", fontFamily: fonts.mono, textTransform: "uppercase",
              }}>{f}</button>
            ))}
            <div style={{ flex: 1 }} />
            <button onClick={handleReset} style={{
              padding: "4px 12px", fontSize: 11, fontWeight: 600, borderRadius: radii.sm,
              background: colors.surfaceAlt, border: `1px solid ${colors.border}`,
              color: colors.textMuted, cursor: "pointer", fontFamily: fonts.sans,
            }}>{t.labReset}</button>
          </div>

          <button
            onClick={() => void handleProcess()}
            disabled={!sourceFile || isProcessing}
            style={{
              width: "100%", padding: "14px 0", borderRadius: radii.lg, marginTop: 16,
              background: sourceFile && !isProcessing ? "linear-gradient(135deg, #10b981, #059669)" : colors.textDark,
              border: "none", color: "#fff", fontSize: 14, fontWeight: 700,
              cursor: sourceFile && !isProcessing ? "pointer" : "default",
              fontFamily: fonts.sans, opacity: sourceFile && !isProcessing ? 1 : 0.4,
              boxShadow: sourceFile && !isProcessing ? "0 4px 24px rgba(16,185,129,0.35)" : "none",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}
          >
            <Icons.Waveform />
            {isProcessing ? t.labProcessing : t.labProcess}
          </button>
        </div>

        {/* Player */}
        {player.url && (
          <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radii.xl, padding: 20, backdropFilter: "blur(12px)" }}>
            <audio ref={player.audioRef} src={player.url} onPlay={() => player.setIsPlaying(true)} onPause={() => player.setIsPlaying(false)} onEnded={() => player.setIsPlaying(false)} style={{ display: "none" }} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button onClick={player.toggle} aria-label={player.isPlaying ? t.pause : t.play} style={{
                  width: 42, height: 42, borderRadius: "50%",
                  background: player.isPlaying ? colors.accent : "#10b981",
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
                <span style={{ fontSize: 9, fontWeight: 700, fontFamily: fonts.mono, padding: "2px 6px", borderRadius: 4, background: "rgba(16,185,129,0.2)", color: "#34d399", textTransform: "uppercase" }}>LAB</span>
              </div>
              <button onClick={handleDownload} style={{
                display: "flex", alignItems: "center", gap: 6, padding: "10px 18px",
                borderRadius: radii.md, background: "rgba(59,130,246,0.15)",
                border: `1px solid ${colors.primaryBorder}`, color: colors.primaryLight,
                cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: fonts.sans,
              }}><Icons.Download /> {t.download} .{format}</button>
            </div>
          </div>
        )}
      </div>

      {/* Right: presets */}
      <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radii.xl, padding: 24, backdropFilter: "blur(12px)", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{t.labPresets}</h3>
          <button
            onClick={() => void handleRandom()}
            style={{
              padding: "6px 14px", borderRadius: radii.sm, fontSize: 12, fontWeight: 600,
              background: "linear-gradient(135deg, #f59e0b, #d97706)", border: "none",
              color: "#fff", cursor: "pointer", fontFamily: fonts.sans,
              display: "flex", alignItems: "center", gap: 4,
              boxShadow: "0 2px 12px rgba(245,158,11,0.3)",
            }}
          >
            {t.labRandom}
          </button>
        </div>

        {/* Category filter */}
        <div style={{ display: "flex", gap: 6 }}>
          {[
            { id: "all", label: t.labPresets },
            { id: "narrator", label: t.labNarrators },
            { id: "character", label: t.labCharacters },
            { id: "effect", label: t.labEffects },
          ].map((cat) => (
            <button
              key={cat.id}
              onClick={() => setPresetFilter(cat.id)}
              style={{
                flex: 1, padding: "5px 0", fontSize: 10, fontWeight: 600,
                borderRadius: radii.sm,
                background: presetFilter === cat.id ? colors.primary : colors.surfaceAlt,
                color: presetFilter === cat.id ? "#fff" : colors.textDim,
                border: "none", cursor: "pointer", fontFamily: fonts.sans,
              }}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Preset cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", flex: 1 }}>
          {filteredPresets.map((preset) => {
            const isActive = activePreset === preset.name;
            const catColor = preset.category === "narrator" ? "#3b82f6" : preset.category === "character" ? "#f59e0b" : "#8b5cf6";
            return (
              <button
                key={preset.name}
                onClick={() => applyPreset(preset)}
                style={{
                  textAlign: "left", padding: "12px 14px", borderRadius: radii.md,
                  background: isActive ? "rgba(16,185,129,0.1)" : colors.surfaceSubtle,
                  border: isActive ? "1px solid rgba(16,185,129,0.3)" : `1px solid ${colors.borderFaint}`,
                  cursor: "pointer", transition: "all 0.15s",
                  fontFamily: fonts.sans, color: colors.text,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{preset.name}</span>
                  <span style={{
                    fontSize: 8, fontWeight: 700, padding: "2px 6px", borderRadius: 3,
                    background: `${catColor}22`, color: catColor,
                    textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: fonts.mono,
                  }}>
                    {preset.category}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: 11, color: colors.textDim, lineHeight: 1.4 }}>
                  {preset.description}
                </p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
