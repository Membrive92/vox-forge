import { useCallback, useEffect, useRef, useState } from "react";

import { isAbortError } from "@/api/client";
import {
  mediaFileUrl,
  renderVideo,
  uploadCover,
  type CoverUploadResult,
  type MediaAsset,
  type StudioSource,
  type TranscribeResult,
  type VideoImage,
  type VideoOptions,
} from "@/api/studio";
import { useJobMirror } from "@/hooks/jobsContext";
import { logger } from "@/logging/logger";
import { downloadUrl } from "@/utils/download";

/**
 * The video half of a Studio session (Phase B.2): cover upload + MP4
 * render. One of the three focused hooks composed by
 * ``useStudioSession`` (MED-ARQ-4).
 */
export interface VideoRender {
  cover: CoverUploadResult | null;
  isUploadingCover: boolean;
  videoBlob: Blob | null;
  videoUrl: string | null;
  videoMeta: { durationS: number; sizeBytes: number; resolution: string } | null;
  isRendering: boolean;

  setCover: (file: File) => Promise<void>;
  /** Select a library asset as the cover (T2I-2 "Usar como portada").
   * Preview-only for now: the render endpoint needs an absolute path
   * the client can't resolve from an id, so this populates the cover
   * slot for display and the render-path wiring lands with T2I-3/M5. */
  setCoverFromAsset: (asset: MediaAsset) => void;
  clearCover: () => void;
  renderCurrent: (
    options: Partial<VideoOptions>,
    images?: VideoImage[],
  ) => Promise<boolean>;
  cancelRender: () => void;
  downloadVideo: (filenameHint?: string) => void;
  clearVideo: () => void;
  /** Wipe per-source artifacts (the cover survives a source switch). */
  reset: () => void;
}

export function useVideoRender(
  selected: StudioSource | null,
  transcript: TranscribeResult | null,
  reportError: (msg: string | null) => void,
): VideoRender {
  const [cover, setCoverState] = useState<CoverUploadResult | null>(null);
  const [isUploadingCover, setIsUploadingCover] = useState(false);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoMeta, setVideoMeta] = useState<VideoRender["videoMeta"]>(null);
  const [isRendering, setIsRendering] = useState(false);
  const lastVideoUrlRef = useRef<string | null>(null);
  const renderAbortRef = useRef<AbortController | null>(null);

  // UX-01: an ffmpeg MP4 render takes a while — keep it visible in the
  // global tray when the user navigates away from Studio.
  useJobMirror({
    active: isRendering,
    kind: "video-render",
    originTab: "studio",
    label: selected?.chapter_title ?? "",
  });

  useEffect(
    () => () => {
      if (lastVideoUrlRef.current) URL.revokeObjectURL(lastVideoUrlRef.current);
      renderAbortRef.current?.abort();
    },
    [],
  );

  const setCover = useCallback(async (file: File) => {
    setIsUploadingCover(true);
    reportError(null);
    try {
      const result = await uploadCover(file);
      setCoverState(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      reportError(msg);
      logger.error("Studio: cover upload failed", { error: msg });
    } finally {
      setIsUploadingCover(false);
    }
  }, [reportError]);

  const setCoverFromAsset = useCallback((asset: MediaAsset) => {
    // The render endpoint validates an absolute filesystem path under the
    // allowed Studio roots; a media asset only exposes its id + a
    // relative filename, so we can't build that path client-side yet.
    // Populate the cover slot for display (served by id) and defer the
    // render-path resolution to T2I-3/M5, where the backend will accept
    // an asset id directly.
    setCoverState({
      filename: asset.filename,
      path: mediaFileUrl(asset.id),
      size_kb: 0,
      content_type: "image/png",
    });
  }, []);

  const clearCover = useCallback(() => setCoverState(null), []);

  const renderCurrent = useCallback(
    async (options: Partial<VideoOptions>, images?: VideoImage[]): Promise<boolean> => {
      if (!selected) return false;
      // Slideshow mode needs no cover; single-cover mode needs it.
      const slideshow = images && images.length > 0;
      if (!slideshow && !cover) return false;
      const controller = new AbortController();
      renderAbortRef.current = controller;
      setIsRendering(true);
      reportError(null);
      try {
        const result = await renderVideo(
          {
            audio_path: selected.source_path,
            cover_path: slideshow ? null : cover?.path ?? null,
            subtitles_path: transcript?.srt_path ?? null,
            options,
            images: slideshow ? images : null,
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
        return true;
      } catch (err) {
        if (isAbortError(err)) {
          logger.info("Studio: render cancelled");
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          reportError(msg);
          logger.error("Studio: render failed", { error: msg });
        }
        return false;
      } finally {
        setIsRendering(false);
        if (renderAbortRef.current === controller) renderAbortRef.current = null;
      }
    },
    [selected, cover, transcript, reportError],
  );

  const cancelRender = useCallback(() => {
    renderAbortRef.current?.abort();
  }, []);

  const downloadVideo = useCallback(
    (filenameHint?: string) => {
      if (!videoBlob || !videoUrl) return;
      downloadUrl(videoUrl, filenameHint ?? `studio_video_${Date.now()}.mp4`);
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

  const reset = useCallback(() => {
    setVideoBlob(null);
    setVideoMeta(null);
    if (lastVideoUrlRef.current) {
      URL.revokeObjectURL(lastVideoUrlRef.current);
      lastVideoUrlRef.current = null;
    }
    setVideoUrl(null);
  }, []);

  return {
    cover,
    isUploadingCover,
    videoBlob,
    videoUrl,
    videoMeta,
    isRendering,
    setCover,
    setCoverFromAsset,
    clearCover,
    renderCurrent,
    cancelRender,
    downloadVideo,
    clearVideo,
    reset,
  };
}
