import { useRef, useState } from "react";

import type { CoverUploadResult, VideoOptions } from "@/api/studio";
import { Button } from "@/components/Button";
import * as Icons from "@/components/icons";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, typography } from "@/theme/tokens";

interface Props {
  t: Translations;
  enabled: boolean;
  cover: CoverUploadResult | null;
  isUploadingCover: boolean;
  hasTranscript: boolean;
  isRendering: boolean;
  videoUrl: string | null;
  videoMeta: { durationS: number; sizeBytes: number; resolution: string } | null;
  onPickCover: (file: File) => void;
  onClearCover: () => void;
  onRender: (options: Partial<VideoOptions>) => void;
  onCancelRender: () => void;
  onDownloadVideo: () => void;
  onClearVideo: () => void;
}

export function VideoRenderPanel({
  t,
  enabled,
  cover,
  isUploadingCover,
  hasTranscript,
  isRendering,
  videoUrl,
  videoMeta,
  onPickCover,
  onClearCover,
  onRender,
  onCancelRender,
  onDownloadVideo,
  onClearVideo,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [resolution, setResolution] = useState<VideoOptions["resolution"]>("1920x1080");
  const [kenBurns, setKenBurns] = useState(true);
  const [waveform, setWaveform] = useState(true);
  const [titleText, setTitleText] = useState("");
  const [subsMode, setSubsMode] = useState<VideoOptions["subtitles_mode"]>(
    hasTranscript ? "burn" : "none",
  );

  // If the user removes the transcript, reset subs to none so we don't
  // send an invalid request.
  if (!hasTranscript && subsMode !== "none") {
    setSubsMode("none");
  }

  const handleFile = (file: File | undefined): void => {
    if (!file) return;
    onPickCover(file);
  };

  const canRender = enabled && cover !== null && !isRendering;

  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: radii.xl,
        padding: 16,
      }}
    >
      <h3 style={{ margin: 0, fontSize: typography.size.base, fontWeight: 700 }}>
        {t.studioVideoTitle}
      </h3>
      <p style={{ margin: "2px 0 12px", fontSize: typography.size.xs, color: colors.textDim }}>
        {t.studioVideoHint}
      </p>

      {/* Cover uploader */}
      <div style={{ marginBottom: 14 }}>
        <div
          style={{
            fontSize: typography.size.xs,
            color: colors.textDim,
            marginBottom: 6,
            fontWeight: typography.weight.semibold,
            textTransform: "uppercase",
            letterSpacing: "1px",
          }}
        >
          {t.studioVideoCover}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".png,.jpg,.jpeg,.webp"
          style={{ display: "none" }}
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        {cover ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 12px",
              background: colors.surfaceAlt,
              border: `1px solid ${colors.borderFaint}`,
              borderRadius: radii.md,
            }}
          >
            <Icons.Check />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p
                style={{
                  margin: 0,
                  fontSize: typography.size.sm,
                  fontWeight: 600,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {cover.filename}
              </p>
              <p
                style={{
                  margin: 0,
                  fontSize: typography.size.xs,
                  color: colors.textDim,
                  fontFamily: fonts.mono,
                }}
              >
                {cover.size_kb}KB · {cover.content_type}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              {t.studioVideoChangeCover}
            </Button>
            <Button variant="ghost" size="sm" onClick={onClearCover}>
              ×
            </Button>
          </div>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            loading={isUploadingCover}
            onClick={() => fileInputRef.current?.click()}
          >
            {isUploadingCover ? t.studioVideoUploadingCover : t.studioVideoUploadCover}
          </Button>
        )}
        {!cover && !isUploadingCover ? (
          <p style={{ margin: "6px 0 0", fontSize: typography.size.xs, color: colors.textFaint }}>
            {t.studioVideoNoCover}
          </p>
        ) : null}
      </div>

      {/* Options */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          marginBottom: 14,
        }}
      >
        <label style={{ fontSize: typography.size.xs, color: colors.textDim }}>
          {t.studioVideoResolution}
          <select
            value={resolution}
            onChange={(e) => setResolution(e.target.value as VideoOptions["resolution"])}
            style={selectStyle}
          >
            <option value="1920x1080">1920×1080</option>
            <option value="1280x720">1280×720</option>
          </select>
        </label>

        <label style={{ fontSize: typography.size.xs, color: colors.textDim }}>
          {t.studioVideoSubsMode}
          <select
            value={subsMode}
            onChange={(e) => setSubsMode(e.target.value as VideoOptions["subtitles_mode"])}
            disabled={!hasTranscript}
            style={{ ...selectStyle, opacity: hasTranscript ? 1 : 0.5 }}
          >
            <option value="none">{t.studioVideoSubsNone}</option>
            <option value="burn">{t.studioVideoSubsBurn}</option>
            <option value="soft">{t.studioVideoSubsSoft}</option>
          </select>
          {!hasTranscript ? (
            <span style={{ fontSize: typography.size.xs, color: colors.textFaint }}>
              {t.studioVideoSubsNeedTranscript}
            </span>
          ) : null}
        </label>

        <label style={{ fontSize: typography.size.xs, color: colors.textDim, display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={kenBurns}
            onChange={(e) => setKenBurns(e.target.checked)}
          />
          {t.studioVideoKenBurns}
        </label>

        <label style={{ fontSize: typography.size.xs, color: colors.textDim, display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={waveform}
            onChange={(e) => setWaveform(e.target.checked)}
          />
          {t.studioVideoWaveform}
        </label>
      </div>

      <label
        style={{
          display: "block",
          fontSize: typography.size.xs,
          color: colors.textDim,
          marginBottom: 12,
        }}
      >
        {t.studioVideoTitleText}
        <input
          value={titleText}
          onChange={(e) => setTitleText(e.target.value)}
          placeholder={t.studioVideoTitlePlaceholder}
          style={{
            display: "block",
            marginTop: 4,
            width: "100%",
            boxSizing: "border-box",
            padding: "6px 10px",
            borderRadius: radii.sm,
            background: colors.surfaceAlt,
            border: `1px solid ${colors.border}`,
            color: colors.text,
            fontSize: typography.size.sm,
            fontFamily: fonts.sans,
            outline: "none",
          }}
        />
      </label>

      {isRendering ? (
        <Button variant="danger" fullWidth onClick={onCancelRender}>
          {t.cancel}
        </Button>
      ) : (
        <Button
          variant="primary"
          fullWidth
          disabled={!canRender}
          onClick={() =>
            onRender({
              resolution,
              ken_burns: kenBurns,
              waveform_overlay: waveform,
              title_text: titleText.trim() || null,
              subtitles_mode: subsMode,
            })
          }
        >
          {t.studioVideoRender}
        </Button>
      )}

      {/* Video result */}
      {videoUrl ? (
        <div
          style={{
            marginTop: 14,
            padding: 12,
            borderRadius: radii.md,
            background: colors.surfaceAlt,
            border: `1px solid ${colors.borderFaint}`,
          }}
        >
          <p
            style={{
              margin: "0 0 8px",
              fontSize: typography.size.xs,
              color: colors.textDim,
              fontFamily: fonts.mono,
            }}
          >
            {videoMeta
              ? `${videoMeta.resolution} · ${videoMeta.durationS.toFixed(1)}s · ${(videoMeta.sizeBytes / 1024).toFixed(0)}KB`
              : t.studioVideoResult}
          </p>
          <video
            src={videoUrl}
            controls
            style={{ width: "100%", borderRadius: radii.sm, background: "#000" }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <Button variant="primary" size="sm" onClick={onDownloadVideo}>
              {t.studioVideoDownload}
            </Button>
            <Button variant="ghost" size="sm" onClick={onClearVideo}>
              {t.studioVideoClear}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  display: "block",
  marginTop: 4,
  width: "100%",
  padding: "6px 8px",
  borderRadius: radii.sm,
  background: colors.surfaceAlt,
  border: `1px solid ${colors.border}`,
  color: colors.text,
  fontSize: typography.size.sm,
  fontFamily: fonts.sans,
  outline: "none",
};
