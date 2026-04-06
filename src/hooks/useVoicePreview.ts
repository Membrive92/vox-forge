/** Sintetiza una frase demo con una voz dada y la reproduce. */
import { useCallback, useRef, useState } from "react";

import { synthesize } from "@/api/synthesis";
import type { Language } from "@/types/domain";

const DEMO_PHRASES: Record<Language, string> = {
  es: "Hola, esta es una demostración de mi voz.",
  en: "Hello, this is a demonstration of my voice.",
};

export interface VoicePreviewState {
  /** ID de la voz que se está previsualizando (null si ninguna). */
  previewingId: string | null;
  /** Inicia o detiene la preview de una voz. */
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
      // Si ya está sonando esta voz, detener
      if (previewingId === voiceId) {
        cleanup();
        return;
      }

      // Detener preview anterior si hay
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
