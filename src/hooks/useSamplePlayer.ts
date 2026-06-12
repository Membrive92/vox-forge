/** Play audio samples stored in the backend. */
import { useCallback, useMemo, useRef, useState } from "react";

import { API_BASE } from "@/api/client";

export interface SamplePlayerState {
  playingFilename: string | null;
  toggle: (filename: string) => void;
}

export function useSamplePlayer(): SamplePlayerState {
  const [playingFilename, setPlayingFilename] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const cleanup = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingFilename(null);
  }, []);

  const toggle = useCallback(
    (filename: string) => {
      if (playingFilename === filename) {
        cleanup();
        return;
      }
      cleanup();
      setPlayingFilename(filename);

      const audio = new Audio(`${API_BASE}/voices/samples/${filename}`);
      audioRef.current = audio;
      audio.onended = cleanup;
      audio.onerror = cleanup;
      void audio.play();
    },
    [playingFilename, cleanup],
  );

  // Identidad estable: los consumidores via contexto solo re-renderizan
  // cuando cambia el estado real, no en cada render del provider (BAJO-12).
  return useMemo(() => ({ playingFilename, toggle }), [playingFilename, toggle]);
}
