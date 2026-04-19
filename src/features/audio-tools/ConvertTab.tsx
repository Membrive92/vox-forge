import { useRef, useState } from "react";

import { convertVoice } from "@/api/conversion";
import { Button } from "@/components/Button";
import { Slider } from "@/components/Slider";
import { logger } from "@/logging/logger";
import * as Icons from "@/components/icons";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, typography } from "@/theme/tokens";
import type { Profile } from "@/types/domain";

interface ConvertTabProps {
  t: Translations;
  profiles: readonly Profile[];
  onToast: (msg: string) => void;
}

export function ConvertTab({ t, profiles, onToast }: ConvertTabProps) {
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [targetMode, setTargetMode] = useState<"profile" | "file">("profile");
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [targetFile, setTargetFile] = useState<File | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [format, setFormat] = useState("mp3");
  const [pitchShift, setPitchShift] = useState(0);
  const [formantShift, setFormantShift] = useState(0);
  const [bassBoost, setBassBoost] = useState(0);
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const targetInputRef = useRef<HTMLInputElement>(null);
  const player = useAudioPlayer();

  const profilesWithSample = profiles.filter((p) => p.sampleName !== null);

  const canConvert =
    sourceFile !== null &&
    !isConverting &&
    (targetMode === "profile" ? selectedProfileId !== null : targetFile !== null);

  const handleConvert = async (): Promise<void> => {
    if (!sourceFile || !canConvert) return;
    logger.info("Voice conversion started", { targetMode, format, pitchShift, formantShift, bassBoost });
    setIsConverting(true);
    try {
      const result = await convertVoice(sourceFile, {
        profileId: targetMode === "profile" ? (selectedProfileId ?? undefined) : undefined,
        targetSample: targetMode === "file" ? (targetFile ?? undefined) : undefined,
        outputFormat: format,
        pitchShift,
        formantShift,
        bassBoostDb: bassBoost,
      });
      player.load(result.blob, result.duration);
      onToast(t.conversionReady);
    } catch (e) {
      onToast(`Error: ${e instanceof Error ? e.message : "Unknown"}`);
    } finally {
      setIsConverting(false);
    }
  };

  const handleDownload = (): void => {
    if (!player.url) return;
    const a = document.createElement("a");
    a.href = player.url;
    a.download = `voxforge_converted.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="vf-grid-2col">
      {/* Left: source + result */}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: radii.xl,
            padding: 24,
            backdropFilter: "blur(12px)",
          }}
        >
          <h3 style={{ margin: "0 0 4px", fontSize: typography.size.lg, fontWeight: 700 }}>
            {t.sourceAudio}
          </h3>
          <p style={{ margin: "0 0 16px", fontSize: typography.size.sm, color: colors.textDim }}>
            {t.sourceAudioHint}
          </p>

          <input
            ref={sourceInputRef}
            type="file"
            accept=".wav,.mp3,.ogg,.flac"
            style={{ display: "none" }}
            onChange={(e) => setSourceFile(e.target.files?.[0] ?? null)}
          />
          <button
            onClick={() => sourceInputRef.current?.click()}
            style={{
              width: "100%",
              padding: "20px 0",
              borderRadius: radii.lg,
              background: sourceFile ? colors.primarySoft : colors.surfaceAlt,
              border: sourceFile
                ? `1px solid ${colors.primaryBorder}`
                : `2px dashed ${colors.border}`,
              color: sourceFile ? colors.primaryLight : colors.textMuted,
              cursor: "pointer",
              fontSize: typography.size.sm,
              fontWeight: 600,
              fontFamily: fonts.sans,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              transition: "all 0.2s",
            }}
          >
            <Icons.Upload />
            {sourceFile ? sourceFile.name : t.sourceAudio}
          </button>
        </div>

        {/* Player (after conversion) */}
        {player.url && (
          <div
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: radii.xl,
              padding: 20,
              backdropFilter: "blur(12px)",
            }}
          >
            <audio
              ref={player.audioRef}
              src={player.url}
              onPlay={() => player.setIsPlaying(true)}
              onPause={() => player.setIsPlaying(false)}
              onEnded={() => player.setIsPlaying(false)}
              style={{ display: "none" }}
            />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  onClick={player.toggle}
                  aria-label={player.isPlaying ? t.pause : t.play}
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: "50%",
                    background: player.isPlaying ? colors.accent : colors.primary,
                    border: "none",
                    color: "#fff",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "all 0.2s",
                  }}
                >
                  {player.isPlaying ? <Icons.Pause /> : <Icons.Play />}
                </button>
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
                  }}
                >
                  <Icons.Stop />
                </button>
                {player.duration > 0 && (
                  <span style={{ fontSize: typography.size.xs, color: colors.textDim, fontFamily: fonts.mono }}>
                    {player.duration.toFixed(1)}s
                  </span>
                )}
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    fontFamily: fonts.mono,
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: "rgba(139,92,246,0.2)",
                    color: "#a78bfa",
                    textTransform: "uppercase",
                  }}
                >
                  OPENVOICE
                </span>
              </div>
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
                }}
              >
                <Icons.Download /> {t.download} .{format}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Right: target voice + convert button */}
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: radii.xl,
          padding: 24,
          backdropFilter: "blur(12px)",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <h3 style={{ margin: 0, fontSize: typography.size.lg, fontWeight: 700 }}>{t.targetVoice}</h3>
        <p style={{ margin: 0, fontSize: typography.size.sm, color: colors.textDim }}>{t.targetVoiceOption}</p>

        {/* Mode toggle */}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setTargetMode("profile")}
            style={{
              flex: 1,
              padding: "8px 0",
              borderRadius: radii.sm,
              fontSize: typography.size.sm,
              fontWeight: 600,
              background: targetMode === "profile" ? colors.primary : colors.surfaceAlt,
              color: targetMode === "profile" ? "#fff" : colors.textDim,
              border: "none",
              cursor: "pointer",
              fontFamily: fonts.sans,
            }}
          >
            {t.tabProfiles}
          </button>
          <button
            onClick={() => setTargetMode("file")}
            style={{
              flex: 1,
              padding: "8px 0",
              borderRadius: radii.sm,
              fontSize: typography.size.sm,
              fontWeight: 600,
              background: targetMode === "file" ? colors.primary : colors.surfaceAlt,
              color: targetMode === "file" ? "#fff" : colors.textDim,
              border: "none",
              cursor: "pointer",
              fontFamily: fonts.sans,
            }}
          >
            {t.useTargetFile}
          </button>
        </div>

        {/* Profile list */}
        {targetMode === "profile" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 300, overflowY: "auto" }}>
            {profilesWithSample.length === 0 ? (
              <p style={{ fontSize: typography.size.sm, color: colors.textDim, textAlign: "center", padding: 20 }}>
                {t.noProfiles}
              </p>
            ) : (
              profilesWithSample.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedProfileId(p.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 14px",
                    borderRadius: radii.md,
                    background: selectedProfileId === p.id ? colors.primarySoft : colors.surfaceSubtle,
                    border: selectedProfileId === p.id
                      ? `1px solid ${colors.primaryBorder}`
                      : `1px solid ${colors.borderFaint}`,
                    cursor: "pointer",
                    color: colors.text,
                    fontFamily: fonts.sans,
                    transition: "all 0.15s",
                  }}
                >
                  <span style={{ fontSize: typography.size.sm, fontWeight: 500 }}>{p.name}</span>
                  {selectedProfileId === p.id && <Icons.Check />}
                </button>
              ))
            )}
          </div>
        )}

        {/* Target file upload */}
        {targetMode === "file" && (
          <div>
            <input
              ref={targetInputRef}
              type="file"
              accept=".wav,.mp3,.ogg,.flac"
              style={{ display: "none" }}
              onChange={(e) => setTargetFile(e.target.files?.[0] ?? null)}
            />
            <button
              onClick={() => targetInputRef.current?.click()}
              style={{
                width: "100%",
                padding: "20px 0",
                borderRadius: radii.lg,
                background: targetFile ? colors.primarySoft : colors.surfaceAlt,
                border: targetFile
                  ? `1px solid ${colors.primaryBorder}`
                  : `2px dashed ${colors.border}`,
                color: targetFile ? colors.primaryLight : colors.textMuted,
                cursor: "pointer",
                fontSize: typography.size.sm,
                fontWeight: 600,
                fontFamily: fonts.sans,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              <Icons.Mic />
              {targetFile ? targetFile.name : t.useTargetFile}
            </button>
          </div>
        )}

        {/* Fine-tune output DSP */}
        <div style={{
          marginTop: 8, paddingTop: 16,
          borderTop: `1px solid ${colors.borderFaint}`,
        }}>
          <label style={{
            fontSize: typography.size.xs, color: colors.textDim, fontWeight: 600,
            textTransform: "uppercase", letterSpacing: "1.5px",
            marginBottom: 12, display: "block",
          }}>
            {t.convertFineTune}
          </label>
          <Slider
            label={t.convertPitch}
            value={pitchShift}
            onChange={setPitchShift}
            min={-12}
            max={12}
            step={0.5}
            unit="st"
            info={t.infoConvertPitch}
          />
          <Slider
            label={t.convertFormant}
            value={formantShift}
            onChange={setFormantShift}
            min={-6}
            max={6}
            step={0.5}
            unit="st"
            info={t.infoConvertFormant}
          />
          <Slider
            label={t.convertBass}
            value={bassBoost}
            onChange={setBassBoost}
            min={-6}
            max={12}
            step={0.5}
            unit="dB"
            info={t.infoConvertBass}
          />
        </div>

        {/* Format selector */}
        <div style={{ display: "flex", gap: 6 }}>
          {["mp3", "wav", "ogg", "flac"].map((f) => (
            <button
              key={f}
              onClick={() => setFormat(f)}
              style={{
                flex: 1,
                padding: "6px 0",
                fontSize: typography.size.xs,
                fontWeight: 600,
                background: format === f ? colors.primary : colors.surfaceAlt,
                color: format === f ? "#fff" : colors.textDim,
                border: format === f ? `1px solid ${colors.primary}` : `1px solid ${colors.border}`,
                borderRadius: radii.sm,
                cursor: "pointer",
                fontFamily: fonts.mono,
                textTransform: "uppercase",
              }}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Convert button */}
        <Button
          variant="primary"
          size="lg"
          icon={<Icons.Waveform />}
          loading={isConverting}
          disabled={!canConvert}
          fullWidth
          onClick={() => void handleConvert()}
        >
          {isConverting ? t.converting : t.convertButton}
        </Button>
      </div>
    </div>
  );
}
