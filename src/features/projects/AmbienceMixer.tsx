/**
 * Ambient audio mixer for a chapter.
 *
 * Shows the ambience library (upload + list), lets the user pick one,
 * adjust volume/fade, and mix it with the chapter's narration audio.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  deleteAmbience,
  getAmbienceAudioUrl,
  listAmbience,
  mixChapter,
  uploadAmbience,
  type AmbienceTrack,
} from "@/api/ambience";
import { Button } from "@/components/Button";
import { InteractivePlayer } from "@/components/InteractivePlayer";
import { Slider } from "@/components/Slider";
import * as Icons from "@/components/icons";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, typography } from "@/theme/tokens";

interface Props {
  t: Translations;
  chapterId: string;
  onToast: (msg: string) => void;
}

export function AmbienceMixer({ t, chapterId, onToast }: Props) {
  const [tracks, setTracks] = useState<AmbienceTrack[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [volumeDb, setVolumeDb] = useState(-15);
  const [fadeIn, setFadeIn] = useState(3);
  const [fadeOut, setFadeOut] = useState(3);
  const [mixing, setMixing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewPlayer = useAudioPlayer();
  const mixPlayer = useAudioPlayer();

  const loadTracks = useCallback(async () => {
    try {
      const data = await listAmbience();
      setTracks(data.tracks);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void loadTracks(); }, [loadTracks]);

  const handleUpload = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setUploading(true);
    try {
      const name = file.name.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");
      await uploadAmbience(file, name);
      await loadTracks();
      onToast("Ambient track uploaded");
    } catch (e) {
      onToast(`Error: ${e instanceof Error ? e.message : t.unknownError}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    if (!window.confirm("Delete this ambient track?")) return;
    try {
      await deleteAmbience(id);
      if (selectedId === id) setSelectedId(null);
      await loadTracks();
    } catch (e) {
      onToast(`Error: ${e instanceof Error ? e.message : t.unknownError}`);
    }
  };

  const handlePreview = (track: AmbienceTrack): void => {
    const url = getAmbienceAudioUrl(track.id);
    // Load directly via URL — no blob needed for preview
    const audio = previewPlayer.audioRef.current;
    if (audio) {
      audio.src = url;
      void audio.play().catch(() => undefined);
      previewPlayer.setIsPlaying(true);
    }
  };

  const handleMix = async (): Promise<void> => {
    if (!selectedId) return;
    setMixing(true);
    try {
      const result = await mixChapter(
        chapterId,
        selectedId,
        volumeDb,
        fadeIn * 1000,
        fadeOut * 1000,
      );
      mixPlayer.load(result.blob, result.duration);
      onToast(`Mixed audio ready (${result.duration.toFixed(1)}s)`);
    } catch (e) {
      onToast(`Error: ${e instanceof Error ? e.message : t.unknownError}`);
    } finally {
      setMixing(false);
    }
  };

  const handleDownloadMix = (): void => {
    if (!mixPlayer.url) return;
    const a = document.createElement("a");
    a.href = mixPlayer.url;
    a.download = "mixed_chapter.mp3";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div style={{
      background: colors.surface, border: `1px solid ${colors.border}`,
      borderRadius: radii.xl, padding: 20,
    }}>
      <h4 style={{ margin: "0 0 12px", fontSize: typography.size.base, fontWeight: 700 }}>
        {t.ambientMixerTitle}
      </h4>

      {/* Hidden audio element for preview */}
      <audio
        ref={previewPlayer.audioRef}
        onPlay={() => previewPlayer.setIsPlaying(true)}
        onPause={() => previewPlayer.setIsPlaying(false)}
        onEnded={() => previewPlayer.setIsPlaying(false)}
        style={{ display: "none" }}
      />

      {/* Upload */}
      <div style={{ marginBottom: 14 }}>
        <input
          ref={fileRef}
          type="file"
          accept=".mp3,.wav,.ogg,.flac"
          style={{ display: "none" }}
          onChange={(e) => void handleUpload(e.target.files?.[0])}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          style={{
            padding: "8px 14px", fontSize: typography.size.sm, fontWeight: 600,
            background: colors.surfaceAlt, color: colors.textDim,
            border: `1px dashed ${colors.border}`, borderRadius: radii.md,
            cursor: uploading ? "default" : "pointer", fontFamily: fonts.sans,
            display: "flex", alignItems: "center", gap: 6,
            opacity: uploading ? 0.5 : 1,
          }}
        >
          <Icons.Upload />
          {uploading ? t.ambientUploading : t.ambientUpload}
        </button>
      </div>

      {/* Track list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflowY: "auto", marginBottom: 14 }}>
        {tracks.length === 0 ? (
          <p style={{ fontSize: typography.size.sm, color: colors.textDim, textAlign: "center", padding: 12 }}>
            {t.ambientEmpty}
          </p>
        ) : (
          tracks.map((track) => {
            const active = selectedId === track.id;
            return (
              <div
                key={track.id}
                onClick={() => setSelectedId(track.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 12px", borderRadius: radii.sm, cursor: "pointer",
                  background: active ? colors.primarySoft : colors.surfaceSubtle,
                  border: active ? `1px solid ${colors.primaryBorder}` : `1px solid ${colors.borderFaint}`,
                }}
              >
                <button
                  onClick={(e) => { e.stopPropagation(); handlePreview(track); }}
                  aria-label={`${t.play} ${track.name}`}
                  style={{
                    width: 26, height: 26, borderRadius: "50%",
                    background: colors.surfaceAlt, border: `1px solid ${colors.border}`,
                    color: colors.textDim, cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: typography.size.xs, flexShrink: 0,
                  }}
                >
                  <Icons.Play />
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: typography.size.sm, fontWeight: 500, color: colors.text }}>{track.name}</div>
                  <div style={{ fontSize: typography.size.xs, color: colors.textDim, fontFamily: fonts.mono }}>
                    {track.duration_s.toFixed(1)}s
                    {track.tags.length > 0 && ` · ${track.tags.join(", ")}`}
                  </div>
                </div>
                {active && <Icons.Check />}
                <button
                  onClick={(e) => { e.stopPropagation(); void handleDelete(track.id); }}
                  aria-label={`${t.deleteProfile} ${track.name}`}
                  style={{
                    background: "none", border: "none", color: colors.textFaint,
                    cursor: "pointer", fontSize: typography.size.base, padding: "0 4px",
                  }}
                >
                  x
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Mixer controls */}
      {selectedId && (
        <div style={{ borderTop: `1px solid ${colors.borderFaint}`, paddingTop: 12, marginBottom: 12 }}>
          <Slider
            label={t.volume}
            value={volumeDb}
            onChange={setVolumeDb}
            min={-40}
            max={0}
            step={1}
            unit="dB"
            info={t.ambientLevelInfo}
          />
          <Slider
            label={t.studioOpFadeIn}
            value={fadeIn}
            onChange={setFadeIn}
            min={0}
            max={15}
            step={0.5}
            unit="s"
            info={t.ambientFadeInInfo}
          />
          <Slider
            label={t.studioOpFadeOut}
            value={fadeOut}
            onChange={setFadeOut}
            min={0}
            max={15}
            step={0.5}
            unit="s"
            info={t.ambientFadeOutInfo}
          />

          <div style={{ marginTop: 8 }}>
            <Button
              variant="success"
              icon={<Icons.Waveform />}
              loading={mixing}
              fullWidth
              onClick={() => void handleMix()}
            >
              {mixing ? t.ambientMixing : t.ambientMix}
            </Button>
          </div>
        </div>
      )}

      {/* Mixed audio player */}
      {mixPlayer.url && (
        <div style={{ marginTop: 12 }}>
          <audio
            ref={mixPlayer.audioRef}
            src={mixPlayer.url}
            onPlay={() => mixPlayer.setIsPlaying(true)}
            onPause={() => mixPlayer.setIsPlaying(false)}
            onEnded={() => mixPlayer.setIsPlaying(false)}
            style={{ display: "none" }}
          />
          <InteractivePlayer player={mixPlayer} playLabel={t.ambientPlayMix} pauseLabel={t.pause} stopLabel={t.stop} />
          <button
            onClick={handleDownloadMix}
            style={{
              marginTop: 8, padding: "8px 14px", fontSize: typography.size.sm, fontWeight: 600,
              background: "rgba(59,130,246,0.15)", border: `1px solid ${colors.primaryBorder}`,
              borderRadius: radii.md, color: colors.primaryLight,
              cursor: "pointer", fontFamily: fonts.sans,
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            <Icons.Download /> {t.ambientDownloadMix}
          </button>
        </div>
      )}
    </div>
  );
}
