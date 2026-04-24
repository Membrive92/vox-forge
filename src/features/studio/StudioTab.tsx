import { useEffect, useMemo, useRef, useState } from "react";

import { getStudioAudioUrl } from "@/api/studio";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, typography } from "@/theme/tokens";

import { EditOperationsPanel } from "./EditOperationsPanel";
import { RecentRenders } from "./RecentRenders";
import { SourcePicker } from "./SourcePicker";
import { StudioWaveform, type StudioRegion, type StudioWaveformHandle } from "./StudioWaveform";
import { TranscribePanel } from "./TranscribePanel";
import { useStudioSession } from "./useStudioSession";
import { VideoRenderPanel } from "./VideoRenderPanel";

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
  const previousAppliedRef = useRef<Blob | null>(null);

  useEffect(() => {
    void studio.refreshSources();
    void studio.refreshRenders();
  }, [studio.refreshSources, studio.refreshRenders]);

  // Cross-tab navigation: when the Workbench fires "Edit in Studio" we
  // receive a generation id via props. Find the matching source, select
  // it, then tell the parent we're done so the intent doesn't re-fire.
  useEffect(() => {
    if (!pendingSourceId) return;
    const match = session.sources.find((s) => s.id === pendingSourceId);
    if (match) {
      studio.selectSource(match);
      onPendingSourceConsumed();
    } else if (!session.loadingSources && session.sources.length > 0) {
      // Sources loaded but the id isn't there — stale link. Clear so
      // the user isn't stuck.
      onPendingSourceConsumed();
    }
  }, [
    pendingSourceId,
    session.sources,
    session.loadingSources,
    studio.selectSource,
    onPendingSourceConsumed,
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

  const handleClearRegion = (): void => {
    waveformRef.current?.clearRegion();
    setRegion(null);
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
          {t.studioTagline}
        </p>
      </header>

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
            onClear={studio.clearOperations}
            onApply={handleApply}
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
            {session.resultUrl ? (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <audio
                  controls
                  src={session.resultUrl}
                  style={{ flex: 1, minWidth: 0 }}
                />
                <button
                  type="button"
                  onClick={() => studio.download(`studio_edit.${outputFormat}`)}
                  style={{
                    padding: "8px 14px",
                    borderRadius: radii.sm,
                    background: colors.primary,
                    border: "none",
                    color: "#fff",
                    cursor: "pointer",
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
            onTranscribe={(lang) => void studio.transcribe(lang)}
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
              void studio.renderCurrent(options, images).then(() => {
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
    </div>
  );
}
