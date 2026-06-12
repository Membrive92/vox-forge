import { useCallback, useEffect, useRef, useState } from "react";

import { isAbortError } from "@/api/client";
import { transcribeSource, type StudioSource, type TranscribeResult } from "@/api/studio";
import { logger } from "@/logging/logger";

/**
 * The transcription half of a Studio session (Phase B.1). One of the
 * three focused hooks composed by ``useStudioSession`` (MED-ARQ-4).
 */
export interface Transcription {
  transcript: TranscribeResult | null;
  isTranscribing: boolean;

  transcribe: (language?: string) => Promise<void>;
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
  const transcribeAbortRef = useRef<AbortController | null>(null);

  useEffect(() => () => transcribeAbortRef.current?.abort(), []);

  const transcribe = useCallback(
    async (language?: string) => {
      if (!selected) return;
      const controller = new AbortController();
      transcribeAbortRef.current = controller;
      setIsTranscribing(true);
      reportError(null);
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

  const clearTranscript = useCallback(() => setTranscript(null), []);

  const reset = useCallback(() => setTranscript(null), []);

  return {
    transcript,
    isTranscribing,
    transcribe,
    cancelTranscribe,
    clearTranscript,
    reset,
  };
}
