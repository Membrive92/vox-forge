/**
 * Quick Preview: synthesize the first ~300 chars of a chapter before
 * committing to a full synthesis. Useful to check voice/settings without
 * burning 3 minutes of GPU time on a long chapter.
 */
import { useEffect, useRef, useState } from "react";

import { synthesize } from "@/api/synthesis";
import { Button } from "@/components/Button";
import { InteractivePlayer } from "@/components/InteractivePlayer";
import * as Icons from "@/components/icons";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import type { Translations } from "@/i18n";
import { colors, radii, typography } from "@/theme/tokens";

interface Props {
  t: Translations;
  chapterText: string;
  voiceId: string;
  profileId: string | null;
  speed: number;
  pitch: number;
  volume: number;
  outputFormat: string;
  onToast: (msg: string) => void;
}

const PREVIEW_CHARS = 300;

export function QuickPreview({
  t, chapterText, voiceId, profileId, speed, pitch, volume, outputFormat, onToast,
}: Props) {
  const [generating, setGenerating] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const player = useAudioPlayer();

  // Abort any in-flight preview when the component unmounts (e.g. the
  // user switches chapters or closes the preview panel).
  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  // Take the first ~300 chars but cut at the last full sentence so we
  // don't leave a dangling phrase.
  const snippet = extractSnippet(chapterText);

  const handlePreview = async (): Promise<void> => {
    if (!snippet) {
      onToast(t.previewNoText);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setGenerating(true);
    try {
      const result = await synthesize(
        {
          text: snippet,
          voiceId,
          format: outputFormat as "mp3" | "wav" | "ogg" | "flac",
          speed,
          pitch,
          volume,
          profileId: profileId ?? undefined,
        },
        undefined,
        controller.signal,
      );
      player.load(result.blob, result.duration);
      onToast(t.previewReady.replace("{dur}", result.duration.toFixed(1)));
    } catch (e) {
      // AbortError is the user clicking Cancel — not an actual failure.
      if (e instanceof DOMException && e.name === "AbortError") {
        onToast(t.previewCancelled);
      } else {
        onToast(`Error: ${e instanceof Error ? e.message : t.unknownError}`);
      }
    } finally {
      setGenerating(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const handleCancel = (): void => {
    abortRef.current?.abort();
  };

  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: radii.xl,
        padding: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <h4 style={{ margin: 0, fontSize: typography.size.sm, fontWeight: 700 }}>{t.previewTitle}</h4>
          <p style={{ margin: "2px 0 0", fontSize: typography.size.xs, color: colors.textDim }}>
            {t.previewDescription.replace("{n}", String(Math.min(PREVIEW_CHARS, chapterText.length)))}
          </p>
        </div>
        {generating ? (
          <Button
            variant="danger"
            size="sm"
            onClick={handleCancel}
          >
            {t.cancel}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            icon={<Icons.Waveform />}
            disabled={snippet.length === 0}
            onClick={() => void handlePreview()}
          >
            {t.previewButton}
          </Button>
        )}
      </div>

      {player.url && (
        <div style={{ marginTop: 10 }}>
          <audio
            ref={player.audioRef}
            src={player.url}
            onPlay={() => player.setIsPlaying(true)}
            onPause={() => player.setIsPlaying(false)}
            onEnded={() => player.setIsPlaying(false)}
            style={{ display: "none" }}
          />
          <InteractivePlayer
            player={player}
            playLabel={t.play}
            pauseLabel={t.pause}
            stopLabel={t.stop}
          />
        </div>
      )}
    </div>
  );
}

function extractSnippet(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= PREVIEW_CHARS) return trimmed;

  // Cut at the last sentence break before the limit so the preview doesn't
  // end mid-word. Fall back to a hard cut if there's no break nearby.
  const slice = trimmed.slice(0, PREVIEW_CHARS);
  const lastBreak = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? "),
    slice.lastIndexOf("…"),
  );
  if (lastBreak > PREVIEW_CHARS * 0.5) {
    return slice.slice(0, lastBreak + 1).trim();
  }
  return slice.trim();
}
