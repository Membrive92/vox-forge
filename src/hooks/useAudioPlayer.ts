import { useCallback, useEffect, useRef, useState } from "react";

export interface AudioPlayerState {
  audioRef: React.RefObject<HTMLAudioElement>;
  url: string | null;
  duration: number;
  isPlaying: boolean;
  load: (blob: Blob, duration: number) => void;
  toggle: () => void;
  stop: () => void;
  setIsPlaying: (v: boolean) => void;
}

export function useAudioPlayer(): AudioPlayerState {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const currentUrlRef = useRef<string | null>(null);

  // Revoke any remaining URL on unmount
  useEffect(() => {
    return () => {
      if (currentUrlRef.current) {
        URL.revokeObjectURL(currentUrlRef.current);
        currentUrlRef.current = null;
      }
    };
  }, []);

  const load = useCallback((blob: Blob, dur: number) => {
    if (currentUrlRef.current) {
      URL.revokeObjectURL(currentUrlRef.current);
    }
    const newUrl = URL.createObjectURL(blob);
    currentUrlRef.current = newUrl;
    setUrl(newUrl);
    setDuration(dur);
    setIsPlaying(false);
  }, []);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el || !url) return;
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
  }, [url]);

  const stop = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    el.currentTime = 0;
  }, []);

  return { audioRef, url, duration, isPlaying, load, toggle, stop, setIsPlaying };
}
