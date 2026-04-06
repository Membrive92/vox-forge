import { Slider } from "@/components/Slider";
import { WaveformVisualizer } from "@/components/WaveformVisualizer";
import * as Icons from "@/components/icons";
import { FORMATS, VOICES } from "@/constants/voices";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { useSynthesis } from "@/hooks/useSynthesis";
import type { Translations } from "@/i18n";
import { colors, fonts, radii } from "@/theme/tokens";

import type { SynthSettings } from "../state";

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${String(secs).padStart(2, "0")}s`;
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

  const voiceList = VOICES[settings.lang];

  const isLongText = text.length > 3000;
  const steps = isLongText
    ? [t.processing, t.synthesizingChunks, t.concatenating, t.finalizing] as const
    : [t.processing, t.analyzingVoice, t.applyingEffects, t.finalizing] as const;

  const handleGenerate = async (): Promise<void> => {
    await synthesis.run({
      params: {
        text,
        voiceId: settings.selectedVoice,
        format: settings.format,
        speed: settings.speed,
        pitch: settings.pitch,
        volume: settings.volume,
      },
      steps,
      onSuccess: (blob, duration) => {
        player.load(blob, duration);
        onToast(t.audioReady);
      },
      onError: (msg) => onToast(`Error: ${msg}`),
    });
  };

  const handleDownload = (): void => {
    if (!player.url) return;
    const a = document.createElement("a");
    a.href = player.url;
    a.download = `voxforge_output.${settings.format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const canGenerate = !synthesis.isGenerating && text.trim().length > 0;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 24 }}>
      {/* Left: text + waveform */}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
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
              minHeight: 220,
              padding: 20,
              resize: "vertical",
              background: "none",
              border: "none",
              color: colors.text,
              fontSize: 15,
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
            <span style={{ fontSize: 11, color: colors.textFaint, fontFamily: fonts.mono }}>
              {text.length} {t.charCount}
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
                      fontSize: 10,
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
          <PlayerControls
            t={t}
            player={player}
            synthesisDone={synthesis.isGenerated}
            format={settings.format}
            onDownload={handleDownload}
          />
          {synthesis.isGenerating ? (
            <ProgressBar
              step={synthesis.stepLabel}
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
              fontSize: 11,
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
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {voiceList.map((v) => {
              const active = settings.selectedVoice === v.id;
              return (
                <button
                  key={v.id}
                  onClick={() => settings.setSelectedVoice(v.id)}
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
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{v.name}</span>
                  </div>
                  <span style={{ fontSize: 10, color: colors.textDim, fontFamily: fonts.mono }}>
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

        <button
          onClick={() => void handleGenerate()}
          disabled={!canGenerate}
          style={{
            width: "100%",
            padding: "14px 0",
            borderRadius: radii.lg,
            background: canGenerate
              ? `linear-gradient(135deg, ${colors.primary}, ${colors.primaryDim})`
              : colors.textDark,
            border: "none",
            color: "#fff",
            fontSize: 14,
            fontWeight: 700,
            cursor: canGenerate ? "pointer" : "default",
            fontFamily: fonts.sans,
            letterSpacing: "0.3px",
            opacity: canGenerate ? 1 : 0.4,
            boxShadow: canGenerate ? "0 4px 24px rgba(59,130,246,0.35)" : "none",
            transition: "all 0.2s",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          <Icons.Waveform />
          {synthesis.isGenerating ? t.generating : t.generate}
        </button>
      </div>
    </div>
  );
}

interface PlayerControlsProps {
  t: Translations;
  player: ReturnType<typeof useAudioPlayer>;
  synthesisDone: boolean;
  format: string;
  onDownload: () => void;
}

function PlayerControls({ t, player, synthesisDone, format, onDownload }: PlayerControlsProps) {
  const ready = synthesisDone && player.url !== null;
  const playColor = player.isPlaying ? colors.accent : colors.primary;
  return (
    <div
      style={{
        marginTop: 16,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          onClick={player.toggle}
          disabled={!ready}
          aria-label={player.isPlaying ? t.pause : t.play}
          style={{
            width: 42,
            height: 42,
            borderRadius: "50%",
            background: ready ? playColor : colors.textDark,
            border: "none",
            color: "#fff",
            cursor: ready ? "pointer" : "default",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: ready ? 1 : 0.3,
            boxShadow: ready
              ? `0 4px 16px ${player.isPlaying ? colors.accentGlow : colors.primaryGlow}`
              : "none",
            transition: "all 0.2s",
          }}
        >
          {player.isPlaying ? <Icons.Pause /> : <Icons.Play />}
        </button>
        {player.duration > 0 && (
          <span style={{ fontSize: 11, color: colors.textDim, fontFamily: fonts.mono, marginLeft: 4 }}>
            {formatDuration(player.duration)}
          </span>
        )}
        <button
          onClick={player.stop}
          disabled={!player.isPlaying}
          aria-label={t.stop}
          style={{
            width: 42,
            height: 42,
            borderRadius: "50%",
            background: colors.textDark,
            border: `1px solid ${colors.border}`,
            color: colors.textMuted,
            cursor: player.isPlaying ? "pointer" : "default",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: player.isPlaying ? 1 : 0.3,
            transition: "all 0.2s",
          }}
        >
          <Icons.Stop />
        </button>
      </div>

      <button
        onClick={onDownload}
        disabled={!ready}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "10px 18px",
          borderRadius: radii.md,
          background: ready ? "rgba(59,130,246,0.15)" : colors.textDark,
          border: ready
            ? `1px solid ${colors.primaryBorder}`
            : `1px solid ${colors.border}`,
          color: ready ? colors.primaryLight : colors.textFaint,
          cursor: ready ? "pointer" : "default",
          fontSize: 13,
          fontWeight: 600,
          fontFamily: fonts.sans,
          transition: "all 0.2s",
        }}
      >
        <Icons.Download /> {t.download} .{format}
      </button>
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
        <span style={{ fontSize: 12, color: colors.primaryLight }}>{step}</span>
        <span style={{ fontSize: 11, color: colors.textDim, fontFamily: fonts.mono }}>
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
