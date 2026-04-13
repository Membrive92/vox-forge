/**
 * Quick Preview: synthesize the first ~300 chars of a chapter before
 * committing to a full synthesis. Useful to check voice/settings without
 * burning 3 minutes of GPU time on a long chapter.
 */
import { useState } from "react";

import { synthesize } from "@/api/synthesis";
import { InteractivePlayer } from "@/components/InteractivePlayer";
import * as Icons from "@/components/icons";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { colors, fonts, radii } from "@/theme/tokens";

interface Props {
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
  chapterText, voiceId, profileId, speed, pitch, volume, outputFormat, onToast,
}: Props) {
  const [generating, setGenerating] = useState(false);
  const player = useAudioPlayer();

  // Take the first ~300 chars but cut at the last full sentence so we
  // don't leave a dangling phrase.
  const snippet = extractSnippet(chapterText);

  const handlePreview = async (): Promise<void> => {
    if (!snippet) {
      onToast("Chapter has no text to preview");
      return;
    }
    setGenerating(true);
    try {
      const result = await synthesize({
        text: snippet,
        voiceId,
        format: outputFormat as "mp3" | "wav" | "ogg" | "flac",
        speed,
        pitch,
        volume,
        profileId: profileId ?? undefined,
      });
      player.load(result.blob, result.duration);
      onToast(`Preview ready (${result.duration.toFixed(1)}s)`);
    } catch (e) {
      onToast(`Error: ${e instanceof Error ? e.message : "Unknown"}`);
    } finally {
      setGenerating(false);
    }
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
          <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>Quick Preview</h4>
          <p style={{ margin: "2px 0 0", fontSize: 11, color: colors.textDim }}>
            First {Math.min(PREVIEW_CHARS, chapterText.length)} chars · no chunking · fast audition
          </p>
        </div>
        <button
          onClick={() => void handlePreview()}
          disabled={generating || snippet.length === 0}
          style={{
            padding: "8px 16px",
            background: generating || !snippet
              ? colors.textDark
              : `linear-gradient(135deg, ${colors.primary}, ${colors.primaryDim})`,
            border: "none",
            color: "#fff",
            borderRadius: radii.md,
            fontSize: 12,
            fontWeight: 700,
            cursor: generating || !snippet ? "default" : "pointer",
            fontFamily: fonts.sans,
            opacity: generating || !snippet ? 0.5 : 1,
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexShrink: 0,
          }}
        >
          <Icons.Waveform />
          {generating ? "..." : "Preview"}
        </button>
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
            playLabel="Play"
            pauseLabel="Pause"
            stopLabel="Stop"
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
