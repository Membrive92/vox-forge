import { useEffect, useMemo, useRef, useState } from "react";

import { getStudioAudioUrl } from "@/api/studio";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, typography } from "@/theme/tokens";

import { EditOperationsPanel } from "./EditOperationsPanel";
import { SourcePicker } from "./SourcePicker";
import { StudioWaveform, type StudioRegion, type StudioWaveformHandle } from "./StudioWaveform";
import { useStudioSession } from "./useStudioSession";

interface Props {
  t: Translations;
  onToast: (msg: string) => void;
}

export function StudioTab({ t, onToast }: Props) {
  const studio = useStudioSession();
  const { session } = studio;
  const waveformRef = useRef<StudioWaveformHandle>(null);
  const [region, setRegion] = useState<StudioRegion | null>(null);
  const [outputFormat, setOutputFormat] = useState<string>("mp3");
  const previousAppliedRef = useRef<Blob | null>(null);

  useEffect(() => {
    void studio.refreshSources();
  }, [studio.refreshSources]);

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
        </div>
      </div>
    </div>
  );
}
