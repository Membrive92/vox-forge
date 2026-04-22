import { useCallback, useEffect, useRef, useState } from "react";

import { isAbortError } from "@/api/client";
import {
  applyEdit,
  deleteStudioRender,
  listStudioRenders,
  listStudioSources,
  renderVideo,
  transcribeSource,
  uploadCover,
  type CoverUploadResult,
  type StudioOperation,
  type StudioRender,
  type StudioSource,
  type TranscribeResult,
  type VideoOptions,
} from "@/api/studio";
import { logger } from "@/logging/logger";

export interface StudioSession {
  sources: StudioSource[];
  loadingSources: boolean;
  selected: StudioSource | null;
  operations: StudioOperation[];
  isProcessing: boolean;
  resultBlob: Blob | null;
  resultUrl: string | null;
  error: string | null;

  // Phase B.1 — transcription
  transcript: TranscribeResult | null;
  isTranscribing: boolean;

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
  cancelApply: () => void;
  download: (filenameHint?: string) => void;

  transcribe: (language?: string) => Promise<void>;
  cancelTranscribe: () => void;
  clearTranscript: () => void;

  setCover: (file: File) => Promise<void>;
  clearCover: () => void;
  renderCurrent: (options: Partial<VideoOptions>) => Promise<void>;
  cancelRender: () => void;
  downloadVideo: (filenameHint?: string) => void;
  clearVideo: () => void;

  refreshRenders: (options?: { kind?: "audio" | "video"; chapterId?: string }) => Promise<void>;
  removeRender: (renderId: string) => Promise<void>;
}

