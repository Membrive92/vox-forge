import { useCallback, useEffect, useRef, useState } from "react";

export interface AudioPlayerState {
  audioRef: React.RefObject<HTMLAudioElement>;
  url: string | null;
  duration: number;
  currentTime: number;
  playbackRate: number;
  isPlaying: boolean;
  load: (blob: Blob, duration: number) => void;
  toggle: () => void;
  stop: () => void;
  seek: (time: number) => void;
  skip: (deltaSeconds: number) => void;
  setRate: (rate: number) => void;
  setIsPlaying: (v: boolean) => void;
}

export function useAudioPlayer(): AudioPlayerState {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
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

  // Subscribe to time updates on the audio element
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = (): void => setCurrentTime(el.currentTime);
    const onMeta = (): void => {
      if (Number.isFinite(el.duration) && el.duration > 0) setDuration(el.duration);
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("durationchange", onMeta);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("durationchange", onMeta);
    };
  }, [url]);

  // Keep the element's rate in sync with state
  useEffect(() => {
    const el = audioRef.current;
    if (el) el.playbackRate = playbackRate;
  }, [playbackRate, url]);

  const load = useCallback((blob: Blob, dur: number) => {
    if (currentUrlRef.current) {
      URL.revokeObjectURL(currentUrlRef.current);
    }
    const newUrl = URL.createObjectURL(blob);
    currentUrlRef.current = newUrl;
    setUrl(newUrl);
    setDuration(dur);
    setCurrentTime(0);
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
    setCurrentTime(0);
  }, []);

  const seek = useCallback((time: number) => {
    const el = audioRef.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(time, el.duration || time));
    el.currentTime = clamped;
    setCurrentTime(clamped);
  }, []);

  const skip = useCallback((delta: number) => {
    const el = audioRef.current;
    if (!el) return;
    const target = Math.max(0, Math.min(el.currentTime + delta, el.duration || el.currentTime + delta));
    el.currentTime = target;
    setCurrentTime(target);
  }, []);

  const setRate = useCallback((rate: number) => {
    setPlaybackRate(Math.max(0.5, Math.min(2, rate)));
  }, []);

  return {
    audioRef, url, duration, currentTime, playbackRate, isPlaying,
    load, toggle, stop, seek, skip, setRate, setIsPlaying,
  };
}
