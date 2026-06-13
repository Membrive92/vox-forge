import { useCallback, useEffect, useRef, useState } from "react";

import { isAbortError } from "@/api/client";
import {
  transcribeAligned,
  transcribeSource,
  type StudioSource,
  type TranscribeResult,
} from "@/api/studio";
import { useJobMirror } from "@/hooks/jobsContext";
import { logger } from "@/logging/logger";

/** Options for a transcription run. */
export interface TranscribeOptions {
  language?: string;
  /** S2: align the chapter's known text to the audio instead of using
   * Whisper's raw transcription. Only effective when the selected source
   * carries a ``chapter_id`` (otherwise we fall back to a plain run). */
  useChapterText?: boolean;
}

/**
 * The transcription half of a Studio session (Phase B.1 + S2). One of the
 * three focused hooks composed by ``useStudioSession`` (MED-ARQ-4).
 */
export interface Transcription {
  transcript: TranscribeResult | null;
  isTranscribing: boolean;
  /** Alignment confidence in [0, 1] when the last run used chapter text;
   * null after a plain (non-aligned) transcription. */
  alignmentConfidence: number | null;

  transcribe: (options?: TranscribeOptions) => Promise<void>;
  cancelTranscribe: () => void;
  clearTranscript: () => void;
  /** Wipe per-source artifacts; called by the facade on source switch. */
  reset: () => void;
}

export function useTranscription(
  selected: StudioSource | null,
  reportError: (msg: string | null) => void,
): Transcription {
  const [transcript, setTranscript] = useState<TranscribeResult | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [alignmentConfidence, setAlignmentConfidence] = useState<number | null>(null);
  const transcribeAbortRef = useRef<AbortController | null>(null);

  // UX-01: whisper transcription is minutes-long — mirror it into the
  // global tray so it stays visible outside the Studio tab.
  useJobMirror({
    active: isTranscribing,
    kind: "transcription",
    originTab: "studio",
    label: selected?.chapter_title ?? "",
  });

  useEffect(() => () => transcribeAbortRef.current?.abort(), []);

  const transcribe = useCallback(
    async (options?: TranscribeOptions) => {
      if (!selected) return;
      const language = options?.language;
      // S2 is only meaningful when the source is a chapter generation; a
      // free-floating audio file has no authoritative script to align.
      const aligned = Boolean(options?.useChapterText && selected.chapter_id);
      const controller = new AbortController();
      transcribeAbortRef.current = controller;
      setIsTranscribing(true);
      reportError(null);
      try {
        if (aligned) {
          const result = await transcribeAligned(
            selected.source_path,
            {
              chapterId: selected.chapter_id as string,
              ...(language ? { language } : {}),
            },
            controller.signal,
          );
          setTranscript(result);
          setAlignmentConfidence(result.alignmentConfidence);
          logger.info("Studio: aligned subtitles from chapter text", {
            source: selected.source_path,
            blocks: result.entries.length,
            confidence: result.alignmentConfidence,
            wordLevel: result.wordLevel,
            engine: result.engine,
          });
        } else {
          const result = await transcribeSource(
            selected.source_path,
            language ? { language } : {},
            controller.signal,
          );
          setTranscript(result);
          setAlignmentConfidence(null);
          logger.info("Studio: transcribed", {
            source: selected.source_path,
            segments: result.entries.length,
            engine: result.engine,
          });
        }
      } catch (err) {
        if (isAbortError(err)) {
          logger.info("Studio: transcribe cancelled");
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          reportError(msg);
          logger.error("Studio: transcribe failed", { error: msg });
        }
      } finally {
        setIsTranscribing(false);
        if (transcribeAbortRef.current === controller) transcribeAbortRef.current = null;
      }
    },
    [selected, reportError],
  );

  const cancelTranscribe = useCallback(() => {
    transcribeAbortRef.current?.abort();
  }, []);

  const clearTranscript = useCallback(() => {
    setTranscript(null);
    setAlignmentConfidence(null);
  }, []);

  const reset = useCallback(() => {
    setTranscript(null);
    setAlignmentConfidence(null);
  }, []);

  return {
    transcript,
    isTranscribing,
    alignmentConfidence,
    transcribe,
    cancelTranscribe,
    clearTranscript,
    reset,
  };
}
