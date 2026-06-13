import { useEffect, useMemo, useRef, useState } from "react";

import { getStudioAudioUrl, type MediaAsset } from "@/api/studio";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, typography } from "@/theme/tokens";

import { EditOperationsPanel } from "./EditOperationsPanel";
import { ImagesPanel } from "./ImagesPanel";
import { RecentRenders } from "./RecentRenders";
import { SourcePicker } from "./SourcePicker";
import { StudioWaveform, type StudioRegion, type StudioWaveformHandle } from "./StudioWaveform";
import { TranscribePanel } from "./TranscribePanel";
import { useStudioSession } from "./useStudioSession";
import { VideoRenderPanel } from "./VideoRenderPanel";

type StudioMode = "audio" | "images" | "montage";

interface Props {
  t: Translations;
  onToast: (msg: string) => void;
  pendingSourceId: string | null;
  onPendingSourceConsumed: () => void;
}

export function StudioTab({ t, onToast, pendingSourceId, onPendingSourceConsumed }: Props) {
  const studio = useStudioSession();
  const { session } = studio;
  const waveformRef = useRef<StudioWaveformHandle>(null);
  const [region, setRegion] = useState<StudioRegion | null>(null);
  const [outputFormat, setOutputFormat] = useState<string>("mp3");
  const [mode, setMode] = useState<StudioMode>("audio");
  const previousAppliedRef = useRef<Blob | null>(null);

  useEffect(() => {
    void studio.refreshSources();
    void studio.refreshRenders();
  }, [studio.refreshSources, studio.refreshRenders]);

  // Cross-tab navigation: when the Workbench fires "Edit in Studio" we
  // receive a generation id via props. Find the matching source, select
  // it, then tell the parent we're done so the intent doesn't re-fire.
  //
  // StudioTab stays mounted once visited and only loads sources on mount,
  // so the cached list is usually stale by the time the user clicks "Edit
  // in Studio" on a freshly-generated take. If the id isn't in the current
  // list, refresh once before giving up — otherwise a valid link silently
  // does nothing (which looked like "Edit in Studio is broken").
  const pendingRefreshRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingSourceId) {
      pendingRefreshRef.current = null;
      return;
    }
    const match = session.sources.find((s) => s.id === pendingSourceId);
    if (match) {
      studio.selectSource(match);
      pendingRefreshRef.current = null;
      onPendingSourceConsumed();
      return;
    }
    if (session.loadingSources) return;
    if (pendingRefreshRef.current !== pendingSourceId) {
      // Cached list may be stale — pull a fresh one before deciding.
      pendingRefreshRef.current = pendingSourceId;
      void studio.refreshSources();
      return;
    }
    // Refreshed and still absent — the take genuinely isn't an editable
    // source (e.g. a non-active take). Surface it instead of failing
    // silently, and clear so the user isn't stuck.
    pendingRefreshRef.current = null;
    onPendingSourceConsumed();
    onToast(t.studioSourceUnavailable);
  }, [
    pendingSourceId,
    session.sources,
    session.loadingSources,
    studio.selectSource,
    studio.refreshSources,
    onPendingSourceConsumed,
    onToast,
    t.studioSourceUnavailable,
  ]);

  useEffect(() => {
    if (session.error) onToast(`${t.studioApplyFailed}: ${session.error}`);
  }, [session.error, onToast, t.studioApplyFailed]);

  useEffect(() => {
    if (session.resultBlob && session.resultBlob !== previousAppliedRef.current) {
      previousAppliedRef.current = session.resultBlob;
      onToast(t.studioApplied);
    }
  }, [session.resultBlob, onToast, t.studioApplied]);

  const audioUrl = useMemo(
    () => (session.selected ? getStudioAudioUrl(session.selected.source_path) : null),
    [session.selected],
  );

  const handleApply = (): void => {
    void studio.apply(outputFormat);
  };

  const handleApplyPreview = (): void => {
    void studio.applyPreview(outputFormat);
  };

  const handleClearRegion = (): void => {
    waveformRef.current?.clearRegion();
    setRegion(null);
  };

  // "Usar como portada": drop the asset into the video cover slot and
  // surface the Audio body where that slot lives.
  const handleUseAsCover = (asset: MediaAsset): void => {
    studio.setCoverFromAsset(asset);
    setMode("audio");
    onToast(t.studioMediaBinCoverSet);
  };

  return (
    <div>
      <header style={{ marginBottom: 20 }}>
        <h2
          style={{
            margin: 0,
            fontSize: typography.size["2xl"],
            fontWeight: 800,
            fontFamily: fonts.serif,
          }}
        >
          {t.tabStudio}
        </h2>
        <p style={{ margin: "4px 0 0", fontSize: typography.size.sm, color: colors.textDim }}>
          {mode === "images" ? t.studioImagesTagline : t.studioTagline}
        </p>
      </header>

      <ModeToggle t={t} mode={mode} onChange={setMode} />

      {mode === "images" ? (
        <ImagesPanel t={t} onToast={onToast} onUseAsCover={handleUseAsCover} />
      ) : (
      <div className="vf-studio-grid">
        <SourcePicker
          t={t}
          sources={session.sources}
          loading={session.loadingSources}
          selectedId={session.selected?.id ?? null}
          onSelect={studio.selectSource}
          onRefresh={() => void studio.refreshSources()}
        />

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <StudioWaveform
            ref={waveformRef}
            t={t}
            audioUrl={audioUrl}
            onRegionChange={setRegion}
          />

          <EditOperationsPanel
            t={t}
            region={region}
            operations={session.operations}
            isProcessing={session.isProcessing}
            outputFormat={outputFormat}
            onAdd={studio.addOperation}
            onRemove={studio.removeOperation}
            onMove={studio.moveOperation}
            onClear={studio.clearOperations}
            onApply={handleApply}
            onApplyPreview={handleApplyPreview}
            onCancelApply={studio.cancelApply}
            onClearRegion={handleClearRegion}
            onOutputFormatChange={setOutputFormat}
            onNeedRegion={() => onToast(t.studioNeedRegion)}
          />

          <div
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: radii.xl,
              padding: 16,
            }}
          >
            <h3 style={{ margin: "0 0 12px", fontSize: typography.size.base, fontWeight: 700 }}>
              {t.studioResultTitle}
            </h3>
            {session.isPreviewMode && (
              <div
                style={{
                  padding: 12,
                  marginBottom: 12,
                  background: "rgba(250,204,21,0.1)",
                  border: "1px solid rgba(250,204,21,0.3)",
                  borderRadius: radii.md,
                  fontSize: typography.size.xs,
                  color: colors.text,
                }}
              >
                {t.studioPreviewWarning}
              </div>
            )}
            {session.resultUrl ? (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <audio
                  controls
                  aria-label={t.studioResultTitle}
                  src={session.resultUrl}
                  style={{ flex: 1, minWidth: 0 }}
                />
                <button
                  type="button"
                  onClick={() => studio.download(`studio_edit.${outputFormat}`)}
                  disabled={session.isPreviewMode}
                  style={{
                    padding: "8px 14px",
                    borderRadius: radii.sm,
                    background: session.isPreviewMode ? colors.textFaint : colors.primary,
                    border: "none",
                    color: "#fff",
                    cursor: session.isPreviewMode ? "not-allowed" : "pointer",
                    opacity: session.isPreviewMode ? 0.5 : 1,
                    fontSize: typography.size.xs,
                    fontWeight: 700,
                    fontFamily: fonts.sans,
                  }}
                >
                  {t.studioDownload}
                </button>
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: typography.size.xs, color: colors.textFaint }}>
                {t.studioResultEmpty}
              </p>
            )}
          </div>

          <TranscribePanel
            t={t}
            enabled={session.selected !== null}
            isTranscribing={session.isTranscribing}
            transcript={session.transcript}
            canUseChapterText={session.selected?.chapter_id != null}
            alignmentConfidence={session.alignmentConfidence}
            onTranscribe={(options) => void studio.transcribe(options)}
            onCancel={studio.cancelTranscribe}
          />

          <VideoRenderPanel
            t={t}
            enabled={session.selected !== null}
            cover={session.cover}
            isUploadingCover={session.isUploadingCover}
            hasTranscript={session.transcript !== null}
            transcriptEntries={session.transcript?.entries ?? []}
            isRendering={session.isRendering}
            videoUrl={session.videoUrl}
            videoMeta={session.videoMeta}
            onPickCover={(file) => void studio.setCover(file)}
            onClearCover={studio.clearCover}
            onRender={(options, images) => {
              void studio.renderCurrent(options, images).then((ok) => {
                if (!ok) return;
                onToast(t.studioVideoRenderSuccess);
                void studio.refreshRenders();
              });
            }}
            onCancelRender={studio.cancelRender}
            onDownloadVideo={() => studio.downloadVideo()}
            onClearVideo={studio.clearVideo}
            onToast={onToast}
          />

          <RecentRenders
            t={t}
            renders={session.renders}
            loading={session.loadingRenders}
            currentChapterId={session.selected?.chapter_id ?? null}
            onRefresh={(options) => void studio.refreshRenders(options)}
            onDelete={(id) => void studio.removeRender(id)}
          />
        </div>
      </div>
      )}
    </div>
  );
}

