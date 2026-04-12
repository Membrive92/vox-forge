import * as Icons from "@/components/icons";
import type { AudioPlayerState } from "@/hooks/useAudioPlayer";
import { colors, fonts, radii } from "@/theme/tokens";

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
        <button
          onClick={player.toggle}
          disabled={!ready}
          aria-label={player.isPlaying ? pauseLabel : playLabel}
          style={{
            width: 42, height: 42, borderRadius: "50%",
            background: ready ? (player.isPlaying ? colors.accent : colors.primary) : colors.textDark,
            border: "none", color: "#fff",
            cursor: ready ? "pointer" : "default",
            display: "flex", alignItems: "center", justifyContent: "center",
            opacity: ready ? 1 : 0.3,
            transition: "all 0.2s",
            flexShrink: 0,
          }}
        >
          {player.isPlaying ? <Icons.Pause /> : <Icons.Play />}
        </button>

        <button
          onClick={() => player.skip(-10)}
          disabled={!ready}
          aria-label="Skip back 10 seconds"
          style={skipBtn(ready)}
        >
          −10s
        </button>
        <button
          onClick={() => player.skip(10)}
          disabled={!ready}
          aria-label="Skip forward 10 seconds"
          style={skipBtn(ready)}
        >
          +10s
        </button>

        <button
          onClick={player.stop}
          disabled={!player.isPlaying}
          aria-label={stopLabel}
          style={{
            width: 32, height: 32, borderRadius: "50%",
            background: colors.textDark,
            border: `1px solid ${colors.border}`,
            color: colors.textMuted,
            cursor: player.isPlaying ? "pointer" : "default",
            display: "flex", alignItems: "center", justifyContent: "center",
            opacity: player.isPlaying ? 1 : 0.3,
            flexShrink: 0,
          }}
        >
          <Icons.Stop />
        </button>

        <span
          style={{
            fontSize: 11,
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
              <button
                key={r}
                onClick={() => player.setRate(r)}
                disabled={!ready}
                style={{
                  padding: "4px 8px",
                  fontSize: 10,
                  fontWeight: 700,
                  background: active ? colors.primary : colors.surfaceAlt,
                  color: active ? "#fff" : colors.textDim,
                  border: `1px solid ${active ? colors.primary : colors.border}`,
                  borderRadius: radii.sm,
                  cursor: ready ? "pointer" : "default",
                  fontFamily: fonts.mono,
                  opacity: ready ? 1 : 0.4,
                }}
              >
                {r === 1 ? "1×" : `${r}×`}
              </button>
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

function skipBtn(enabled: boolean): React.CSSProperties {
  return {
    padding: "6px 10px",
    fontSize: 10,
    fontWeight: 700,
    background: colors.surfaceAlt,
    color: enabled ? colors.textDim : colors.textFaint,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.sm,
    cursor: enabled ? "pointer" : "default",
    fontFamily: fonts.mono,
    opacity: enabled ? 1 : 0.4,
    flexShrink: 0,
  };
}
