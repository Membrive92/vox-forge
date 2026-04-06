/** Reproduce muestras de audio almacenadas en el backend. */
import { useCallback, useRef, useState } from "react";

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

  return { playingFilename, toggle };
}
