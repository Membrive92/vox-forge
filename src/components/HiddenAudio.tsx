import type { AudioPlayerState } from "@/hooks/useAudioPlayer";

/**
 * The hidden <audio> element wired to a useAudioPlayer instance — carries
 * the ref + play-state listeners that were copy-pasted across ~9 panels.
 * Render one next to each player; the visible controls live in
 * InteractivePlayer.
 */
export function HiddenAudio({ player }: { player: AudioPlayerState }) {
  return (
    <audio
      ref={player.audioRef}
      src={player.url ?? undefined}
      onPlay={() => player.setIsPlaying(true)}
      onPause={() => player.setIsPlaying(false)}
      onEnded={() => player.setIsPlaying(false)}
      style={{ display: "none" }}
    />
  );
}