export function useStudioSession(): StudioSessionApi {
  const [sources, setSources] = useState<StudioSource[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [selected, setSelected] = useState<StudioSource | null>(null);
  const [operations, setOperations] = useState<StudioOperation[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastUrlRef = useRef<string | null>(null);

  const [transcript, setTranscript] = useState<TranscribeResult | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const [cover, setCoverState] = useState<CoverUploadResult | null>(null);
  const [isUploadingCover, setIsUploadingCover] = useState(false);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoMeta, setVideoMeta] = useState<StudioSession["videoMeta"]>(null);
  const [isRendering, setIsRendering] = useState(false);
  const lastVideoUrlRef = useRef<string | null>(null);

  const [renders, setRenders] = useState<StudioRender[]>([]);
  const [loadingRenders, setLoadingRenders] = useState(false);

  // Abort controllers for each long-running task. Kept in refs so cancel
  // methods can signal the in-flight fetch without re-rendering.
  const applyAbortRef = useRef<AbortController | null>(null);
  const transcribeAbortRef = useRef<AbortController | null>(null);
  const renderAbortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
      if (lastVideoUrlRef.current) URL.revokeObjectURL(lastVideoUrlRef.current);
      applyAbortRef.current?.abort();
      transcribeAbortRef.current?.abort();
      renderAbortRef.current?.abort();
    },
    [],
  );

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

  const selectSource = useCallback((source: StudioSource | null) => {
    setSelected(source);
    setOperations([]);
    setResultBlob(null);
    if (lastUrlRef.current) {
      URL.revokeObjectURL(lastUrlRef.current);
      lastUrlRef.current = null;
    }
    setResultUrl(null);
    // Phase B artifacts are per-source too — wipe them when switching.
    setTranscript(null);
    setVideoBlob(null);
    setVideoMeta(null);
    if (lastVideoUrlRef.current) {
      URL.revokeObjectURL(lastVideoUrlRef.current);
      lastVideoUrlRef.current = null;
    }
    setVideoUrl(null);
  }, []);

  const addOperation = useCallback((op: StudioOperation) => {
    setOperations((prev) => [...prev, op]);
  }, []);

  const removeOperation = useCallback((index: number) => {
    setOperations((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const moveOperation = useCallback((from: number, to: number) => {
    setOperations((prev) => {
      if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const [item] = next.splice(from, 1);
      if (item) next.splice(to, 0, item);
      return next;
    });
  }, []);

  const clearOperations = useCallback(() => setOperations([]), []);

  const apply = useCallback(
    async (outputFormat: string) => {
      if (!selected || operations.length === 0) return;
      const controller = new AbortController();
      applyAbortRef.current = controller;
      setIsProcessing(true);
      setError(null);
      try {
        logger.info("Studio: applying edit", {
          source: selected.source_path,
          ops: operations.length,
          format: outputFormat,
        });
        const result = await applyEdit(
          selected.source_path,
          operations,
          outputFormat,
          { projectId: selected.project_id, chapterId: selected.chapter_id },
          controller.signal,
        );
        if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
        const url = URL.createObjectURL(result.blob);
        lastUrlRef.current = url;
        setResultBlob(result.blob);
        setResultUrl(url);
      } catch (err) {
        if (isAbortError(err)) {
          logger.info("Studio: apply cancelled");
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
          logger.error("Studio: apply failed", { error: msg });
        }
      } finally {
        setIsProcessing(false);
        if (applyAbortRef.current === controller) applyAbortRef.current = null;
      }
    },
    [selected, operations],
  );

  const cancelApply = useCallback(() => {
    applyAbortRef.current?.abort();
  }, []);

  const download = useCallback(
    (filenameHint?: string) => {
      if (!resultBlob || !resultUrl) return;
      const a = document.createElement("a");
      a.href = resultUrl;
      a.download = filenameHint ?? `studio_edit_${Date.now()}.mp3`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    },
    [resultBlob, resultUrl],
  );

  // ── Transcription (B.1) ──────────────────────────────────────────

  const transcribe = useCallback(
    async (language?: string) => {
      if (!selected) return;
      const controller = new AbortController();
      transcribeAbortRef.current = controller;
      setIsTranscribing(true);
      setError(null);
      try {
        const result = await transcribeSource(
          selected.source_path,
          language ? { language } : {},
          controller.signal,
        );
        setTranscript(result);
        logger.info("Studio: transcribed", {
          source: selected.source_path,
          segments: result.entries.length,
          engine: result.engine,
        });
      } catch (err) {
        if (isAbortError(err)) {
          logger.info("Studio: transcribe cancelled");
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
          logger.error("Studio: transcribe failed", { error: msg });
        }
      } finally {
        setIsTranscribing(false);
        if (transcribeAbortRef.current === controller) transcribeAbortRef.current = null;
      }
    },
    [selected],
  );

  const cancelTranscribe = useCallback(() => {
    transcribeAbortRef.current?.abort();
  }, []);

  const clearTranscript = useCallback(() => setTranscript(null), []);

  // ── Cover + video render (B.2) ───────────────────────────────────

  const setCover = useCallback(async (file: File) => {
    setIsUploadingCover(true);
    setError(null);
    try {
      const result = await uploadCover(file);
      setCoverState(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      logger.error("Studio: cover upload failed", { error: msg });
    } finally {
      setIsUploadingCover(false);
    }
  }, []);

  const clearCover = useCallback(() => setCoverState(null), []);

  const renderCurrent = useCallback(
    async (options: Partial<VideoOptions>) => {
      if (!selected || !cover) return;
      const controller = new AbortController();
      renderAbortRef.current = controller;
      setIsRendering(true);
      setError(null);
      try {
        const result = await renderVideo(
          {
            audio_path: selected.source_path,
            cover_path: cover.path,
            subtitles_path: transcript?.srt_path ?? null,
            options,
          },
          controller.signal,
        );
        if (lastVideoUrlRef.current) URL.revokeObjectURL(lastVideoUrlRef.current);
        const url = URL.createObjectURL(result.blob);
        lastVideoUrlRef.current = url;
        setVideoBlob(result.blob);
        setVideoUrl(url);
        setVideoMeta({
          durationS: result.durationS,
          sizeBytes: result.sizeBytes,
          resolution: result.resolution,
        });
      } catch (err) {
        if (isAbortError(err)) {
          logger.info("Studio: render cancelled");
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
          logger.error("Studio: render failed", { error: msg });
        }
      } finally {
        setIsRendering(false);
        if (renderAbortRef.current === controller) renderAbortRef.current = null;
      }
    },
    [selected, cover, transcript],
  );

  const cancelRender = useCallback(() => {
    renderAbortRef.current?.abort();
  }, []);

  const downloadVideo = useCallback(
    (filenameHint?: string) => {
      if (!videoBlob || !videoUrl) return;
      const a = document.createElement("a");
      a.href = videoUrl;
      a.download = filenameHint ?? `studio_video_${Date.now()}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    },
    [videoBlob, videoUrl],
  );

  const clearVideo = useCallback(() => {
    if (lastVideoUrlRef.current) {
      URL.revokeObjectURL(lastVideoUrlRef.current);
      lastVideoUrlRef.current = null;
    }
    setVideoBlob(null);
    setVideoUrl(null);
    setVideoMeta(null);
  }, []);

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
      operations,
      isProcessing,
      resultBlob,
      resultUrl,
      error,
      transcript,
      isTranscribing,
      cover,
      isUploadingCover,
      videoBlob,
      videoUrl,
      videoMeta,
      isRendering,
      renders,
      loadingRenders,
    },
    refreshSources,
    selectSource,
    addOperation,
    removeOperation,
    moveOperation,
    clearOperations,
    apply,
    cancelApply,
    download,
    transcribe,
    cancelTranscribe,
    clearTranscript,
    setCover,
    clearCover,
    renderCurrent,
    cancelRender,
    downloadVideo,
    clearVideo,
    refreshRenders,
    removeRender,
  };
}
