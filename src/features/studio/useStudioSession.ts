import { useCallback, useEffect, useRef, useState } from "react";

import {
  applyEdit,
  listStudioSources,
  type StudioOperation,
  type StudioSource,
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
  download: (filenameHint?: string) => void;
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

  useEffect(() => () => {
    if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
  }, []);

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
      setIsProcessing(true);
      setError(null);
      try {
        logger.info("Studio: applying edit", {
          source: selected.source_path,
          ops: operations.length,
          format: outputFormat,
        });
        const result = await applyEdit(selected.source_path, operations, outputFormat);
        if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
        const url = URL.createObjectURL(result.blob);
        lastUrlRef.current = url;
        setResultBlob(result.blob);
        setResultUrl(url);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        logger.error("Studio: apply failed", { error: msg });
      } finally {
        setIsProcessing(false);
      }
    },
    [selected, operations],
  );

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
    },
    refreshSources,
    selectSource,
    addOperation,
    removeOperation,
    moveOperation,
    clearOperations,
    apply,
    download,
  };
}
