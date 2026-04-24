import { useMemo, useRef, useState } from "react";

import { uploadCover } from "@/api/studio";
import type {
  CoverUploadResult,
  SrtEntry,
  VideoImage,
  VideoOptions,
} from "@/api/studio";
import { Button } from "@/components/Button";
import * as Icons from "@/components/icons";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, typography } from "@/theme/tokens";

import { detectScenes, type Scene } from "./scenes";

interface Props {
  t: Translations;
  enabled: boolean;
  cover: CoverUploadResult | null;
  isUploadingCover: boolean;
  hasTranscript: boolean;
  transcriptEntries: readonly SrtEntry[];
  isRendering: boolean;
  videoUrl: string | null;
  videoMeta: { durationS: number; sizeBytes: number; resolution: string } | null;
  onPickCover: (file: File) => void;
  onClearCover: () => void;
  onRender: (options: Partial<VideoOptions>, images?: VideoImage[]) => void;
  onCancelRender: () => void;
  onDownloadVideo: () => void;
  onClearVideo: () => void;
  onToast: (msg: string) => void;
}

export function VideoRenderPanel({
  t,
  enabled,
  cover,
  isUploadingCover,
  hasTranscript,
  transcriptEntries,
  isRendering,
  videoUrl,
  videoMeta,
  onPickCover,
  onClearCover,
  onRender,
  onCancelRender,
  onDownloadVideo,
  onClearVideo,
  onToast,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [resolution, setResolution] = useState<VideoOptions["resolution"]>("1920x1080");
  const [kenBurns, setKenBurns] = useState(true);
  const [waveform, setWaveform] = useState(true);
  const [titleText, setTitleText] = useState("");
  const [subsMode, setSubsMode] = useState<VideoOptions["subtitles_mode"]>(
    hasTranscript ? "burn" : "none",
  );
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [sceneImages, setSceneImages] = useState<Record<number, CoverUploadResult>>({});
  const [sceneUploadingIdx, setSceneUploadingIdx] = useState<number | null>(null);

  // If the user removes the transcript, reset subs to none so we don't
  // send an invalid request.
  if (!hasTranscript && subsMode !== "none") {
    setSubsMode("none");
  }

  const handleFile = (file: File | undefined): void => {
    if (!file) return;
    onPickCover(file);
  };

  // Scene detection runs client-side from the transcript entries the
  // transcribe endpoint already returned — no backend round-trip.
  const handleDetectScenes = (): void => {
    const next = detectScenes(transcriptEntries, 25);
    setScenes(next);
    // Clear any image that was assigned to a scene index that no
    // longer exists after re-detection.
    setSceneImages((prev) => {
      const filtered: Record<number, CoverUploadResult> = {};
      for (const [k, v] of Object.entries(prev)) {
        const idx = Number(k);
        if (idx < next.length) filtered[idx] = v;
      }
      return filtered;
    });
  };

  const handlePickSceneImage = async (idx: number, file: File): Promise<void> => {
    setSceneUploadingIdx(idx);
    try {
      const res = await uploadCover(file);
      setSceneImages((prev) => ({ ...prev, [idx]: res }));
    } catch (e) {
      onToast(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSceneUploadingIdx(null);
    }
  };

  const handleClearSceneImage = (idx: number): void => {
    setSceneImages((prev) => {
      const next = { ...prev };
      delete next[idx];
      return next;
    });
  };

  // Render in slideshow mode only if the user has actually anchored at
  // least one image to a scene. Otherwise fall back to the single-cover
  // path so cover-only rendering still works.
  const slideshowImages: VideoImage[] = useMemo(() => {
    if (scenes.length === 0) return [];
    return scenes
      .map((sc, i) => {
        const img = sceneImages[i];
        return img ? { path: img.path, start_s: sc.start_s } : null;
      })
      .filter((x): x is VideoImage => x !== null);
  }, [scenes, sceneImages]);

  const useSlideshow = slideshowImages.length > 0;
  const canRender = enabled && !isRendering && (useSlideshow || cover !== null);

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

      {/* Scene slideshow — only offered when a transcript exists */}
      {hasTranscript && (
        <SceneManager
          t={t}
          scenes={scenes}
          sceneImages={sceneImages}
          uploadingIdx={sceneUploadingIdx}
          onDetect={handleDetectScenes}
          onPickImage={(i, f) => void handlePickSceneImage(i, f)}
          onClearImage={handleClearSceneImage}
        />
      )}

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
            onRender(
              {
                resolution,
                ken_burns: kenBurns,
                waveform_overlay: waveform,
                title_text: titleText.trim() || null,
                subtitles_mode: subsMode,
              },
              useSlideshow ? slideshowImages : undefined,
            )
          }
        >
          {useSlideshow
            ? t.studioVideoRenderSlideshow.replace("{n}", String(slideshowImages.length))
            : t.studioVideoRender}
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

// ── SceneManager ─────────────────────────────────────────────────────

function formatMmSs(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface SceneManagerProps {
  t: Translations;
  scenes: readonly Scene[];
  sceneImages: Record<number, CoverUploadResult>;
  uploadingIdx: number | null;
  onDetect: () => void;
  onPickImage: (idx: number, file: File) => void;
  onClearImage: (idx: number) => void;
}

function SceneManager({
  t,
  scenes,
  sceneImages,
  uploadingIdx,
  onDetect,
  onPickImage,
  onClearImage,
}: SceneManagerProps) {
  // One hidden input per scene would be noisy — share a single ref and
  // remember which scene triggered it so ``onChange`` routes correctly.
  const pickerRef = useRef<HTMLInputElement>(null);
  const targetIdxRef = useRef<number | null>(null);
  const assignedCount = Object.keys(sceneImages).length;

  const openPicker = (idx: number): void => {
    targetIdxRef.current = idx;
    pickerRef.current?.click();
  };

  return (
    <div
      style={{
        marginTop: 4,
        marginBottom: 12,
        padding: 10,
        borderRadius: radii.md,
        background: colors.surfaceAlt,
        border: `1px solid ${colors.borderFaint}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div>
          <div style={{ fontSize: typography.size.sm, fontWeight: 600 }}>
            {t.studioScenesTitle}
          </div>
          <div style={{ fontSize: typography.size.xs, color: colors.textDim }}>
            {scenes.length === 0
              ? t.studioScenesHint
              : t.studioScenesProgress
                  .replace("{assigned}", String(assignedCount))
                  .replace("{total}", String(scenes.length))}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onDetect}>
          {scenes.length === 0 ? t.studioScenesDetect : t.studioScenesRedetect}
        </Button>
      </div>

      {scenes.length > 0 && (
        <ul
          style={{
            listStyle: "none",
            margin: "10px 0 0",
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            maxHeight: 240,
            overflowY: "auto",
          }}
        >
          {scenes.map((sc, i) => {
            const img = sceneImages[i];
            const uploading = uploadingIdx === i;
            return (
              <li
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  borderRadius: radii.sm,
                  background: colors.surface,
                  border: `1px solid ${colors.borderFaint}`,
                }}
              >
                <span
                  style={{
                    fontSize: typography.size.xs,
                    fontFamily: fonts.mono,
                    color: colors.textDim,
                    minWidth: 56,
                  }}
                >
                  {formatMmSs(sc.start_s)}
                </span>
                <span
                  style={{
                    flex: 1,
                    fontSize: typography.size.xs,
                    color: colors.textMuted,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {sc.text_preview}
                </span>
                {img ? (
                  <>
                    <span
                      style={{
                        fontSize: typography.size.xs,
                        fontFamily: fonts.mono,
                        color: "#4ade80",
                        maxWidth: 120,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={img.filename}
                    >
                      ✓ {img.filename}
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => onClearImage(i)}>
                      ×
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={uploading}
                    onClick={() => openPicker(i)}
                  >
                    {t.studioScenesAddImage}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <input
        ref={pickerRef}
        type="file"
        accept=".png,.jpg,.jpeg,.webp"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          const idx = targetIdxRef.current;
          if (f && idx !== null) onPickImage(idx, f);
          e.target.value = "";
          targetIdxRef.current = null;
        }}
      />
    </div>
  );
}
