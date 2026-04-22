import { useCallback, useEffect, useRef, useState } from "react";

import {
  getChunkMap,
  regenerateChunk,
  synthesizeChapter,
  type ChapterSynthResult,
  type ChunkInfo,
} from "@/api/chapterSynth";
import { isAbortError } from "@/api/client";
import { listStudioRenders, type StudioRender } from "@/api/studio";
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
  onOpenStudioWithSource: (generationId: string) => void;
}

export function ChunkMap({ t, chapterId, chapterTitle, onToast, onOpenStudioWithSource }: Props) {
  const [chunks, setChunks] = useState<ChunkInfo[]>([]);
  const [genId, setGenId] = useState<string | null>(null);
  const [synthesizing, setSynthesizing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [regenIndex, setRegenIndex] = useState<number | null>(null);
  const [studioEdits, setStudioEdits] = useState<StudioRender[]>([]);
  const synthAbortRef = useRef<AbortController | null>(null);
  const regenAbortRef = useRef<AbortController | null>(null);
  const player = useAudioPlayer();

  useEffect(() => () => {
    synthAbortRef.current?.abort();
    regenAbortRef.current?.abort();
  }, []);

  const loadMap = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getChunkMap(chapterId);
      setChunks(data.chunks);
      setGenId(data.generation_id);
    } catch { /* first time — no generation yet */ } finally {
      setLoading(false);
    }
    // Studio edits linked to this chapter — used to show an indicator
    // and to let users jump back to any past version.
    try {
      const edits = await listStudioRenders({ kind: "audio", chapterId });
      setStudioEdits(edits);
    } catch { /* non-critical */ }
  }, [chapterId]);

  useEffect(() => { void loadMap(); }, [loadMap]);

  const handleSynthesize = async (): Promise<void> => {
    const controller = new AbortController();
    synthAbortRef.current = controller;
    setSynthesizing(true);
    try {
      const result: ChapterSynthResult = await synthesizeChapter(chapterId, controller.signal);
      player.load(result.blob, result.duration);
      setGenId(result.generationId);
      onToast(`${chapterTitle} synthesized (${result.chunks} chunks, ${result.engine})`);
      await loadMap();
    } catch (e) {
      if (isAbortError(e)) {
        onToast(t.synthesisCancelled);
      } else {
        onToast(`Error: ${e instanceof Error ? e.message : t.unknownError}`);
      }
    } finally {
      setSynthesizing(false);
      if (synthAbortRef.current === controller) synthAbortRef.current = null;
    }
  };

  const handleCancelSynthesize = (): void => {
    synthAbortRef.current?.abort();
  };

  const handleRegen = async (index: number): Promise<void> => {
    const controller = new AbortController();
    regenAbortRef.current = controller;
    setRegenIndex(index);
    try {
      await regenerateChunk(chapterId, index, controller.signal);
      onToast(`Chunk ${index + 1} regenerated`);
      await loadMap();
    } catch (e) {
      if (isAbortError(e)) {
        onToast(t.synthesisCancelled);
      } else {
        onToast(`Error: ${e instanceof Error ? e.message : t.unknownError}`);
      }
    } finally {
      setRegenIndex(null);
      if (regenAbortRef.current === controller) regenAbortRef.current = null;
    }
  };

  const handleCancelRegen = (): void => {
    regenAbortRef.current?.abort();
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
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <h4 style={{ margin: 0, fontSize: typography.size.base, fontWeight: 700 }}>
            {t.chunkMapTitle} — {chapterTitle}
          </h4>
          {studioEdits.length > 0 && (
            <button
              type="button"
              onClick={() => genId && onOpenStudioWithSource(genId)}
              title={t.chunkOpenInStudio}
              style={{
                padding: "3px 8px",
                fontSize: 10,
                fontWeight: 700,
                fontFamily: fonts.mono,
                borderRadius: radii.sm,
                background: "rgba(139,92,246,0.15)",
                color: "#a78bfa",
                border: "1px solid rgba(139,92,246,0.3)",
                cursor: genId ? "pointer" : "default",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              {t.chunkEditedCount.replace("{n}", String(studioEdits.length))}
            </button>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {genId && !synthesizing ? (
            <Button
              variant="secondary"
              icon={<Icons.Scissors />}
              onClick={() => onOpenStudioWithSource(genId)}
            >
              {t.chunkOpenInStudio}
            </Button>
          ) : null}
          {synthesizing ? (
            <Button variant="danger" onClick={handleCancelSynthesize}>
              {t.cancel}
            </Button>
          ) : (
            <Button
              variant="primary"
              icon={<Icons.Waveform />}
              onClick={() => void handleSynthesize()}
            >
              {t.chunkSynthesize}
            </Button>
          )}
        </div>
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
                  onClick={() =>
                    isRegen ? handleCancelRegen() : void handleRegen(chunk.index)
                  }
                  disabled={!isRegen && !genId}
                  title={
                    isRegen
                      ? t.cancel
                      : `Regenerate chunk ${chunk.index + 1}`
                  }
                  style={{
                    padding: "6px 12px",
                    fontSize: typography.size.xs,
                    fontWeight: 600,
                    background: isRegen
                      ? "rgba(248,113,113,0.15)"
                      : "rgba(245,158,11,0.1)",
                    color: isRegen ? colors.danger : "#f59e0b",
                    border: isRegen
                      ? `1px solid ${colors.dangerBorder}`
                      : "1px solid rgba(245,158,11,0.2)",
                    borderRadius: radii.sm,
                    cursor: !isRegen && !genId ? "default" : "pointer",
                    fontFamily: fonts.sans,
                    opacity: genId ? 1 : 0.3,
                    flexShrink: 0,
                  }}
                >
                  {isRegen ? t.cancel : t.chunkRegen}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
