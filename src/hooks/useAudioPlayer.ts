import { useCallback, useEffect, useRef, useState } from "react";

export interface AudioPlayerState {
  audioRef: React.RefObject<HTMLAudioElement>;
  url: string | null;
  duration: number;
  currentTime: number;
  playbackRate: number;
  isPlaying: boolean;
  load: (blob: Blob, duration: number) => void;
  unload: () => void;
  toggle: () => void;
  stop: () => void;
  seek: (time: number) => void;
  skip: (deltaSeconds: number) => void;
  setRate: (rate: number) => void;
  setIsPlaying: (v: boolean) => void;
}

// How often ``currentTime`` state commits during playback. ``timeupdate``
// fires 4-66Hz per element and every consumer of the hook re-renders its
// whole subtree on each commit (MED-PERF-F2). Same pattern as the
// wavesurfer throttle in StudioWaveform.
const TIMEUPDATE_THROTTLE_MS = 150;

export function useAudioPlayer(): AudioPlayerState {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const currentUrlRef = useRef<string | null>(null);
  const latestTimeRef = useRef(0);
  const throttleTimerRef = useRef<number | null>(null);

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
    const onTime = (): void => {
      latestTimeRef.current = el.currentTime;
      // Track every event in the ref but commit state at most every
      // TIMEUPDATE_THROTTLE_MS; the trailing timeout always publishes
      // the latest value, so the final position is never lost.
      if (throttleTimerRef.current === null) {
        throttleTimerRef.current = window.setTimeout(() => {
          throttleTimerRef.current = null;
          setCurrentTime(latestTimeRef.current);
        }, TIMEUPDATE_THROTTLE_MS);
      }
    };
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
      if (throttleTimerRef.current !== null) {
        window.clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
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

  const unload = useCallback(() => {
    if (currentUrlRef.current) {
      URL.revokeObjectURL(currentUrlRef.current);
      currentUrlRef.current = null;
    }
    setUrl(null);
    setDuration(0);
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
    load, unload, toggle, stop, seek, skip, setRate, setIsPlaying,
  };
}
