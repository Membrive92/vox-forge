import { useCallback, useRef, useState } from "react";

import { colors, fonts, radii, typography } from "@/theme/tokens";

import * as Icons from "./icons";

interface AudioRecorderProps {
  onRecorded: (file: File) => void;
  labelRecord: string;
  labelStop: string;
  labelRecording: string;
}

export function AudioRecorder({ onRecorded, labelRecord, labelStop, labelRecording }: AudioRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const file = new File([blob], `recording_${Date.now()}.webm`, { type: "audio/webm" });
        onRecorded(file);
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start(100);
      setIsRecording(true);
      setSeconds(0);
      timerRef.current = window.setInterval(() => {
        setSeconds((s) => s + 1);
      }, 1000);
    } catch {
      // Mic permission denied or not available
    }
  }, [onRecorded]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [isRecording]);

  const formatTime = (s: number): string => {
    const min = Math.floor(s / 60);
    const sec = s % 60;
    return `${min}:${String(sec).padStart(2, "0")}`;
  };

  return (
    <button
      onClick={isRecording ? stopRecording : () => void startRecording()}
      aria-label={isRecording ? labelRecording : labelRecord}
      style={{
        width: "100%",
        padding: "12px 0",
        borderRadius: radii.lg,
        background: isRecording
          ? "linear-gradient(135deg, #ef4444, #dc2626)"
          : colors.surfaceAlt,
        border: isRecording
          ? "1px solid #ef4444"
          : `1px solid ${colors.border}`,
        color: isRecording ? "#fff" : colors.textMuted,
        cursor: "pointer",
        fontSize: typography.size.sm,
        fontWeight: 600,
        fontFamily: fonts.sans,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        transition: "all 0.2s",
        boxShadow: isRecording ? "0 4px 16px rgba(239,68,68,0.3)" : "none",
      }}
    >
      {isRecording ? (
        <>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#fff",
              animation: "pulse 1s infinite",
            }}
          />
          {labelStop} · {formatTime(seconds)}
          <style>{`@keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.3 } }`}</style>
        </>
      ) : (
        <>
          <Icons.Mic />
          {labelRecord}
        </>
      )}
    </button>
  );
}