// ── Mode toggle (Audio | Imágenes | Montaje) ─────────────────────────

interface ModeToggleProps {
  t: Translations;
  mode: StudioMode;
  onChange: (mode: StudioMode) => void;
}

function ModeToggle({ t, mode, onChange }: ModeToggleProps) {
  const items: { id: StudioMode; label: string; disabled?: boolean; hint?: string }[] = [
    { id: "audio", label: t.studioModeAudio },
    { id: "images", label: t.studioModeImages },
    { id: "montage", label: t.studioModeMontage, disabled: true, hint: t.studioModeMontageSoon },
  ];
  return (
    <div
      role="tablist"
      aria-label={t.tabStudio}
      style={{ display: "flex", gap: 6, marginBottom: 18 }}
    >
      {items.map((item) => {
        const active = mode === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={item.disabled}
            title={item.hint ?? ""}
            onClick={() => !item.disabled && onChange(item.id)}
            style={{
              padding: "7px 16px",
              fontSize: typography.size.sm,
              fontWeight: 700,
              borderRadius: radii.md,
              background: active ? colors.primarySoft : "transparent",
              color: item.disabled ? colors.textFaint : active ? colors.primaryLight : colors.textDim,
              border: `1px solid ${active ? colors.primaryBorder : colors.borderFaint}`,
              cursor: item.disabled ? "not-allowed" : "pointer",
              opacity: item.disabled ? 0.6 : 1,
              fontFamily: fonts.sans,
            }}
          >
            {item.label}
            {item.disabled && item.hint ? (
              <span style={{ marginLeft: 6, fontSize: typography.size.xs, fontWeight: 500 }}>
                ({item.hint})
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
