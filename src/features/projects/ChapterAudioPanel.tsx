import { useRef, useState } from "react";

import type { Generation } from "@/api/projects";
import { uploadChapterAudio } from "@/api/chapterSynth";
import { getGenerationAudioUrl } from "@/api/studio";
import { Button } from "@/components/Button";
import * as Icons from "@/components/icons";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, space, typography } from "@/theme/tokens";

import { ChapterRecorder } from "./ChapterRecorder";
import { relativeTime } from "./workbenchHelpers";

// ── ChapterAudioPanel ───────────────────────────────────────────────
//
// The audio half of an expanded ChapterCard: player for the active
// take, upload / record entry points, and the multi-take selector.

interface ChapterAudioPanelProps {
  t: Translations;
  chapterId: string;
  /** Active generation per chapter metadata (falling back to newest done). */
  activeGen: Generation | undefined;
  generations: readonly Generation[];
  onToast: (msg: string) => void;
  onOpenStudioWithSource: (generationId: string) => void;
  onSetActiveGeneration: (genId: string | null) => Promise<void>;
  /** Re-fetch generations/renders after an upload or recording lands. */
  onReloadStatus: () => Promise<void>;
}

export function ChapterAudioPanel({
  t,
  chapterId,
  activeGen,
  generations,
  onToast,
  onOpenStudioWithSource,
  onSetActiveGeneration,
  onReloadStatus,
}: ChapterAudioPanelProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [recorderOpen, setRecorderOpen] = useState(false);
  const [isSavingRecording, setIsSavingRecording] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const handleUploadAudio = async (file: File): Promise<void> => {
    setIsUploading(true);
    try {
      await uploadChapterAudio(chapterId, file);
      onToast(t.chapterUploadSuccess);
      await onReloadStatus();
    } catch (e) {
      onToast(`Error: ${e instanceof Error ? e.message : t.unknownError}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleSaveRecording = async (file: File): Promise<void> => {
    setIsSavingRecording(true);
    try {
      await uploadChapterAudio(chapterId, file);
      onToast(t.chapterUploadSuccess);
      setRecorderOpen(false);
      await onReloadStatus();
    } catch (e) {
      onToast(`Error: ${e instanceof Error ? e.message : t.unknownError}`);
    } finally {
      setIsSavingRecording(false);
    }
  };

  return (
    <>
      {/* Audio playback panel for uploaded/recorded/synthesized audio */}
      {activeGen?.status === "done" && activeGen?.file_path && (
        <div
          style={{
            marginTop: space[3],
            padding: space[3],
            background: colors.surfaceAlt,
            border: `1px solid ${colors.borderSubtle}`,
            borderRadius: radii.md,
            display: "flex",
            flexDirection: "column",
            gap: space[2],
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: space[2] }}>
            <div style={{ flex: 1 }}>
              <audio
                controls
                src={getGenerationAudioUrl(activeGen.file_path)}
                style={{
                  width: "100%",
                  maxWidth: "100%",
                }}
              />
            </div>
            <div style={{ display: "flex", gap: space[2], flexWrap: "wrap", fontSize: typography.size.xs }}>
              {activeGen.duration && (
                <span
                  style={{
                    padding: "2px 8px",
                    background: colors.primarySoft,
                    color: colors.primaryLight,
                    borderRadius: radii.sm,
                    fontFamily: fonts.mono,
                    whiteSpace: "nowrap",
                  }}
                >
                  {activeGen.duration.toFixed(1)}s
                </span>
              )}
              <span
                style={{
                  padding: "2px 8px",
                  background: colors.surface,
                  color: colors.textMuted,
                  border: `1px solid ${colors.borderSubtle}`,
                  borderRadius: radii.sm,
                  fontFamily: fonts.mono,
                  whiteSpace: "nowrap",
                }}
              >
                {activeGen.engine === "upload"
                  ? t.chapterTakeEngineUpload
                  : activeGen.engine === "recording" || activeGen.engine === "record"
                    ? t.chapterTakeEngineRecord
                    : t.chapterTakeEngineTts}
              </span>
              <Button
                variant="ghost"
                size="sm"
                icon={<Icons.Edit />}
                onClick={() => onOpenStudioWithSource(activeGen.id)}
              >
                {t.chapterEditInStudio}
              </Button>
            </div>
          </div>
          {(activeGen.engine === "recording" || activeGen.engine === "record") && (
            <p style={{ margin: 0, fontSize: typography.size.xs, color: colors.textDim }}>
              {t.chapterRecordedTakeNote}
            </p>
          )}
          {activeGen.engine === "upload" && (
            <p style={{ margin: 0, fontSize: typography.size.xs, color: colors.textDim }}>
              {t.chapterUploadTakeNote}
            </p>
          )}
        </div>
      )}

      {/* Audio source row: upload / record / pick active take */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: space[2],
          marginTop: space[2],
          flexWrap: "wrap",
        }}
      >
        <input
          ref={uploadInputRef}
          type="file"
          accept=".wav,.mp3,.ogg,.flac,.webm,.m4a"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleUploadAudio(f);
            e.target.value = "";
          }}
        />
        <Button
          variant="secondary"
          size="sm"
          loading={isUploading}
          onClick={() => uploadInputRef.current?.click()}
          icon={<Icons.Upload />}
        >
          {t.chapterUploadAudio}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<Icons.Mic />}
          onClick={() => setRecorderOpen(true)}
        >
          {t.chapterRecord}
        </Button>
        <div style={{ flex: 1 }} />
        {generations.length > 1 && (
          <TakeSelector
            t={t}
            generations={generations}
            activeId={activeGen?.id ?? null}
            onChange={onSetActiveGeneration}
          />
        )}
      </div>

      {recorderOpen && (
        <div style={{ marginTop: space[3] }}>
          <ChapterRecorder
            t={t}
            isSaving={isSavingRecording}
            onSave={handleSaveRecording}
            onCancel={() => setRecorderOpen(false)}
          />
        </div>
      )}
    </>
  );
}

// ── TakeSelector ───────────────────────────────────────────────────

interface TakeSelectorProps {
  t: Translations;
  generations: readonly Generation[];
  activeId: string | null;
  onChange: (genId: string | null) => Promise<void> | void;
}

function TakeSelector({ t, generations, activeId, onChange }: TakeSelectorProps) {
  const engineLabel = (engine: string): string => {
    if (engine === "upload") return t.chapterTakeEngineUpload;
    if (engine === "recording" || engine === "record") return t.chapterTakeEngineRecord;
    return t.chapterTakeEngineTts;
  };

  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: space[1],
        fontSize: typography.size.xs,
        color: colors.textDim,
      }}
    >
      {t.chapterTakes}
      <select
        value={activeId ?? ""}
        onChange={(e) => void onChange(e.target.value || null)}
        style={{
          padding: "4px 8px",
          borderRadius: radii.sm,
          background: colors.surfaceAlt,
          border: `1px solid ${colors.border}`,
          color: colors.text,
          fontSize: typography.size.xs,
          fontFamily: fonts.sans,
          cursor: "pointer",
        }}
      >
        {generations.map((g) => {
          const dur = g.duration ? `${g.duration.toFixed(1)}s` : "—";
          const label = t.chapterTakeLabel
            .replace("{engine}", engineLabel(g.engine))
            .replace("{when}", relativeTime(g.created_at, t))
            .replace("{dur}", dur);
          return (
            <option key={g.id} value={g.id}>
              {label}{g.status !== "done" ? ` · ${g.status}` : ""}
            </option>
          );
        })}
      </select>
    </label>
  );
}
