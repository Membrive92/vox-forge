import { useEffect, useRef, useState } from "react";

import { preprocessFile } from "@/api/preprocess";
import {
  discardJob,
  listIncompleteJobs,
  resumeJob,
  type IncompleteJobDTO,
} from "@/api/synthesis";
import { Button } from "@/components/Button";
import { InteractivePlayer } from "@/components/InteractivePlayer";
import { Slider } from "@/components/Slider";
import { logger } from "@/logging/logger";
import { WaveformVisualizer } from "@/components/WaveformVisualizer";
import * as Icons from "@/components/icons";
import { FORMATS, VOICES } from "@/constants/voices";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { useExportSettings } from "@/hooks/useExportSettings";
import { useSynthesis } from "@/hooks/useSynthesis";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, typography } from "@/theme/tokens";

import type { SynthSettings } from "../state";

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${String(secs).padStart(2, "0")}s`;
}

// Spanish narration averages ~15 chars/second; speed multiplier accounts for
// the user's setting (100% = 1.0x). Result: good-enough preview, not exact.
function estimateSpokenSeconds(text: string, speedPct: number): number {
  if (!text.trim()) return 0;
  const charsPerSecond = 15 * (speedPct / 100);
  return text.length / charsPerSecond;
}

interface SynthTabProps {
  t: Translations;
  text: string;
  setText: (v: string) => void;
  settings: SynthSettings;
  onToast: (msg: string) => void;
}

export function SynthTab({ t, text, setText, settings, onToast }: SynthTabProps) {
  const player = useAudioPlayer();
  const synthesis = useSynthesis();
  const exportCfg = useExportSettings();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [incomplete, setIncomplete] = useState<IncompleteJobDTO[]>([]);
  const [resuming, setResuming] = useState<string | null>(null);

  const refreshIncomplete = async (): Promise<void> => {
    try {
      const data = await listIncompleteJobs();
      setIncomplete(data.jobs);
    } catch {
      // Harmless — just means the list is stale until next load
    }
  };

  useEffect(() => {
    void refreshIncomplete();
  }, []);

  const handleResume = async (jobId: string): Promise<void> => {
    setResuming(jobId);
    try {
      const result = await resumeJob(jobId);
      player.load(result.blob, result.duration);
      onToast(`${t.audioReady} (resumed)`);
      await refreshIncomplete();
    } catch (e) {
      onToast(`Error: ${e instanceof Error ? e.message : "Unknown"}`);
    } finally {
      setResuming(null);
    }
  };

  const handleDiscard = async (jobId: string): Promise<void> => {
    if (!window.confirm("Discard this interrupted job?")) return;
    try {
      await discardJob(jobId);
      await refreshIncomplete();
    } catch (e) {
      onToast(`Error: ${e instanceof Error ? e.message : "Unknown"}`);
    }
  };

  const voiceList = VOICES[settings.lang];

  const handleUploadFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    logger.info("File upload started", { name: file.name, sizeKb: Math.round(file.size / 1024) });
    setIsUploading(true);
    try {
      const result = await preprocessFile(file);
      setText(result.text);
      onToast(`${t.textProcessed} (${result.original_length} → ${result.processed_length} chars)`);
    } catch (e) {
      onToast(`Error: ${e instanceof Error ? e.message : "Unknown"}`);
    } finally {
      setIsUploading(false);
    }
  };

  const isLongText = text.length > 3000;
  const steps = isLongText
    ? [t.processing, t.synthesizingChunks, t.concatenating, t.finalizing] as const
    : [t.processing, t.analyzingVoice, t.applyingEffects, t.finalizing] as const;

  const handleGenerate = async (): Promise<void> => {
    logger.info("Synthesis started", {
      textLength: text.length, voice: settings.selectedVoice,
      format: settings.format, speed: settings.speed, profileId: settings.activeProfileId,
    });
    await synthesis.run({
      params: {
        text,
        voiceId: settings.selectedVoice,
        format: settings.format,
        speed: settings.speed,
        pitch: settings.pitch,
        volume: settings.volume,
        profileId: settings.activeProfileId ?? undefined,
        title: exportCfg.settings.storyTitle || undefined,
        artist: exportCfg.settings.artist || undefined,
        album: exportCfg.settings.album || undefined,
        trackNumber: exportCfg.settings.trackNumber || undefined,
      },
      steps,
      onSuccess: (blob, duration, engine) => {
        player.load(blob, duration);
        const engineLabel = engine === "xtts-v2" ? t.engineXttsV2 : t.engineEdgeTts;
        onToast(`${t.audioReady} — ${engineLabel}`);
      },
      onError: (msg) => onToast(`Error: ${msg}`),
    });
  };

  const handleDownload = (): void => {
    if (!player.url) return;
    const a = document.createElement("a");
    a.href = player.url;
    a.download = exportCfg.renderFilename(settings.format);
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const canGenerate = !synthesis.isGenerating && text.trim().length > 0;

  // Keyboard shortcuts: Ctrl+Enter generate, Ctrl+S download, Space play/pause.
  // Space is ignored while typing in any editable element so we don't fight the caret.
  useEffect(() => {
    const isEditable = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    };

    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.key === "Enter") {
        if (canGenerate) {
          e.preventDefault();
          void handleGenerate();
        }
        return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === "s") {
        if (player.url) {
          e.preventDefault();
          handleDownload();
        }
        return;
      }
      if (e.code === "Space" && !isEditable(e.target)) {
        if (player.url) {
          e.preventDefault();
          player.toggle();
        }
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canGenerate, player.url]);

  return (
    <div className="vf-grid-editor-sidebar">
      {/* Left: text + waveform */}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {incomplete.length > 0 && (
          <IncompleteJobsBanner
            jobs={incomplete}
            resumingId={resuming}
            onResume={(id) => void handleResume(id)}
            onDiscard={(id) => void handleDiscard(id)}
          />
        )}
        <div
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: radii.xl,
            overflow: "hidden",
            backdropFilter: "blur(12px)",
          }}
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t.textPlaceholder}
            style={{
              width: "100%",
              minHeight: 450,
              padding: 20,
              resize: "vertical",
              background: "none",
              border: "none",
              color: colors.text,
              fontSize: typography.size.base,
              lineHeight: 1.7,
              fontFamily: fonts.sans,
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          <div
            style={{
              padding: "10px 20px",
              borderTop: `1px solid ${colors.borderFaint}`,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: typography.size.xs, color: colors.textFaint, fontFamily: fonts.mono }}>
              {text.length} {t.charCount}
              {text.length > 0 && (
                <span style={{ marginLeft: 8, color: colors.textDim, fontFamily: fonts.sans }}>
                  · {t.estimatedDuration.replace(
                    "{dur}",
                    formatDuration(estimateSpokenSeconds(text, settings.speed)),
                  )}
                </span>
              )}
              {isLongText && (
                <span style={{ marginLeft: 8, color: colors.primaryLight, fontFamily: fonts.sans }}>
                  — {t.longTextHint}
                </span>
              )}
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              {FORMATS.map((f) => {
                const active = settings.format === f.id;
                return (
                  <button
                    key={f.id}
                    onClick={() => settings.setFormat(f.id)}
                    title={f.desc}
                    style={{
                      padding: "4px 10px",
                      fontSize: typography.size.xs,
                      fontWeight: 600,
                      background: active ? colors.primary : colors.surfaceAlt,
                      color: active ? "#fff" : colors.textDim,
                      border: active
                        ? `1px solid ${colors.primary}`
                        : `1px solid ${colors.border}`,
                      borderRadius: radii.sm,
                      cursor: "pointer",
                      fontFamily: fonts.mono,
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                      transition: "all 0.2s",
                    }}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: radii.xl,
            padding: 20,
            backdropFilter: "blur(12px)",
          }}
        >
          <WaveformVisualizer
            isPlaying={player.isPlaying}
            isGenerated={synthesis.isGenerated}
          />
          <audio
            ref={player.audioRef}
            src={player.url ?? undefined}
            onPlay={() => player.setIsPlaying(true)}
            onPause={() => player.setIsPlaying(false)}
            onEnded={() => player.setIsPlaying(false)}
            style={{ display: "none" }}
          />
          <InteractivePlayer
            player={player}
            disabled={!synthesis.isGenerated}
            playLabel={t.play}
            pauseLabel={t.pause}
            stopLabel={t.stop}
          />
          {synthesis.isGenerated && player.url && (
            <div
              style={{
                marginTop: 12,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              {synthesis.lastEngine && (
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    fontFamily: fonts.mono,
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: synthesis.lastEngine === "xtts-v2" ? colors.accentGlow : colors.primarySoft,
                    color: synthesis.lastEngine === "xtts-v2" ? colors.accent : colors.primaryLight,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}
                >
                  {synthesis.lastEngine === "xtts-v2" ? "CLONED" : "EDGE-TTS"}
                </span>
              )}
              <button
                onClick={handleDownload}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "10px 18px",
                  borderRadius: radii.md,
                  background: "rgba(59,130,246,0.15)",
                  border: `1px solid ${colors.primaryBorder}`,
                  color: colors.primaryLight,
                  cursor: "pointer",
                  fontSize: typography.size.sm,
                  fontWeight: 600,
                  fontFamily: fonts.sans,
                  marginLeft: "auto",
                }}
              >
                <Icons.Download /> {t.download} .{settings.format}
              </button>
            </div>
          )}
          {synthesis.isGenerating ? (
            <ProgressBar
              step={
                synthesis.chunksTotal > 0
                  ? `${synthesis.stepLabel} — ${synthesis.chunksDone}/${synthesis.chunksTotal}`
                  : synthesis.stepLabel
              }
              progress={synthesis.progress}
            />
          ) : null}
        </div>
      </div>

      {/* Right: controls */}
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: radii.xl,
          padding: 20,
          backdropFilter: "blur(12px)",
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        <div>
          <label
            style={{
              fontSize: typography.size.xs,
              color: colors.textDim,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "1.5px",
              marginBottom: 8,
              display: "block",
            }}
          >
            {t.voice}
          </label>
          {settings.activeProfileId && (
            <div
              style={{
                marginBottom: 8,
                padding: "6px 10px",
                borderRadius: radii.sm,
                background: colors.accentGlow,
                border: `1px solid ${colors.accent}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: typography.size.xs,
                fontWeight: 600,
                color: colors.accent,
              }}
            >
              <span>{t.engineXttsV2}</span>
              <button
                onClick={() => settings.setActiveProfileId(null)}
                style={{
                  background: "none",
                  border: "none",
                  color: colors.accent,
                  cursor: "pointer",
                  fontSize: typography.size.xs,
                  fontFamily: fonts.sans,
                  textDecoration: "underline",
                }}
              >
                {t.cancel}
              </button>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {voiceList.map((v) => {
              const active = settings.selectedVoice === v.id;
              return (
                <button
                  key={v.id}
                  onClick={() => { settings.setSelectedVoice(v.id); settings.setActiveProfileId(null); }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 14px",
                    borderRadius: radii.md,
                    background: active ? colors.primarySoft : colors.surfaceSubtle,
                    border: active
                      ? `1px solid ${colors.primaryBorder}`
                      : `1px solid ${colors.borderFaint}`,
                    cursor: "pointer",
                    transition: "all 0.15s",
                    color: colors.text,
                    fontFamily: fonts.sans,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: v.gender === "F" ? colors.female : colors.primaryLight,
                      }}
                    />
                    <span style={{ fontSize: typography.size.sm, fontWeight: 500 }}>{v.name}</span>
                  </div>
                  <span style={{ fontSize: typography.size.xs, color: colors.textDim, fontFamily: fonts.mono }}>
                    {v.accent}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <Slider label={t.speed} value={settings.speed} onChange={settings.setSpeed} min={50} max={200} unit="%" />
          <Slider label={t.pitch} value={settings.pitch} onChange={settings.setPitch} min={-10} max={10} unit="st" />
          <Slider label={t.volume} value={settings.volume} onChange={settings.setVolume} min={0} max={100} unit="%" />
        </div>

        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.doc,.docx,.pdf"
            style={{ display: "none" }}
            onChange={(e) => void handleUploadFile(e.target.files?.[0])}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            title={t.uploadTextDesc}
            style={{
              width: "100%",
              padding: "10px 0",
              borderRadius: radii.lg,
              marginBottom: 8,
              background: colors.surfaceAlt,
              border: `1px solid ${colors.border}`,
              color: colors.textMuted,
              fontSize: typography.size.sm,
              fontWeight: 600,
              cursor: isUploading ? "default" : "pointer",
              fontFamily: fonts.sans,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              opacity: isUploading ? 0.5 : 1,
              transition: "all 0.2s",
            }}
          >
            <Icons.Upload />
            {isUploading ? "..." : t.uploadText}
          </button>
        </div>

        <ExportPanel
          open={showExport}
          onToggle={() => setShowExport((v) => !v)}
          settings={exportCfg.settings}
          update={exportCfg.update}
          previewName={exportCfg.renderFilename(settings.format)}
        />

        <Button
          variant="primary"
          size="lg"
          icon={<Icons.Waveform />}
          loading={synthesis.isGenerating}
          disabled={!canGenerate}
          fullWidth
          onClick={() => void handleGenerate()}
        >
          {synthesis.isGenerating ? t.generating : t.generate}
        </Button>

        <p
          style={{
            margin: "4px 0 0",
            fontSize: typography.size.xs,
            color: colors.textFaint,
            fontFamily: fonts.mono,
            textAlign: "center",
            lineHeight: 1.5,
          }}
        >
          {t.shortcutHint}
        </p>
      </div>
    </div>
  );
}

interface ExportPanelProps {
  open: boolean;
  onToggle: () => void;
  settings: import("@/types/domain").ExportSettings;
  update: (patch: Partial<import("@/types/domain").ExportSettings>) => void;
  previewName: string;
}

function ExportPanel({ open, onToggle, settings, update, previewName }: ExportPanelProps) {
  return (
    <div
      style={{
        borderTop: `1px solid ${colors.borderFaint}`,
        paddingTop: 12,
      }}
    >
      <button
        onClick={onToggle}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 0",
          background: "none",
          border: "none",
          color: colors.textDim,
          fontFamily: fonts.sans,
          fontSize: typography.size.xs,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "1.5px",
          cursor: "pointer",
        }}
      >
        <span>Export</span>
        <span style={{ fontSize: typography.size.base }}>{open ? "−" : "+"}</span>
      </button>

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
          <ExportField
            label="Title"
            value={settings.storyTitle}
            onChange={(v) => update({ storyTitle: v })}
            placeholder="The Tower of Kael"
          />
          <ExportField
            label="Artist"
            value={settings.artist}
            onChange={(v) => update({ artist: v })}
            placeholder="Narrator"
          />
          <ExportField
            label="Album"
            value={settings.album}
            onChange={(v) => update({ album: v })}
            placeholder="Chronicles Vol. 1"
          />
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: "0 0 70px" }}>
              <ExportField
                label="Track"
                type="number"
                value={String(settings.trackNumber)}
                onChange={(v) => update({ trackNumber: Math.max(1, Number(v) || 1) })}
              />
            </div>
            <div style={{ flex: 1 }}>
              <ExportField
                label="Filename"
                value={settings.filenamePattern}
                onChange={(v) => update({ filenamePattern: v })}
                placeholder="{story}_{track}_{date}.{fmt}"
              />
            </div>
          </div>
          <p
            style={{
              margin: 0,
              fontSize: typography.size.xs,
              color: colors.textFaint,
              fontFamily: fonts.mono,
              wordBreak: "break-all",
            }}
          >
            → {previewName}
          </p>
        </div>
      )}
    </div>
  );
}

