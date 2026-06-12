import { useCallback, useEffect, useRef, useState } from "react";

import { isAbortError } from "@/api/client";
import { applyEdit, type StudioOperation, type StudioSource } from "@/api/studio";
import { logger } from "@/logging/logger";
import { downloadUrl } from "@/utils/download";

/**
 * The edit half of a Studio session: the operation queue plus the
 * apply/preview pipeline and its downloadable result. One of the three
 * focused hooks composed by ``useStudioSession`` (MED-ARQ-4).
 */
export interface EditSession {
  operations: StudioOperation[];
  isProcessing: boolean;
  resultBlob: Blob | null;
  resultUrl: string | null;
  isPreviewMode: boolean;

  addOperation: (op: StudioOperation) => void;
  removeOperation: (index: number) => void;
  moveOperation: (from: number, to: number) => void;
  clearOperations: () => void;
  apply: (outputFormat: string) => Promise<void>;
  applyPreview: (outputFormat: string) => Promise<void>;
  cancelApply: () => void;
  download: (filenameHint?: string) => void;
  /** Wipe per-source artifacts; called by the facade on source switch. */
  reset: () => void;
}

export function useEditSession(
  selected: StudioSource | null,
  reportError: (msg: string | null) => void,
): EditSession {
  const [operations, setOperations] = useState<StudioOperation[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const lastUrlRef = useRef<string | null>(null);

  // Abort controller for the in-flight apply. Kept in a ref so cancel
  // can signal the fetch without re-rendering.
  const applyAbortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
      applyAbortRef.current?.abort();
    },
    [],
  );

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

  // apply() and applyPreview() differ only in the isPreviewMode flag, so
  // they share one implementation.
  const runApply = useCallback(
    async (outputFormat: string, preview: boolean) => {
      if (!selected || operations.length === 0) return;
      const controller = new AbortController();
      applyAbortRef.current = controller;
      setIsProcessing(true);
      reportError(null);
      if (!preview) setIsPreviewMode(false);
      try {
        logger.info(preview ? "Studio: applying edit preview" : "Studio: applying edit", {
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
        if (preview) setIsPreviewMode(true);
      } catch (err) {
        if (isAbortError(err)) {
          logger.info(preview ? "Studio: apply preview cancelled" : "Studio: apply cancelled");
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          reportError(msg);
          logger.error(preview ? "Studio: apply preview failed" : "Studio: apply failed", { error: msg });
        }
      } finally {
        setIsProcessing(false);
        if (applyAbortRef.current === controller) applyAbortRef.current = null;
      }
    },
    [selected, operations, reportError],
  );

  const apply = useCallback((outputFormat: string) => runApply(outputFormat, false), [runApply]);
  const applyPreview = useCallback((outputFormat: string) => runApply(outputFormat, true), [runApply]);

  const cancelApply = useCallback(() => {
    applyAbortRef.current?.abort();
  }, []);

  const download = useCallback(
    (filenameHint?: string) => {
      if (!resultBlob || !resultUrl) return;
      downloadUrl(resultUrl, filenameHint ?? `studio_edit_${Date.now()}.mp3`);
    },
    [resultBlob, resultUrl],
  );

  const reset = useCallback(() => {
    setOperations([]);
    setResultBlob(null);
    if (lastUrlRef.current) {
      URL.revokeObjectURL(lastUrlRef.current);
      lastUrlRef.current = null;
    }
    setResultUrl(null);
  }, []);

  return {
    operations,
    isProcessing,
    resultBlob,
    resultUrl,
    isPreviewMode,
    addOperation,
    removeOperation,
    moveOperation,
    clearOperations,
    apply,
    applyPreview,
    cancelApply,
    download,
    reset,
  };
}
