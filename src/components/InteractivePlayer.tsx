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

const PLAYBACK_RATES: readonly number[] = [0.75, 1, 1.25, 1.5, 2];

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

        <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
          {PLAYBACK_RATES.map((r) => {
            const active = Math.abs(player.playbackRate - r) < 0.01;
            return (
              <Button
                key={r}
                variant={active ? "primary" : "ghost"}
                size="sm"
                disabled={!ready}
                onClick={() => player.setRate(r)}
                aria-label={`Playback rate ${r}x`}
                style={{
                  fontFamily: fonts.mono,
                  minHeight: 26,
                  padding: "4px 10px",
                }}
              >
                {r === 1 ? "1×" : `${r}×`}
              </Button>
            );
          })}
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
