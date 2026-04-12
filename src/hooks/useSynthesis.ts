import { useCallback, useEffect, useRef, useState } from "react";

import { fetchProgress, newJobId, synthesize } from "@/api/synthesis";
import type { SynthesisParams } from "@/types/domain";

export interface SynthesisState {
  isGenerating: boolean;
  isGenerated: boolean;
  progress: number;
  stepLabel: string;
  chunksDone: number;
  chunksTotal: number;
  lastEngine: string | null;
  reset: () => void;
}

const POLL_INTERVAL_MS = 800;

export interface RunSynthesisOptions {
  params: SynthesisParams;
  steps: readonly string[];
  onSuccess: (blob: Blob, duration: number, engine: string) => void;
  onError: (message: string) => void;
}

export interface SynthesisHook extends SynthesisState {
  run: (opts: RunSynthesisOptions) => Promise<void>;
}

export function useSynthesis(): SynthesisHook {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGenerated, setIsGenerated] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stepLabel, setStepLabel] = useState("");
  const [chunksDone, setChunksDone] = useState(0);
  const [chunksTotal, setChunksTotal] = useState(0);
  const [lastEngine, setLastEngine] = useState<string | null>(null);
  const intervalRef = useRef<number | null>(null);

  const clearPoll = useCallback(() => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => clearPoll();
  }, [clearPoll]);

  const reset = useCallback(() => {
    clearPoll();
    setIsGenerating(false);
    setIsGenerated(false);
    setProgress(0);
    setStepLabel("");
    setChunksDone(0);
    setChunksTotal(0);
    setLastEngine(null);
  }, [clearPoll]);

  const runningRef = useRef(false);

  const run = useCallback(
    async ({ params, steps, onSuccess, onError }: RunSynthesisOptions) => {
      if (!params.text.trim()) return;
      if (runningRef.current) return;
      runningRef.current = true;
      setIsGenerating(true);
      setIsGenerated(false);
      setProgress(0);
      setChunksDone(0);
      setChunksTotal(0);
      setLastEngine(null);
      setStepLabel(steps[0] ?? "");

      const jobId = newJobId();

      // Poll progress every 800ms. Backend reports chunks_done/chunks_total.
      intervalRef.current = window.setInterval(() => {
        void fetchProgress(jobId)
          .then((p) => {
            setChunksDone(p.chunks_done);
            setChunksTotal(p.chunks_total);
            if (p.current_step) setStepLabel(p.current_step);
            if (p.chunks_total > 0) {
              // Reserve the last 5% for export/finalize after the HTTP returns.
              setProgress(Math.min(95, (p.chunks_done / p.chunks_total) * 95));
            }
          })
          .catch(() => {
            // Job may not be registered yet, or finished already — harmless.
          });
      }, POLL_INTERVAL_MS);

      try {
        const { blob, duration, engine } = await synthesize(params, jobId);
        clearPoll();
        setProgress(100);
        setIsGenerating(false);
        setIsGenerated(true);
        setLastEngine(engine);
        runningRef.current = false;
        onSuccess(blob, duration, engine);
      } catch (e) {
        clearPoll();
        setIsGenerating(false);
        setProgress(0);
        runningRef.current = false;
        onError(e instanceof Error ? e.message : "Unknown error");
      }
    },
    [clearPoll],
  );

  return {
    isGenerating, isGenerated, progress, stepLabel,
    chunksDone, chunksTotal, lastEngine, reset, run,
  };
}
