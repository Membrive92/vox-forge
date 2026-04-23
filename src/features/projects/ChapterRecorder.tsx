import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/Button";
import * as Icons from "@/components/icons";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, typography } from "@/theme/tokens";

interface Props {
  t: Translations;
  onSave: (file: File) => Promise<void> | void;
  onCancel: () => void;
  isSaving?: boolean;
}

type RecState = "idle" | "recording" | "paused" | "stopped";

function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** In-app chapter recorder.
 *
 * Captures mic input via ``MediaRecorder``, tracks elapsed time (accounting
 * for pauses), draws a live input-level bar from an ``AnalyserNode``, and
 * hands the final Blob to the parent as a ``File`` for upload. */
export function ChapterRecorder({ t, onSave, onCancel, isSaving = false }: Props) {
  const [state, setState] = useState<RecState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);
  const accumMsRef = useRef<number>(0);

  useEffect(() => () => cleanup(), []);

  const cleanup = (): void => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try { mediaRecorderRef.current.stop(); } catch { /* ignore */ }
    }
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close();
    audioCtxRef.current = null;
    analyserRef.current = null;
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
  };

  const start = async (): Promise<void> => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Live input-level meter. ``AnalyserNode`` is cheaper than
      // re-computing from recorded chunks and updates smoothly.
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserRef.current = analyser;

      const buf = new Uint8Array(analyser.frequencyBinCount);
      const loop = (): void => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(buf);
        // Peak absolute deviation from 128 (silence centre) → 0-1
        let peak = 0;
        for (const v of buf) {
          const d = Math.abs(v - 128);
          if (d > peak) peak = d;
        }
        setLevel(Math.min(1, peak / 128));
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);

      const rec = new MediaRecorder(stream);
      mediaRecorderRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const type = chunksRef.current[0]?.type || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(URL.createObjectURL(blob));
      };

      rec.start(500);
      startedAtRef.current = Date.now();
      accumMsRef.current = 0;
      timerRef.current = window.setInterval(() => {
        if (mediaRecorderRef.current?.state === "recording") {
          setElapsedMs(accumMsRef.current + (Date.now() - startedAtRef.current));
        }
      }, 100);
      setState("recording");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const pause = (): void => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.pause();
      accumMsRef.current += Date.now() - startedAtRef.current;
      setState("paused");
    }
  };

  const resume = (): void => {
    if (mediaRecorderRef.current?.state === "paused") {
      mediaRecorderRef.current.resume();
      startedAtRef.current = Date.now();
      setState("recording");
    }
  };

  const stop = (): void => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      if (mediaRecorderRef.current.state === "recording") {
        accumMsRef.current += Date.now() - startedAtRef.current;
      }
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    setLevel(0);
    setElapsedMs(accumMsRef.current);
    setState("stopped");
  };

  const discard = (): void => {
    chunksRef.current = [];
    accumMsRef.current = 0;
    setElapsedMs(0);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setState("idle");
  };

  const save = async (): Promise<void> => {
    const type = chunksRef.current[0]?.type || "audio/webm";
    const ext = type.includes("webm") ? "webm" : type.includes("mp4") ? "m4a" : "wav";
    const blob = new Blob(chunksRef.current, { type });
    const file = new File([blob], `recording.${ext}`, { type });
    await onSave(file);
  };

  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: radii.xl,
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {/* Header + timer */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            background:
              state === "recording"
                ? "#ef4444"
                : state === "paused"
                  ? "#f59e0b"
                  : state === "stopped"
                    ? "#22c55e"
                    : colors.textFaint,
            boxShadow: state === "recording" ? "0 0 8px #ef4444" : "none",
          }}
        />
        <span
          style={{
            fontSize: typography.size.xl,
            fontFamily: fonts.mono,
            fontWeight: 700,
            color: colors.text,
          }}
        >
          {formatTime(elapsedMs)}
        </span>
        <span style={{ fontSize: typography.size.xs, color: colors.textDim, marginLeft: "auto" }}>
          {state === "recording"
            ? t.recorderRecording
            : state === "paused"
              ? t.recorderPaused
              : state === "stopped"
                ? t.recorderStopped
                : t.recorderIdle}
        </span>
      </div>

      {/* Level meter */}
      <div
        style={{
          height: 8,
          background: colors.surfaceAlt,
          borderRadius: radii.sm,
          overflow: "hidden",
          border: `1px solid ${colors.borderFaint}`,
        }}
      >
        <div
          style={{
            width: `${Math.round(level * 100)}%`,
            height: "100%",
            background:
              level > 0.9
                ? "#ef4444"
                : level > 0.6
                  ? "#f59e0b"
                  : colors.primary,
            transition: "width 80ms linear, background 120ms ease",
          }}
        />
      </div>

      {error && (
        <div style={{ fontSize: typography.size.sm, color: colors.danger }}>
          {error}
        </div>
      )}

      {/* Preview player (shown once stopped) */}
      {previewUrl && state === "stopped" && (
        <audio controls src={previewUrl} style={{ width: "100%" }} />
      )}

      {/* Controls */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {state === "idle" && (
          <>
            <Button variant="danger" onClick={() => void start()}>
              {t.recorderStart}
            </Button>
            <Button variant="ghost" onClick={onCancel}>
              {t.cancel}
            </Button>
          </>
        )}
        {state === "recording" && (
          <>
            <Button variant="secondary" onClick={pause}>
              {t.recorderPause}
            </Button>
            <Button variant="primary" onClick={stop}>
              {t.recorderStop}
            </Button>
          </>
        )}
        {state === "paused" && (
          <>
            <Button variant="danger" onClick={resume}>
              {t.recorderResume}
            </Button>
            <Button variant="primary" onClick={stop}>
              {t.recorderStop}
            </Button>
          </>
        )}
        {state === "stopped" && (
          <>
            <Button
              variant="primary"
              loading={isSaving}
              onClick={() => void save()}
            >
              {t.recorderSave}
            </Button>
            <Button variant="ghost" onClick={discard} disabled={isSaving}>
              {t.recorderDiscard}
            </Button>
          </>
        )}
      </div>

      {elapsedMs > 60 * 60 * 1000 && state !== "stopped" && (
        <p
          style={{
            margin: 0,
            fontSize: typography.size.xs,
            color: "#f59e0b",
            fontFamily: fonts.mono,
          }}
        >
          <Icons.Mic /> {t.recorderLongWarning}
        </p>
      )}
    </div>
  );
}
