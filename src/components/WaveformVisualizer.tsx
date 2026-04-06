import { useEffect, useRef } from "react";

interface WaveformVisualizerProps {
  isPlaying: boolean;
  isGenerated: boolean;
}

const BAR_COUNT = 64;

export function WaveformVisualizer({ isPlaying, isGenerated }: WaveformVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animRef = useRef<number | null>(null);
  const barsRef = useRef<number[]>(
    Array.from({ length: BAR_COUNT }, () => Math.random() * 0.3 + 0.1),
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const W = rect.width;
    const H = rect.height;

    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      const bars = barsRef.current;
      const barW = W / bars.length;
      const gap = 1;

      for (let i = 0; i < bars.length; i++) {
        const current = bars[i] ?? 0.15;
        let next: number;
        if (isPlaying) {
          next = Math.sin(Date.now() * 0.003 + i * 0.4) * 0.35 + 0.5 + Math.random() * 0.15;
        } else if (isGenerated) {
          next = Math.sin(i * 0.3) * 0.2 + 0.3 + Math.random() * 0.05;
        } else {
          next = current + (0.15 - current) * 0.05;
        }
        bars[i] = next;

        const h = next * H * 0.8;
        const x = i * barW + gap;
        const y = (H - h) / 2;
        const colorA = isPlaying ? "#f97316" : isGenerated ? "#3b82f6" : "#334155";
        const colorB = isPlaying ? "#fb923c" : isGenerated ? "#60a5fa" : "#475569";
        const gradient = ctx.createLinearGradient(x, y, x, y + h);
        gradient.addColorStop(0, colorA);
        gradient.addColorStop(0.5, colorB);
        gradient.addColorStop(1, colorA);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(x, y, barW - gap * 2, h, 2);
        ctx.fill();
      }
      animRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      if (animRef.current !== null) cancelAnimationFrame(animRef.current);
    };
  }, [isPlaying, isGenerated]);

  return <canvas ref={canvasRef} style={{ width: "100%", height: 80, display: "block" }} />;
}
