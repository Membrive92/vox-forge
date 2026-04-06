import { useCallback, useRef, useState } from "react";

import { synthesize } from "@/api/synthesis";
import type { SynthesisParams } from "@/types/domain";

export interface SynthesisState {
  isGenerating: boolean;
  isGenerated: boolean;
  progress: number;
  stepLabel: string;
  reset: () => void;
}

const STEP_INTERVAL_MS = 600;

export interface RunSynthesisOptions {
  params: SynthesisParams;
  steps: readonly string[];
  onSuccess: (blob: Blob, duration: number) => void;
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
  const intervalRef = useRef<number | null>(null);

  const clearInterval = useCallback(() => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    clearInterval();
    setIsGenerating(false);
    setIsGenerated(false);
    setProgress(0);
    setStepLabel("");
  }, [clearInterval]);

  const run = useCallback(
    async ({ params, steps, onSuccess, onError }: RunSynthesisOptions) => {
      if (!params.text.trim()) return;
      setIsGenerating(true);
      setIsGenerated(false);
      setProgress(0);
      setStepLabel(steps[0] ?? "");

      let stepIdx = 0;
      intervalRef.current = window.setInterval(() => {
        stepIdx = Math.min(stepIdx + 1, steps.length - 1);
        setStepLabel(steps[stepIdx] ?? "");
        setProgress(Math.min(95, ((stepIdx + 1) / steps.length) * 90));
      }, STEP_INTERVAL_MS);

      try {
        const { blob, duration } = await synthesize(params);
        clearInterval();
        setProgress(100);
        setIsGenerating(false);
        setIsGenerated(true);
        onSuccess(blob, duration);
      } catch (e) {
        clearInterval();
        setIsGenerating(false);
        setProgress(0);
        onError(e instanceof Error ? e.message : "Error desconocido");
      }
    },
    [clearInterval],
  );

  return { isGenerating, isGenerated, progress, stepLabel, reset, run };
}
