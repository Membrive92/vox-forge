import { useCallback, useEffect, useState } from "react";

import {
  getChunkMap,
  regenerateChunk,
  synthesizeChapter,
  type ChapterSynthResult,
  type ChunkInfo,
} from "@/api/chapterSynth";
import { InteractivePlayer } from "@/components/InteractivePlayer";
import * as Icons from "@/components/icons";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { colors, fonts, radii } from "@/theme/tokens";

interface Props {
  chapterId: string;
  chapterTitle: string;
  onToast: (msg: string) => void;
}

export function ChunkMap({ chapterId, chapterTitle, onToast }: Props) {
  const [chunks, setChunks] = useState<ChunkInfo[]>([]);
  const [genId, setGenId] = useState<string | null>(null);
  const [synthesizing, setSynthesizing] = useState(false);
  const [regenIndex, setRegenIndex] = useState<number | null>(null);
  const player = useAudioPlayer();

  const loadMap = useCallback(async () => {
    try {
      const data = await getChunkMap(chapterId);
      setChunks(data.chunks);
      setGenId(data.generation_id);
    } catch { /* first time — no generation yet */ }
  }, [chapterId]);

  useEffect(() => { void loadMap(); }, [loadMap]);

  const handleSynthesize = async (): Promise<void> => {
    setSynthesizing(true);
    try {
      const result: ChapterSynthResult = await synthesizeChapter(chapterId);
      player.load(result.blob, result.duration);
      setGenId(result.generationId);
      onToast(`${chapterTitle} synthesized (${result.chunks} chunks, ${result.engine})`);
      await loadMap();
    } catch (e) {
      onToast(`Error: ${e instanceof Error ? e.message : "Unknown"}`);
    } finally {
      setSynthesizing(false);
    }
  };

  const handleRegen = async (index: number): Promise<void> => {
    setRegenIndex(index);
    try {
      await regenerateChunk(chapterId, index);
      onToast(`Chunk ${index + 1} regenerated`);
      await loadMap();
    } catch (e) {
      onToast(`Error: ${e instanceof Error ? e.message : "Unknown"}`);
    } finally {
      setRegenIndex(null);
    }
  };

  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: radii.xl,
        padding: 20,
        backdropFilter: "blur(12px)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>
          Chunk Map — {chapterTitle}
        </h4>
        <button
          onClick={() => void handleSynthesize()}
          disabled={synthesizing}
          style={{
            padding: "8px 18px",
            background: synthesizing ? colors.textDark : "linear-gradient(135deg, #3b82f6, #2563eb)",
            color: "#fff",
            border: "none",
            borderRadius: radii.md,
            fontSize: 13,
            fontWeight: 700,
            cursor: synthesizing ? "default" : "pointer",
            fontFamily: fonts.sans,
            opacity: synthesizing ? 0.5 : 1,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Icons.Waveform />
          {synthesizing ? "Synthesizing..." : "Synthesize Chapter"}
        </button>
      </div>

      {/* Player for the full chapter audio */}
      {player.url && (
        <div style={{ marginBottom: 16 }}>
          <audio
            ref={player.audioRef}
            src={player.url}
            onPlay={() => player.setIsPlaying(true)}
            onPause={() => player.setIsPlaying(false)}
            onEnded={() => player.setIsPlaying(false)}
            style={{ display: "none" }}
          />
          <InteractivePlayer player={player} playLabel="Play" pauseLabel="Pause" stopLabel="Stop" />
        </div>
      )}

      {/* Chunk list */}
      {chunks.length === 0 ? (
        <p style={{ fontSize: 12, color: colors.textDim, textAlign: "center", padding: 20 }}>
          {genId ? "No chunks recorded" : "Click 'Synthesize Chapter' to generate audio"}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 500, overflowY: "auto" }}>
          {chunks.map((chunk) => {
            const isRegen = regenIndex === chunk.index;
            const statusColor =
              chunk.status === "done" ? "#34d399"
              : chunk.status === "error" ? "#f87171"
              : colors.textDim;
            return (
              <div
                key={chunk.index}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  padding: "10px 12px",
                  background: colors.surfaceSubtle,
                  border: `1px solid ${colors.borderFaint}`,
                  borderRadius: radii.sm,
                }}
              >
                <div
                  style={{
                    minWidth: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: `${statusColor}22`,
                    color: statusColor,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    fontWeight: 700,
                    fontFamily: fonts.mono,
                    flexShrink: 0,
                  }}
                >
                  {chunk.index + 1}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 11,
                      color: colors.textDim,
                      lineHeight: 1.5,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {chunk.text}
                  </p>
                </div>
                <button
                  onClick={() => void handleRegen(chunk.index)}
                  disabled={isRegen || !genId}
                  title={`Regenerate chunk ${chunk.index + 1}`}
                  style={{
                    padding: "6px 12px",
                    fontSize: 10,
                    fontWeight: 600,
                    background: isRegen ? colors.textDark : "rgba(245,158,11,0.1)",
                    color: isRegen ? colors.textFaint : "#f59e0b",
                    border: "1px solid rgba(245,158,11,0.2)",
                    borderRadius: radii.sm,
                    cursor: isRegen || !genId ? "default" : "pointer",
                    fontFamily: fonts.sans,
                    opacity: genId ? 1 : 0.3,
                    flexShrink: 0,
                  }}
                >
                  {isRegen ? "..." : "Regen"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
