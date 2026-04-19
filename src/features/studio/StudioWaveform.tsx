/**
 * Studio waveform: wavesurfer.js + regions plugin.
 *
 * Drag-to-select creates a single editable region. The current region's
 * start/end are reported up via ``onRegionChange``. Calling ``clearRegion``
 * (or selecting a new source) wipes the active region.
 */
import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";

import WaveSurfer from "wavesurfer.js";
import RegionsPlugin, { type Region } from "wavesurfer.js/dist/plugins/regions.js";

import { Button } from "@/components/Button";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, typography } from "@/theme/tokens";

export interface StudioRegion {
  startMs: number;
  endMs: number;
}

interface Props {
  t: Translations;
  audioUrl: string | null;
  onRegionChange?: (region: StudioRegion | null) => void;
  height?: number;
}

export interface StudioWaveformHandle {
  clearRegion: () => void;
  getRegion: () => StudioRegion | null;
  getDurationMs: () => number;
}

function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export const StudioWaveform = forwardRef<StudioWaveformHandle, Props>(
  function StudioWaveform({ t, audioUrl, onRegionChange, height = 144 }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const wsRef = useRef<WaveSurfer | null>(null);
    const regionsRef = useRef<RegionsPlugin | null>(null);
    const activeRegionRef = useRef<Region | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [zoom, setZoom] = useState(40);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);

    useImperativeHandle(ref, () => ({
      clearRegion: () => {
        regionsRef.current?.clearRegions();
        activeRegionRef.current = null;
        onRegionChange?.(null);
      },
      getRegion: () => {
        const r = activeRegionRef.current;
        if (!r) return null;
        return { startMs: Math.round(r.start * 1000), endMs: Math.round(r.end * 1000) };
      },
      getDurationMs: () => Math.round(duration * 1000),
    }));

    useEffect(() => {
      if (!containerRef.current || !audioUrl) return;

      const regions = RegionsPlugin.create();
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
        plugins: [regions],
      });

      ws.on("play", () => setIsPlaying(true));
      ws.on("pause", () => setIsPlaying(false));
      ws.on("finish", () => setIsPlaying(false));
      ws.on("timeupdate", (t: number) => setCurrentTime(t));
      ws.on("ready", () => setDuration(ws.getDuration()));

      const disableDrag = regions.enableDragSelection(
        { color: "rgba(59, 130, 246, 0.25)" },
        5,
      );

      const reportRegion = (region: Region): void => {
        activeRegionRef.current = region;
        onRegionChange?.({
          startMs: Math.round(region.start * 1000),
          endMs: Math.round(region.end * 1000),
        });
      };

      regions.on("region-created", (region) => {
        // Single-region mode: clear all others before keeping this one.
        regions.getRegions().forEach((r) => {
          if (r !== region) r.remove();
        });
        reportRegion(region);
      });
      regions.on("region-updated", (region) => reportRegion(region));
      regions.on("region-removed", () => {
        activeRegionRef.current = null;
        onRegionChange?.(null);
      });

      wsRef.current = ws;
      regionsRef.current = regions;

      return () => {
        disableDrag();
        ws.destroy();
        wsRef.current = null;
        regionsRef.current = null;
        activeRegionRef.current = null;
      };
    }, [audioUrl, height, onRegionChange]);

    useEffect(() => {
      wsRef.current?.zoom(zoom);
    }, [zoom]);

    if (!audioUrl) {
      return (
        <div
          style={{
            background: colors.surface,
            border: `1px dashed ${colors.border}`,
            borderRadius: radii.xl,
            padding: 32,
            textAlign: "center",
            color: colors.textDim,
            fontSize: typography.size.sm,
          }}
        >
          {t.studioSelectChapterHint}
        </div>
      );
    }

    return (
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: radii.xl,
          padding: 16,
        }}
      >
        <div ref={containerRef} style={{ borderRadius: radii.md, overflow: "hidden" }} />

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
          <Button variant="secondary" size="sm" onClick={() => wsRef.current?.playPause()}>
            {isPlaying ? t.pause : t.play}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const ws = wsRef.current;
              if (!ws) return;
              ws.pause();
              ws.setTime(0);
              setCurrentTime(0);
            }}
          >
            {t.stop}
          </Button>
          <span
            style={{
              fontSize: typography.size.xs,
              fontFamily: fonts.mono,
              color: colors.textDim,
              minWidth: 90,
            }}
          >
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginLeft: "auto",
              fontSize: typography.size.xs,
              color: colors.textDim,
            }}
          >
            {t.zoom}
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

        <p
          style={{
            margin: "10px 0 0",
            fontSize: typography.size.xs,
            color: colors.textFaint,
          }}
        >
          {t.studioDragHint}
        </p>
      </div>
    );
  },
);
