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
import { InteractivePlayer } from "@/components/InteractivePlayer";
import { Slider } from "@/components/Slider";
import * as Icons from "@/components/icons";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { colors, fonts, radii } from "@/theme/tokens";

interface Props {
  chapterId: string;
  onToast: (msg: string) => void;
}

export function AmbienceMixer({ chapterId, onToast }: Props) {
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
      onToast(`Error: ${e instanceof Error ? e.message : "Unknown"}`);
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
      onToast(`Error: ${e instanceof Error ? e.message : "Unknown"}`);
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
      onToast(`Error: ${e instanceof Error ? e.message : "Unknown"}`);
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
      <h4 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700 }}>
        Ambient Mixer
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
            padding: "8px 14px", fontSize: 12, fontWeight: 600,
            background: colors.surfaceAlt, color: colors.textDim,
            border: `1px dashed ${colors.border}`, borderRadius: radii.md,
            cursor: uploading ? "default" : "pointer", fontFamily: fonts.sans,
            display: "flex", alignItems: "center", gap: 6,
            opacity: uploading ? 0.5 : 1,
          }}
        >
          <Icons.Upload />
          {uploading ? "Uploading..." : "Upload ambient track"}
        </button>
      </div>

      {/* Track list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflowY: "auto", marginBottom: 14 }}>
        {tracks.length === 0 ? (
          <p style={{ fontSize: 12, color: colors.textDim, textAlign: "center", padding: 12 }}>
            No ambient tracks. Upload a sound (forest, rain, tavern, etc.)
          </p>
        ) : (
          tracks.map((t) => {
            const active = selectedId === t.id;
            return (
              <div
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 12px", borderRadius: radii.sm, cursor: "pointer",
                  background: active ? colors.primarySoft : colors.surfaceSubtle,
                  border: active ? `1px solid ${colors.primaryBorder}` : `1px solid ${colors.borderFaint}`,
                }}
              >
                <button
                  onClick={(e) => { e.stopPropagation(); handlePreview(t); }}
                  aria-label={`Preview ${t.name}`}
                  style={{
                    width: 26, height: 26, borderRadius: "50%",
                    background: colors.surfaceAlt, border: `1px solid ${colors.border}`,
                    color: colors.textDim, cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 10, flexShrink: 0,
                  }}
                >
                  <Icons.Play />
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: colors.text }}>{t.name}</div>
                  <div style={{ fontSize: 10, color: colors.textDim, fontFamily: fonts.mono }}>
                    {t.duration_s.toFixed(1)}s
                    {t.tags.length > 0 && ` · ${t.tags.join(", ")}`}
                  </div>
                </div>
                {active && <Icons.Check />}
                <button
                  onClick={(e) => { e.stopPropagation(); void handleDelete(t.id); }}
                  aria-label={`Delete ${t.name}`}
                  style={{
                    background: "none", border: "none", color: colors.textFaint,
                    cursor: "pointer", fontSize: 14, padding: "0 4px",
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
            label="Ambient volume"
            value={volumeDb}
            onChange={setVolumeDb}
            min={-40}
            max={0}
            step={1}
            unit="dB"
            info="How loud the ambient track is relative to the narration. -15dB is subtle, -5dB is prominent."
          />
          <Slider
            label="Fade in"
            value={fadeIn}
            onChange={setFadeIn}
            min={0}
            max={15}
            step={0.5}
            unit="s"
            info="Seconds for the ambient to fade in at the start of the chapter."
          />
          <Slider
            label="Fade out"
            value={fadeOut}
            onChange={setFadeOut}
            min={0}
            max={15}
            step={0.5}
            unit="s"
            info="Seconds for the ambient to fade out at the end of the chapter."
          />

          <button
            onClick={() => void handleMix()}
            disabled={mixing}
            style={{
              width: "100%", padding: "12px 0", borderRadius: radii.lg, marginTop: 8,
              background: mixing ? colors.textDark : "linear-gradient(135deg, #10b981, #059669)",
              border: "none", color: "#fff", fontSize: 13, fontWeight: 700,
              cursor: mixing ? "default" : "pointer", fontFamily: fonts.sans,
              opacity: mixing ? 0.5 : 1,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}
          >
            <Icons.Waveform />
            {mixing ? "Mixing..." : "Mix with ambient"}
          </button>
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
          <InteractivePlayer player={mixPlayer} playLabel="Play mix" pauseLabel="Pause" stopLabel="Stop" />
          <button
            onClick={handleDownloadMix}
            style={{
              marginTop: 8, padding: "8px 14px", fontSize: 12, fontWeight: 600,
              background: "rgba(59,130,246,0.15)", border: `1px solid ${colors.primaryBorder}`,
              borderRadius: radii.md, color: colors.primaryLight,
              cursor: "pointer", fontFamily: fonts.sans,
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            <Icons.Download /> Download mixed audio
          </button>
        </div>
      )}
    </div>
  );
}