interface ExportFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}

function ExportField({ label, value, onChange, placeholder, type = "text" }: ExportFieldProps) {
  return (
    <label style={{ display: "block" }}>
      <span
        style={{
          fontSize: 9,
          color: colors.textFaint,
          fontFamily: fonts.mono,
          textTransform: "uppercase",
          letterSpacing: "1px",
          display: "block",
          marginBottom: 3,
        }}
      >
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: "100%",
          padding: "6px 8px",
          background: colors.surfaceAlt,
          border: `1px solid ${colors.borderFaint}`,
          borderRadius: radii.sm,
          color: colors.text,
          fontSize: typography.size.sm,
          fontFamily: fonts.sans,
          outline: "none",
          boxSizing: "border-box",
        }}
      />
    </label>
  );
}

interface IncompleteJobsBannerProps {
  jobs: IncompleteJobDTO[];
  resumingId: string | null;
  onResume: (jobId: string) => void;
  onDiscard: (jobId: string) => void;
}

function IncompleteJobsBanner({ jobs, resumingId, onResume, onDiscard }: IncompleteJobsBannerProps) {
  return (
    <div
      role="status"
      style={{
        background: "rgba(245,158,11,0.08)",
        border: "1px solid rgba(245,158,11,0.3)",
        borderRadius: radii.lg,
        padding: 16,
      }}
    >
      <div
        style={{
          fontSize: typography.size.xs,
          fontWeight: 700,
          color: "#f59e0b",
          textTransform: "uppercase",
          letterSpacing: "1.5px",
          marginBottom: 10,
        }}
      >
        ⚠ Interrupted jobs ({jobs.length})
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {jobs.map((job) => {
          const isResuming = resumingId === job.job_id;
          const date = new Date(job.updated_at * 1000).toLocaleString();
          return (
            <div
              key={job.job_id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 12px",
                background: colors.surfaceSubtle,
                borderRadius: radii.sm,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: typography.size.sm, fontWeight: 600, color: colors.text }}>
                  {job.title || "Untitled"}
                  <span style={{ marginLeft: 8, fontSize: typography.size.xs, color: colors.textDim, fontFamily: fonts.mono }}>
                    {job.chunks_available} chunks · {job.output_format} · {date}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: typography.size.xs,
                    color: colors.textDim,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    marginTop: 2,
                  }}
                >
                  {job.text_preview}
                </div>
              </div>
              <button
                onClick={() => onResume(job.job_id)}
                disabled={isResuming}
                style={{
                  padding: "6px 14px",
                  fontSize: typography.size.sm,
                  fontWeight: 600,
                  background: "#f59e0b",
                  color: "#000",
                  border: "none",
                  borderRadius: radii.sm,
                  cursor: isResuming ? "default" : "pointer",
                  fontFamily: fonts.sans,
                  opacity: isResuming ? 0.5 : 1,
                }}
              >
                {isResuming ? "..." : "Resume"}
              </button>
              <button
                onClick={() => onDiscard(job.job_id)}
                aria-label="Discard job"
                style={{
                  background: "none",
                  border: "none",
                  color: colors.textFaint,
                  cursor: "pointer",
                  fontSize: typography.size.lg,
                  padding: "0 6px",
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ProgressBarProps {
  step: string;
  progress: number;
}

function ProgressBar({ step, progress }: ProgressBarProps) {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: typography.size.sm, color: colors.primaryLight }}>{step}</span>
        <span style={{ fontSize: typography.size.xs, color: colors.textDim, fontFamily: fonts.mono }}>
          {Math.round(progress)}%
        </span>
      </div>
      <div style={{ height: 3, background: colors.textDark, borderRadius: 2, overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${progress}%`,
            background: `linear-gradient(90deg, ${colors.primary}, ${colors.primaryLight})`,
            borderRadius: 2,
            transition: "width 0.4s ease",
          }}
        />
      </div>
    </div>
  );
}
