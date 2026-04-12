/**
 * Interactive waveform editor powered by wavesurfer.js.
 *
 * Features:
 * - Click-to-seek waveform with play cursor
 * - Chunk regions (colored zones marking each chunk boundary)
 * - Click a region to select it; double-click to play just that region
 * - Zoom control
 */
import { useEffect, useRef, useState } from "react";

import WaveSurfer from "wavesurfer.js";

import { colors, fonts, radii } from "@/theme/tokens";

export interface ChunkRegion {
  index: number;
  start: number;
  end: number;
  text: string;
}

interface Props {
  audioUrl: string | null;
  regions?: readonly ChunkRegion[];
  selectedChunk?: number | null;
  onChunkSelect?: (index: number) => void;
  height?: number;
}

export function WaveformEditor({
  audioUrl,
  regions = [],
  selectedChunk = null,
  onChunkSelect,
  height = 128,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [zoom, setZoom] = useState(50);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (!containerRef.current || !audioUrl) return;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      height,
      waveColor: "#475569",
      progressColor: "#3b82f6",
      cursorColor: "#f59e0b",
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
      url: audioUrl,
      interact: true,
    });

    ws.on("play", () => setIsPlaying(true));
    ws.on("pause", () => setIsPlaying(false));
    ws.on("finish", () => setIsPlaying(false));
    ws.on("timeupdate", (t: number) => setCurrentTime(t));
    ws.on("ready", () => setDuration(ws.getDuration()));

    wsRef.current = ws;

    return () => {
      ws.destroy();
      wsRef.current = null;
    };
  }, [audioUrl, height]);

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    ws.zoom(zoom);
  }, [zoom]);

  const handlePlayPause = (): void => {
    wsRef.current?.playPause();
  };

  const handleStop = (): void => {
    const ws = wsRef.current;
    if (!ws) return;
    ws.pause();
    ws.setTime(0);
    setCurrentTime(0);
  };

  const handlePlayRegion = (region: ChunkRegion): void => {
    const ws = wsRef.current;
    if (!ws) return;
    ws.setTime(region.start);
    ws.play();
    const checkStop = setInterval(() => {
      if (ws.getCurrentTime() >= region.end) {
        ws.pause();
        clearInterval(checkStop);
      }
    }, 50);
  };

  const formatTime = (s: number): string => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, "0")}`;
  };

  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radii.xl, padding: 16 }}>
      {/* Waveform */}
      <div ref={containerRef} style={{ borderRadius: radii.md, overflow: "hidden" }} />

      {/* Controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
        <button onClick={handlePlayPause} style={ctrlBtn}>
          {isPlaying ? "Pause" : "Play"}
        </button>
        <button onClick={handleStop} style={ctrlBtn}>Stop</button>
        <span style={{ fontSize: 11, fontFamily: fonts.mono, color: colors.textDim, minWidth: 80 }}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
        <label style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto", fontSize: 11, color: colors.textDim }}>
          Zoom
          <input
            type="range"
            min={10}
            max={200}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            style={{ width: 100, accentColor: colors.primary }}
          />
        </label>
      </div>

      {/* Region / chunk list */}
      {regions.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 12 }}>
          {regions.map((r) => {
            const active = selectedChunk === r.index;
            return (
              <button
                key={r.index}
                onClick={() => onChunkSelect?.(r.index)}
                onDoubleClick={() => handlePlayRegion(r)}
                title={r.text.slice(0, 80)}
                style={{
                  padding: "4px 10px",
                  fontSize: 10,
                  fontWeight: 700,
                  fontFamily: fonts.mono,
                  background: active ? colors.primarySoft : colors.surfaceAlt,
                  color: active ? colors.primaryLight : colors.textDim,
                  border: active ? `1px solid ${colors.primaryBorder}` : `1px solid ${colors.borderFaint}`,
                  borderRadius: radii.sm,
                  cursor: "pointer",
                }}
              >
                #{r.index + 1}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const ctrlBtn: React.CSSProperties = {
  padding: "6px 14px",
  fontSize: 11,
  fontWeight: 600,
  background: colors.surfaceAlt,
  color: colors.textDim,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.sm,
  cursor: "pointer",
  fontFamily: fonts.sans,
};
