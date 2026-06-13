import { useCallback, useState } from "react";

import {
  deleteStudioRender,
  listStudioRenders,
  listStudioSources,
  type CoverUploadResult,
  type MediaAsset,
  type StudioOperation,
  type StudioRender,
  type StudioSource,
  type TranscribeResult,
  type VideoImage,
  type VideoOptions,
} from "@/api/studio";
import { logger } from "@/logging/logger";

import { useEditSession } from "./useEditSession";
import { useTranscription, type TranscribeOptions } from "./useTranscription";
import { useVideoRender } from "./useVideoRender";

export interface StudioSession {
  sources: StudioSource[];
  loadingSources: boolean;
  selected: StudioSource | null;
  operations: StudioOperation[];
  isProcessing: boolean;
  resultBlob: Blob | null;
  resultUrl: string | null;
  error: string | null;
  isPreviewMode: boolean;

  // Phase B.1 — transcription
  transcript: TranscribeResult | null;
  isTranscribing: boolean;
  // S2 — confidence of the last chapter-text alignment (null when the last
  // run was a plain Whisper transcription).
  alignmentConfidence: number | null;

  // Phase B.2 — video render
  cover: CoverUploadResult | null;
  isUploadingCover: boolean;
  videoBlob: Blob | null;
  videoUrl: string | null;
  videoMeta: { durationS: number; sizeBytes: number; resolution: string } | null;
  isRendering: boolean;

  // Phase B.2 — persisted renders
  renders: StudioRender[];
  loadingRenders: boolean;
}

export interface StudioSessionApi {
  session: StudioSession;
  refreshSources: () => Promise<void>;
  selectSource: (source: StudioSource | null) => void;
  addOperation: (op: StudioOperation) => void;
  removeOperation: (index: number) => void;
  moveOperation: (from: number, to: number) => void;
  clearOperations: () => void;
  apply: (outputFormat: string) => Promise<void>;
  applyPreview: (outputFormat: string) => Promise<void>;
  cancelApply: () => void;
  download: (filenameHint?: string) => void;

  transcribe: (options?: TranscribeOptions) => Promise<void>;
  cancelTranscribe: () => void;
  clearTranscript: () => void;

  setCover: (file: File) => Promise<void>;
  setCoverFromAsset: (asset: MediaAsset) => void;
  clearCover: () => void;
  renderCurrent: (
    options: Partial<VideoOptions>,
    images?: VideoImage[],
  ) => Promise<boolean>;
  cancelRender: () => void;
  downloadVideo: (filenameHint?: string) => void;
  clearVideo: () => void;

  refreshRenders: (options?: { kind?: "audio" | "video"; chapterId?: string }) => Promise<void>;
  removeRender: (renderId: string) => Promise<void>;
}

/**
 * Thin facade over the three focused Studio hooks (MED-ARQ-4):
 * ``useEditSession`` (op queue + apply), ``useTranscription`` (B.1) and
 * ``useVideoRender`` (B.2). The facade owns what they share — the
 * source list, the selected source, the persisted renders and the
 * single error surface — and its public API is unchanged for consumers.
 */
export function useStudioSession(): StudioSessionApi {
  const [sources, setSources] = useState<StudioSource[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [selected, setSelected] = useState<StudioSource | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [renders, setRenders] = useState<StudioRender[]>([]);
  const [loadingRenders, setLoadingRenders] = useState(false);

  const edit = useEditSession(selected, setError);
  const transcription = useTranscription(selected, setError);
  const video = useVideoRender(selected, transcription.transcript, setError);

  const refreshSources = useCallback(async () => {
    setLoadingSources(true);
    try {
      const list = await listStudioSources();
      setSources(list);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      logger.error("Studio: failed to load sources", { error: msg });
    } finally {
      setLoadingSources(false);
    }
  }, []);

  const selectSource = useCallback(
    (source: StudioSource | null) => {
      setSelected(source);
      // All Phase A/B artifacts are per-source — wipe them when switching.
      edit.reset();
      transcription.reset();
      video.reset();
    },
    [edit.reset, transcription.reset, video.reset],
  );

  // ── Recent renders (B.2) ─────────────────────────────────────────

  const refreshRenders = useCallback(
    async (options?: { kind?: "audio" | "video"; chapterId?: string }) => {
      setLoadingRenders(true);
      try {
        const list = await listStudioRenders(options ?? {});
        setRenders(list);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        logger.error("Studio: failed to load renders", { error: msg });
      } finally {
        setLoadingRenders(false);
      }
    },
    [],
  );

  const removeRender = useCallback(
    async (renderId: string) => {
      try {
        await deleteStudioRender(renderId);
        setRenders((prev) => prev.filter((r) => r.id !== renderId));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        logger.error("Studio: delete render failed", { error: msg });
      }
    },
    [],
  );

  return {
    session: {
      sources,
      loadingSources,
      selected,
      operations: edit.operations,
      isProcessing: edit.isProcessing,
      resultBlob: edit.resultBlob,
      resultUrl: edit.resultUrl,
      error,
      isPreviewMode: edit.isPreviewMode,
      transcript: transcription.transcript,
      isTranscribing: transcription.isTranscribing,
      alignmentConfidence: transcription.alignmentConfidence,
      cover: video.cover,
      isUploadingCover: video.isUploadingCover,
      videoBlob: video.videoBlob,
      videoUrl: video.videoUrl,
      videoMeta: video.videoMeta,
      isRendering: video.isRendering,
      renders,
      loadingRenders,
    },
    refreshSources,
    selectSource,
    addOperation: edit.addOperation,
    removeOperation: edit.removeOperation,
    moveOperation: edit.moveOperation,
    clearOperations: edit.clearOperations,
    apply: edit.apply,
    applyPreview: edit.applyPreview,
    cancelApply: edit.cancelApply,
    download: edit.download,
    transcribe: transcription.transcribe,
    cancelTranscribe: transcription.cancelTranscribe,
    clearTranscript: transcription.clearTranscript,
    setCover: video.setCover,
    setCoverFromAsset: video.setCoverFromAsset,
    clearCover: video.clearCover,
    renderCurrent: video.renderCurrent,
    cancelRender: video.cancelRender,
    downloadVideo: video.downloadVideo,
    clearVideo: video.clearVideo,
    refreshRenders,
    removeRender,
  };
}
