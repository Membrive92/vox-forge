import { useEffect, useRef, useState } from "react";

import { isAbortError } from "@/api/client";
import { listPresets, processAudio, randomPreset, type Preset, type VoiceLabParams } from "@/api/voiceLab";
import { AudioRecorder } from "@/components/AudioRecorder";
import { Button } from "@/components/Button";
import { PromptDialog } from "@/components/PromptDialog";
import { Slider } from "@/components/Slider";
import { logger } from "@/logging/logger";
import * as Icons from "@/components/icons";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { useCustomLabPresets } from "@/hooks/useCustomLabPresets";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, typography } from "@/theme/tokens";

interface LabTabProps {
  t: Translations;
  onToast: (msg: string) => void;
}

const DEFAULT_PARAMS: VoiceLabParams = {
  noise_reduction: 0,
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
  const [serverPresets, setServerPresets] = useState<Preset[]>([]);
  const custom = useCustomLabPresets();
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [presetFilter, setPresetFilter] = useState<string>("all");
  const [isProcessing, setIsProcessing] = useState(false);
  const [format, setFormat] = useState("mp3");
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const player = useAudioPlayer();

  useEffect(() => {
    listPresets().then(setServerPresets).catch(() => {});
  }, []);

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  const presets: Preset[] = [...serverPresets, ...custom.presets];

  const handleSaveCustom = (): void => {
    setSavePresetOpen(true);
  };

  const handleSavePresetConfirm = (name: string, description: string): void => {
    custom.save(name, description, params);
    setActivePreset(name);
    setSavePresetOpen(false);
    onToast(`Preset saved: ${name}`);
  };

  const handleDeleteCustom = (e: React.MouseEvent, name: string): void => {
    e.stopPropagation();
    if (!window.confirm(`Delete preset "${name}"?`)) return;
    custom.remove(name);
    if (activePreset === name) setActivePreset(null);
  };

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
    logger.info("Lab processing started", { preset: activePreset, format, params });
    const controller = new AbortController();
    abortRef.current = controller;
    setIsProcessing(true);
    try {
      const result = await processAudio(sourceFile, params, format, controller.signal);
      player.load(result.blob, result.duration);
      onToast(t.labReady);
    } catch (e) {
      if (isAbortError(e)) {
        onToast(t.processingCancelled);
      } else {
        onToast(`Error: ${e instanceof Error ? e.message : t.unknownError}`);
      }
    } finally {
      setIsProcessing(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const handleCancelProcess = (): void => {
    abortRef.current?.abort();
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
    <div className="vf-grid-editor-sidebar-wide">
      {/* Left: source + sliders + result */}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Source upload */}
        <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radii.xl, padding: 24, backdropFilter: "blur(12px)" }}>
          <h3 style={{ margin: "0 0 4px", fontSize: typography.size.lg, fontWeight: 700 }}>{t.labTitle}</h3>
          <p style={{ margin: "0 0 16px", fontSize: typography.size.sm, color: colors.textDim }}>{t.labDesc}</p>

          <AudioRecorder
            onRecorded={setSourceFile}
            labelRecord={t.recordVoice}
            labelStop={t.stopRecording}
            labelRecording={t.recording}
          />

          <div style={{ textAlign: "center", fontSize: typography.size.xs, color: colors.textDim, margin: "8px 0" }}>
            {t.or}
          </div>

          <input ref={sourceInputRef} type="file" accept=".wav,.mp3,.ogg,.flac" style={{ display: "none" }} onChange={(e) => setSourceFile(e.target.files?.[0] ?? null)} />
          <button
            onClick={() => sourceInputRef.current?.click()}
            style={{
              width: "100%", padding: "16px 0", borderRadius: radii.lg,
              background: sourceFile ? colors.primarySoft : colors.surfaceAlt,
              border: sourceFile ? `1px solid ${colors.primaryBorder}` : `2px dashed ${colors.border}`,
              color: sourceFile ? colors.primaryLight : colors.textMuted,
              cursor: "pointer", fontSize: typography.size.sm, fontWeight: 600, fontFamily: fonts.sans,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}
          >
            <Icons.Upload />
            {sourceFile ? sourceFile.name : t.labSourceAudio}
          </button>
        </div>

        {/* Sliders */}
        <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radii.xl, padding: 24, backdropFilter: "blur(12px)" }}>
          <Slider label={t.labNoiseReduction} value={params.noise_reduction} onChange={(v) => setParam("noise_reduction", v)} min={0} max={100} unit="%" info={t.infoNoiseReduction} />
          <Slider label={t.labPitch} value={params.pitch_semitones} onChange={(v) => setParam("pitch_semitones", v)} min={-12} max={12} step={0.5} unit="st" info={t.infoPitch} />
          <Slider label={t.labFormant} value={params.formant_shift} onChange={(v) => setParam("formant_shift", v)} min={-6} max={6} step={0.5} unit="st" info={t.infoFormant} />
          <Slider label={t.labBass} value={params.bass_boost_db} onChange={(v) => setParam("bass_boost_db", v)} min={-6} max={12} step={0.5} unit="dB" info={t.infoBass} />
          <Slider label={t.labWarmth} value={params.warmth_db} onChange={(v) => setParam("warmth_db", v)} min={-3} max={6} step={0.5} unit="dB" info={t.infoWarmth} />
          <Slider label={t.labCompression} value={params.compression} onChange={(v) => setParam("compression", v)} min={0} max={100} unit="%" info={t.infoCompression} />
          <Slider label={t.labReverb} value={params.reverb} onChange={(v) => setParam("reverb", v)} min={0} max={100} unit="%" info={t.infoReverb} />
          <Slider label={t.labSpeed} value={params.speed} onChange={(v) => setParam("speed", v)} min={0.5} max={2.0} step={0.05} unit="x" info={t.infoSpeed} />

          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            {/* Format selector */}
            {["mp3", "wav"].map((f) => (
              <button key={f} onClick={() => setFormat(f)} style={{
                padding: "4px 12px", fontSize: typography.size.xs, fontWeight: 600, borderRadius: radii.sm,
                background: format === f ? colors.primary : colors.surfaceAlt,
                color: format === f ? "#fff" : colors.textDim,
                border: format === f ? `1px solid ${colors.primary}` : `1px solid ${colors.border}`,
                cursor: "pointer", fontFamily: fonts.mono, textTransform: "uppercase",
              }}>{f}</button>
            ))}
            <div style={{ flex: 1 }} />
            <button onClick={handleReset} style={{
              padding: "4px 12px", fontSize: typography.size.xs, fontWeight: 600, borderRadius: radii.sm,
              background: colors.surfaceAlt, border: `1px solid ${colors.border}`,
              color: colors.textMuted, cursor: "pointer", fontFamily: fonts.sans,
            }}>{t.labReset}</button>
          </div>

          <div style={{ marginTop: 16 }}>
            {isProcessing ? (
              <Button variant="danger" size="lg" fullWidth onClick={handleCancelProcess}>
                {t.cancel}
              </Button>
            ) : (
              <Button
                variant="success"
                size="lg"
                icon={<Icons.Waveform />}
                disabled={!sourceFile}
                fullWidth
                onClick={() => void handleProcess()}
              >
                {t.labProcess}
              </Button>
            )}
          </div>
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
                  <span style={{ fontSize: typography.size.xs, color: colors.textDim, fontFamily: fonts.mono }}>{player.duration.toFixed(1)}s</span>
                )}
                <span style={{ fontSize: 9, fontWeight: 700, fontFamily: fonts.mono, padding: "2px 6px", borderRadius: 4, background: "rgba(16,185,129,0.2)", color: "#34d399", textTransform: "uppercase" }}>LAB</span>
              </div>
              <button onClick={handleDownload} style={{
                display: "flex", alignItems: "center", gap: 6, padding: "10px 18px",
                borderRadius: radii.md, background: "rgba(59,130,246,0.15)",
                border: `1px solid ${colors.primaryBorder}`, color: colors.primaryLight,
                cursor: "pointer", fontSize: typography.size.sm, fontWeight: 600, fontFamily: fonts.sans,
              }}><Icons.Download /> {t.download} .{format}</button>
            </div>
          </div>
        )}
      </div>

      {/* Right: presets */}
      <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radii.xl, padding: 24, backdropFilter: "blur(12px)", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: typography.size.lg, fontWeight: 700 }}>{t.labPresets}</h3>
          <div style={{ display: "flex", gap: 6 }}>
            <Button
              variant="success"
              size="sm"
              onClick={handleSaveCustom}
              title="Save current settings as preset"
            >
              + Save
            </Button>
            <Button
              variant="warning"
              size="sm"
              onClick={() => void handleRandom()}
            >
              {t.labRandom}
            </Button>
          </div>
        </div>

        {/* Category filter */}
        <div style={{ display: "flex", gap: 6 }}>
          {[
            { id: "all", label: t.labPresets },
            { id: "narrator", label: t.labNarrators },
            { id: "character", label: t.labCharacters },
            { id: "effect", label: t.labEffects },
            { id: "custom", label: "Custom" },
          ].map((cat) => (
            <button
              key={cat.id}
              onClick={() => setPresetFilter(cat.id)}
              style={{
                flex: 1, padding: "5px 0", fontSize: typography.size.xs, fontWeight: 600,
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
            const catColor =
              preset.category === "narrator" ? "#3b82f6"
              : preset.category === "character" ? "#f59e0b"
              : preset.category === "custom" ? "#10b981"
              : "#8b5cf6";
            const isCustom = preset.category === "custom";
            return (
              <div
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
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, gap: 8 }}>
                  <span style={{ fontSize: typography.size.sm, fontWeight: 600 }}>{preset.name}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{
                      fontSize: 8, fontWeight: 700, padding: "2px 6px", borderRadius: 3,
                      background: `${catColor}22`, color: catColor,
                      textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: fonts.mono,
                    }}>
                      {preset.category}
                    </span>
                    {isCustom && (
                      <button
                        onClick={(e) => handleDeleteCustom(e, preset.name)}
                        aria-label={`Delete ${preset.name}`}
                        style={{
                          background: "none",
                          border: "none",
                          color: colors.textFaint,
                          cursor: "pointer",
                          fontSize: typography.size.base,
                          lineHeight: 1,
                          padding: 2,
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
                <p style={{ margin: 0, fontSize: typography.size.xs, color: colors.textDim, lineHeight: 1.4 }}>
                  {preset.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      <PromptDialog
        open={savePresetOpen}
        title={t.labSavePresetTitle}
        label={t.labPresetName}
        secondaryLabel={t.labPresetDescription}
        confirmText={t.saveProfile}
        cancelText={t.cancel}
        onConfirm={handleSavePresetConfirm}
        onCancel={() => setSavePresetOpen(false)}
      />
    </div>
  );
}
