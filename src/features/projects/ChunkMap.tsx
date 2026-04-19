import { useCallback, useEffect, useState } from "react";

import {
  getChunkMap,
  regenerateChunk,
  synthesizeChapter,
  type ChapterSynthResult,
  type ChunkInfo,
} from "@/api/chapterSynth";
import { Button } from "@/components/Button";
import { InteractivePlayer } from "@/components/InteractivePlayer";
import { Skeleton } from "@/components/Skeleton";
import * as Icons from "@/components/icons";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, space, typography } from "@/theme/tokens";

interface Props {
  t: Translations;
  chapterId: string;
  chapterTitle: string;
  onToast: (msg: string) => void;
}

export function ChunkMap({ t, chapterId, chapterTitle, onToast }: Props) {
  const [chunks, setChunks] = useState<ChunkInfo[]>([]);
  const [genId, setGenId] = useState<string | null>(null);
  const [synthesizing, setSynthesizing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [regenIndex, setRegenIndex] = useState<number | null>(null);
  const player = useAudioPlayer();

  const loadMap = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getChunkMap(chapterId);
      setChunks(data.chunks);
      setGenId(data.generation_id);
    } catch { /* first time — no generation yet */ } finally {
      setLoading(false);
    }
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
      onToast(`Error: ${e instanceof Error ? e.message : t.unknownError}`);
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
      onToast(`Error: ${e instanceof Error ? e.message : t.unknownError}`);
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
        <h4 style={{ margin: 0, fontSize: typography.size.base, fontWeight: 700 }}>
          {t.chunkMapTitle} — {chapterTitle}
        </h4>
        <Button
          variant="primary"
          icon={<Icons.Waveform />}
          loading={synthesizing}
          onClick={() => void handleSynthesize()}
        >
          {synthesizing ? t.chunkSynthesizing : t.chunkSynthesize}
        </Button>
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
          <InteractivePlayer player={player} playLabel={t.play} pauseLabel={t.pause} stopLabel={t.stop} />
        </div>
      )}

      {/* Chunk list */}
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: space[1] }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} height={48} radius={6} />
          ))}
        </div>
      ) : chunks.length === 0 ? (
        <p style={{ fontSize: typography.size.sm, color: colors.textDim, textAlign: "center", padding: 20 }}>
          {genId ? t.chunkNoChunks : t.chunkClickToSynth}
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
                    fontSize: typography.size.xs,
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
                      fontSize: typography.size.xs,
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
                    fontSize: typography.size.xs,
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
                  {isRegen ? t.chunkRegenerating : t.chunkRegen}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
