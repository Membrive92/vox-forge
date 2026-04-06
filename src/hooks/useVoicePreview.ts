/** Synthesize a demo phrase with a given voice and play it. */
import { useCallback, useRef, useState } from "react";

import { synthesize } from "@/api/synthesis";
import type { Language } from "@/types/domain";

const DEMO_PHRASES: Record<Language, string> = {
  es: "Hola, esta es una demostración de mi voz.",
  en: "Hello, this is a demonstration of my voice.",
};

export interface VoicePreviewState {
  /** ID of the voice being previewed (null if none). */
  previewingId: string | null;
  /** Start or stop the voice preview. */
  toggle: (voiceId: string, lang: Language) => void;
}

export function useVoicePreview(): VoicePreviewState {
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  const cleanup = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setPreviewingId(null);
  }, []);

  const toggle = useCallback(
    (voiceId: string, lang: Language) => {
      // If this voice is already playing, stop it
      if (previewingId === voiceId) {
        cleanup();
        return;
      }

      // Stop previous preview if any
      cleanup();
      setPreviewingId(voiceId);

      const text = DEMO_PHRASES[lang];

      void synthesize({
        text,
        voiceId,
        format: "mp3",
        speed: 100,
        pitch: 0,
        volume: 80,
      })
        .then(({ blob }) => {
          const url = URL.createObjectURL(blob);
          urlRef.current = url;
          const audio = new Audio(url);
          audioRef.current = audio;
          audio.onended = cleanup;
          audio.onerror = cleanup;
          void audio.play();
        })
        .catch(() => {
          cleanup();
        });
    },
    [previewingId, cleanup],
  );

  return { previewingId, toggle };
}
