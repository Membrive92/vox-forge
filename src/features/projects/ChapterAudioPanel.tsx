import { useRef, useState } from "react";

import type { Generation } from "@/api/projects";
import {
  applyChapterVoice,
  transcribeChapterGeneration,
  uploadChapterAudio,
} from "@/api/chapterSynth";
import { getGenerationAudioUrl } from "@/api/studio";
import { Button } from "@/components/Button";
import * as Icons from "@/components/icons";
import { ALL_VOICES } from "@/constants/voices";
import { logger } from "@/logging/logger";
import { downloadBlob } from "@/utils/download";
import type { Translations } from "@/i18n";
import type { Profile } from "@/types/domain";
import { colors, fonts, radii, space, typography } from "@/theme/tokens";

import { ChapterRecorder } from "./ChapterRecorder";
import { relativeTime } from "./workbenchHelpers";

/** Fetch a generation's audio and save it. The audio endpoint is a
 * different origin (API :8000) than the app, so the anchor ``download``
 * attribute is ignored — go through a blob. */
async function downloadTake(gen: Generation): Promise<void> {
  if (!gen.file_path) return;
  try {
    const res = await fetch(getGenerationAudioUrl(gen.file_path));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ext = gen.file_path.split(".").pop() || "mp3";
    downloadBlob(await res.blob(), `take_${gen.id}.${ext}`);
  } catch (e) {
    logger.error("Chapter take: download failed", {
      genId: gen.id,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

// ── ChapterAudioPanel ───────────────────────────────────────────────
//
// The audio half of an expanded ChapterCard: player for the active
// take, upload / record entry points, and the multi-take selector.

interface ChapterAudioPanelProps {
  t: Translations;
  chapterId: string;
  /** Saved voice profiles — those with a sample can be re-voice targets. */
  profiles: readonly Profile[];
  /** Active generation per chapter metadata (falling back to newest done). */
  activeGen: Generation | undefined;
  generations: readonly Generation[];
  onToast: (msg: string) => void;
  onOpenStudioWithSource: (generationId: string) => void;
  onSetActiveGeneration: (genId: string | null) => Promise<void>;
  /** Re-fetch generations/renders after an upload or recording lands. */
  onReloadStatus: () => Promise<void>;
  /** Push a fresh transcript into the chapter's text editor. */
  onTranscribed: (text: string) => void;
}

export function ChapterAudioPanel({
  t,
  chapterId,
  profiles,
  activeGen,
  generations,
  onToast,
  onOpenStudioWithSource,
  onSetActiveGeneration,
  onReloadStatus,
  onTranscribed,
}: ChapterAudioPanelProps) {
  // Only profiles with a stored sample can be an OpenVoice target.
  const profilesWithSample = profiles.filter((p) => p.samples.length > 0);
  const [isUploading, setIsUploading] = useState(false);
  const [recorderOpen, setRecorderOpen] = useState(false);
  const [isSavingRecording, setIsSavingRecording] = useState(false);
  const [applyVoiceId, setApplyVoiceId] = useState("");
  const [applyDenoise, setApplyDenoise] = useState(false);
  const [isApplyingVoice, setIsApplyingVoice] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
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

  // Re-voice the active take with a catalog voice's timbre (OpenVoice):
  // keeps the narration's prosody, registers a new active take.
  const handleApplyVoice = async (): Promise<void> => {
    if (!applyVoiceId) return;
    // applyVoiceId is "p:<profileId>" (saved profile) or "c:<voiceId>" (catalog).
    const isProfile = applyVoiceId.startsWith("p:");
    const id = applyVoiceId.slice(2);
    setIsApplyingVoice(true);
    try {
      const result = await applyChapterVoice(chapterId, {
        ...(isProfile ? { profileId: id } : { catalogVoiceId: id }),
        denoiseSource: applyDenoise,
      });
      onToast(t.chapterApplyVoiceDone);
      // The new take is already active server-side, but the player reads
      // ``chapter.active_generation_id`` from the prop — push it up so the
      // chapter refreshes and the player switches to the re-voiced take.
      await onSetActiveGeneration(result.generation_id);
    } catch (e) {
      onToast(`Error: ${e instanceof Error ? e.message : t.unknownError}`);
    } finally {
      setIsApplyingVoice(false);
    }
  };

  // Transcribe the active take with faster-whisper and fill the chapter
  // text, so a recorded/uploaded narration becomes a normal chapter.
  const handleTranscribe = async (): Promise<void> => {
    setIsTranscribing(true);
    try {
      const result = await transcribeChapterGeneration(chapterId);
      onTranscribed(result.text);
      onToast(t.chapterTranscribeDone.replace("{words}", String(result.word_count)));
    } catch (e) {
      onToast(`Error: ${e instanceof Error ? e.message : t.unknownError}`);
    } finally {
      setIsTranscribing(false);
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
                aria-label={t.chapterAudioPlayerLabel}
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
                    : activeGen.engine === "converted"
                      ? t.chapterTakeEngineConverted
                      : t.chapterTakeEngineTts}
              </span>
              <Button
                variant="ghost"
                size="sm"
                icon={<Icons.Download />}
                onClick={() => void downloadTake(activeGen)}
              >
                {t.chapterDownloadTake}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={<Icons.Edit />}
                onClick={() => onOpenStudioWithSource(activeGen.id)}
              >
                {t.chapterEditInStudio}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                loading={isTranscribing}
                title={t.chapterTranscribeHint}
                onClick={() => void handleTranscribe()}
              >
                {t.chapterTranscribe}
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

          {/* Re-voice this take: apply a catalog voice's timbre, keep prosody */}
          <div
            style={{
              borderTop: `1px solid ${colors.borderSubtle}`,
              paddingTop: space[2],
              display: "flex",
              flexDirection: "column",
              gap: space[1],
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
              <span
                style={{
                  fontSize: typography.size.xs,
                  fontWeight: 600,
                  color: colors.textMuted,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <Icons.Mic /> {t.chapterApplyVoiceLabel}
              </span>
              <select
                value={applyVoiceId}
                onChange={(e) => setApplyVoiceId(e.target.value)}
                aria-label={t.chapterApplyVoiceLabel}
                style={{
                  padding: "5px 9px",
                  borderRadius: radii.sm,
                  background: colors.surfaceAlt,
                  border: `1px solid ${colors.border}`,
                  color: colors.text,
                  fontSize: typography.size.xs,
                  fontFamily: fonts.sans,
                  cursor: "pointer",
                }}
              >
                <option value="">{t.chapterApplyVoicePick}</option>
                {profilesWithSample.length > 0 && (
                  <optgroup label={t.tabProfiles}>
                    {profilesWithSample.map((p) => (
                      <option key={p.id} value={`p:${p.id}`}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label={t.convertTargetCatalog}>
                  {ALL_VOICES.map((v) => (
                    <option key={v.id} value={`c:${v.id}`}>
                      {v.name} · {v.accent}
                    </option>
                  ))}
                </optgroup>
              </select>
              <Button
                variant="primary"
                size="sm"
                loading={isApplyingVoice}
                disabled={!applyVoiceId}
                onClick={() => void handleApplyVoice()}
              >
                {t.chapterApplyVoiceButton}
              </Button>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  cursor: "pointer",
                  fontSize: typography.size.xs,
                  color: colors.textDim,
                }}
                title={t.chapterApplyVoiceDenoiseHint}
              >
                <input
                  type="checkbox"
                  checked={applyDenoise}
                  onChange={(e) => setApplyDenoise(e.target.checked)}
                />
                {t.chapterApplyVoiceDenoise}
              </label>
            </div>
            <p style={{ margin: 0, fontSize: typography.size.xs, color: colors.textDim }}>
              {t.chapterApplyVoiceHint}
            </p>
          </div>
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
    if (engine === "converted") return t.chapterTakeEngineConverted;
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
