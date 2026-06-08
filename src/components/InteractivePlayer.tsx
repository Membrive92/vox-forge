import { Button } from "@/components/Button";
import { IconButton } from "@/components/IconButton";
import * as Icons from "@/components/icons";
import type { AudioPlayerState } from "@/hooks/useAudioPlayer";
import { colors, fonts, typography } from "@/theme/tokens";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

// Range of playback rates supported by HTMLAudioElement reliably.
// Below 0.5 the audio gets choppy in most browsers; above 2 the
// pitch shift makes the voice unintelligible.
const PLAYBACK_RATE_MIN = 0.5;
const PLAYBACK_RATE_MAX = 2;
const PLAYBACK_RATE_STEP = 0.05;

interface Props {
  player: AudioPlayerState;
  disabled?: boolean;
  playLabel?: string;
  pauseLabel?: string;
  stopLabel?: string;
}

export function InteractivePlayer({
  player,
  disabled = false,
  playLabel = "Play",
  pauseLabel = "Pause",
  stopLabel = "Stop",
}: Props) {
  const ready = !disabled && player.url !== null;
  const progress = player.duration > 0 ? (player.currentTime / player.duration) * 100 : 0;

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const pct = Number(e.target.value);
    player.seek((pct / 100) * player.duration);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <IconButton
          aria-label={player.isPlaying ? pauseLabel : playLabel}
          variant={player.isPlaying ? "primary" : "primary"}
          size="lg"
          disabled={!ready}
          onClick={player.toggle}
          style={{
            background: player.isPlaying ? colors.accent : colors.primary,
          }}
        >
          {player.isPlaying ? <Icons.Pause /> : <Icons.Play />}
        </IconButton>

        <Button
          variant="ghost"
          size="sm"
          disabled={!ready}
          onClick={() => player.skip(-10)}
          aria-label="Skip back 10 seconds"
        >
          −10s
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!ready}
          onClick={() => player.skip(10)}
          aria-label="Skip forward 10 seconds"
        >
          +10s
        </Button>

        <IconButton
          aria-label={stopLabel}
          variant="secondary"
          size="sm"
          disabled={!player.isPlaying}
          onClick={player.stop}
        >
          <Icons.Stop />
        </IconButton>

        <span
          style={{
            fontSize: typography.size.xs,
            color: colors.textDim,
            fontFamily: fonts.mono,
            minWidth: 80,
            textAlign: "center",
          }}
        >
          {formatTime(player.currentTime)} / {formatTime(player.duration)}
        </span>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginLeft: "auto",
            minWidth: 200,
          }}
        >
          <input
            type="range"
            min={PLAYBACK_RATE_MIN}
            max={PLAYBACK_RATE_MAX}
            step={PLAYBACK_RATE_STEP}
            value={player.playbackRate}
            disabled={!ready}
            onChange={(e) => player.setRate(Number(e.target.value))}
            aria-label="Playback rate"
            style={{
              flex: 1,
              accentColor: colors.primary,
              cursor: ready ? "pointer" : "default",
            }}
          />
          <button
            type="button"
            disabled={!ready}
            onClick={() => player.setRate(1)}
            aria-label="Reset playback rate to 1×"
            title="Reset to 1×"
            style={{
              fontFamily: fonts.mono,
              fontSize: typography.size.xs,
              minWidth: 48,
              padding: "4px 8px",
              borderRadius: 4,
              background: Math.abs(player.playbackRate - 1) < 0.01
                ? colors.surfaceAlt
                : "transparent",
              border: `1px solid ${colors.borderSubtle}`,
              color: colors.text,
              cursor: ready ? "pointer" : "default",
              textAlign: "center",
            }}
          >
            {player.playbackRate.toFixed(2)}×
          </button>
        </div>
      </div>

      <input
        type="range"
        min={0}
        max={100}
        step={0.1}
        value={progress}
        onChange={handleScrub}
        disabled={!ready || player.duration === 0}
        aria-label="Seek"
        style={{
          width: "100%",
          accentColor: colors.primary,
          cursor: ready && player.duration > 0 ? "pointer" : "default",
        }}
      />
    </div>
  );
}
