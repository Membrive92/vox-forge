/** Synthesize a demo phrase with a given voice (or cloned profile) and play it. */
import { useCallback, useRef, useState } from "react";

import { synthesize } from "@/api/synthesis";
import type { Language } from "@/types/domain";

const DEMO_PHRASES: Record<Language, string> = {
  es: "Hola, esta es una demostración de mi voz.",
  en: "Hello, this is a demonstration of my voice.",
};

export interface VoicePreviewState {
  /** Key of the voice being previewed (null if none). For profile previews
   *  this is the profile id; for plain voices, the voice id. */
  previewingId: string | null;
  /** Key currently synthesizing (cloned previews take seconds; the first
   *  one also loads the XTTS model). Cleared when playback starts. */
  loadingId: string | null;
  /** Start or stop the preview. Pass `profileId` to preview a cloned
   *  profile (routes through the clone engine instead of the base voice). */
  toggle: (voiceId: string, lang: Language, profileId?: string) => void;
}

export function useVoicePreview(): VoicePreviewState {
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  // Invalida promesas de síntesis en vuelo cuando el usuario para o cambia
  // de voz antes de que terminen (evita que la vieja suene sobre la nueva).
  const seqRef = useRef(0);

  const cleanup = useCallback(() => {
    seqRef.current++;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setPreviewingId(null);
    setLoadingId(null);
  }, []);

  const toggle = useCallback(
    (voiceId: string, lang: Language, profileId?: string) => {
      const key = profileId ?? voiceId;

      // If this voice is already playing or synthesizing, stop it
      if (previewingId === key) {
        cleanup();
        return;
      }

      // Stop previous preview if any
      cleanup();
      setPreviewingId(key);
      setLoadingId(key);
      const seq = ++seqRef.current;

      const text = DEMO_PHRASES[lang];

      void synthesize({
        text,
        voiceId,
        format: "mp3",
        speed: 100,
        pitch: 0,
        volume: 80,
        ...(profileId !== undefined ? { profileId } : {}),
      })
        .then(({ blob }) => {
          if (seq !== seqRef.current) return; // superseded or stopped
          const url = URL.createObjectURL(blob);
          urlRef.current = url;
          const audio = new Audio(url);
          audioRef.current = audio;
          audio.onended = cleanup;
          audio.onerror = cleanup;
          setLoadingId(null);
          void audio.play();
        })
        .catch(() => {
          if (seq === seqRef.current) cleanup();
        });
    },
    [previewingId, cleanup],
  );

  return { previewingId, loadingId, toggle };
}
