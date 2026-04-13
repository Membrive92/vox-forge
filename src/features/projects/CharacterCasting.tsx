/**
 * Character casting UI for a chapter.
 *
 * Scans the chapter text for [Character] markup, lists the detected
 * characters, lets the user assign a voice profile or built-in voice to
 * each one, and runs cast synthesis on demand.
 */
import { useCallback, useEffect, useState } from "react";

import {
  castSynthesize,
  extractCharacters,
  type CharacterMapping,
} from "@/api/characterSynth";
import { InteractivePlayer } from "@/components/InteractivePlayer";
import * as Icons from "@/components/icons";
import { VOICES } from "@/constants/voices";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { useProfiles } from "@/hooks/useProfiles";
import { colors, fonts, radii } from "@/theme/tokens";

interface Props {
  chapterText: string;
  chapterTitle: string;
  onToast: (msg: string) => void;
}

export function CharacterCasting({ chapterText, chapterTitle, onToast }: Props) {
  const [characters, setCharacters] = useState<string[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [scanning, setScanning] = useState(false);
  const [generating, setGenerating] = useState(false);
  const { profiles } = useProfiles();
  const player = useAudioPlayer();

  const scan = useCallback(async () => {
    if (!chapterText.trim()) {
      setCharacters([]);
      return;
    }
    setScanning(true);
    try {
      const data = await extractCharacters(chapterText);
      setCharacters(data.characters);
      if (data.characters.length === 0) {
        onToast("No character tags found. Use [Name] markup at the start of lines.");
      }
    } catch (e) {
      onToast(`Error: ${e instanceof Error ? e.message : "Unknown"}`);
    } finally {
      setScanning(false);
    }
  }, [chapterText, onToast]);

  useEffect(() => { void scan(); }, [scan]);

  const handleAssign = (character: string, value: string): void => {
    setAssignments((prev) => ({ ...prev, [character]: value }));
  };

  const handleGenerate = async (): Promise<void> => {
    setGenerating(true);
    try {
      const cast: CharacterMapping[] = characters.map((c) => {
        const value = assignments[c] ?? "";
        // Profile IDs are short (8-12 chars), voice IDs contain a dash (es-ES-...)
        if (value && value.includes("-")) {
          return { character: c, voice_id: value };
        }
        if (value) {
          return { character: c, profile_id: value };
        }
        return { character: c };
      });

      const result = await castSynthesize(chapterText, cast);
      player.load(result.blob, result.duration);

      if (result.unmapped.length > 0) {
        onToast(`Generated with ${result.unmapped.length} unmapped characters using default voice`);
      } else {
        onToast(`Cast synthesis ready (${result.segments} segments)`);
      }
    } catch (e) {
      onToast(`Error: ${e instanceof Error ? e.message : "Unknown"}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = (): void => {
    if (!player.url) return;
    const a = document.createElement("a");
    a.href = player.url;
    a.download = `cast_${chapterTitle.replace(/[^\w]+/g, "_")}.mp3`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const allVoices = [...VOICES.es, ...VOICES.en];
  const profilesWithSample = profiles.filter((p) => p.sampleName !== null);

  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: radii.xl,
        padding: 20,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Character Casting</h4>
        <button
          onClick={() => void scan()}
          disabled={scanning}
          style={rescanBtn}
        >
          {scanning ? "..." : "Rescan"}
        </button>
      </div>

      {characters.length === 0 ? (
        <div
          style={{
            padding: 16,
            borderRadius: radii.md,
            background: colors.surfaceSubtle,
            border: `1px dashed ${colors.borderFaint}`,
            fontSize: 12,
            color: colors.textDim,
            lineHeight: 1.6,
          }}
        >
          <p style={{ margin: "0 0 8px", fontWeight: 600, color: colors.textMuted }}>
            No characters detected in this chapter.
          </p>
          <p style={{ margin: 0 }}>
            Add <code style={{ fontFamily: fonts.mono, color: colors.primaryLight }}>[Character]</code>{" "}
            tags at the start of lines in the chapter text, then rescan.
          </p>
          <pre
            style={{
              margin: "10px 0 0",
              padding: 10,
              background: colors.surfaceAlt,
              borderRadius: radii.sm,
              fontFamily: fonts.mono,
              fontSize: 11,
              color: colors.textDim,
              whiteSpace: "pre-wrap",
            }}
          >
            [Narrator] It was a dark and stormy night.
            [Kael] "I told you this would happen."
            [Narrator] Kael stepped forward.
          </pre>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {characters.map((char) => {
            const value = assignments[char] ?? "";
            return (
              <div
                key={char}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 12px",
                  background: colors.surfaceSubtle,
                  border: `1px solid ${colors.borderFaint}`,
                  borderRadius: radii.sm,
                }}
              >
                <div
                  style={{
                    minWidth: 140,
                    fontSize: 13,
                    fontWeight: 600,
                    color: colors.text,
                  }}
                >
                  {char}
                </div>
                <select
                  value={value}
                  onChange={(e) => handleAssign(char, e.target.value)}
                  style={{
                    flex: 1,
                    padding: "8px 10px",
                    background: colors.surfaceAlt,
                    color: colors.text,
                    border: `1px solid ${colors.border}`,
                    borderRadius: radii.sm,
                    fontSize: 12,
                    fontFamily: fonts.sans,
                    outline: "none",
                    cursor: "pointer",
                  }}
                >
                  <option value="">— Default voice —</option>
                  {profilesWithSample.length > 0 && (
                    <optgroup label="Cloned profiles">
                      {profilesWithSample.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="System voices">
                    {allVoices.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} ({v.accent})
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>
            );
          })}
        </div>
      )}

      {characters.length > 0 && (
        <button
          onClick={() => void handleGenerate()}
          disabled={generating}
          style={{
            width: "100%",
            marginTop: 12,
            padding: "12px 0",
            borderRadius: radii.lg,
            background: generating
              ? colors.textDark
              : "linear-gradient(135deg, #8b5cf6, #7c3aed)",
            border: "none",
            color: "#fff",
            fontSize: 13,
            fontWeight: 700,
            cursor: generating ? "default" : "pointer",
            fontFamily: fonts.sans,
            opacity: generating ? 0.5 : 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          <Icons.Waveform />
          {generating ? "Generating..." : `Cast ${characters.length} voice${characters.length === 1 ? "" : "s"}`}
        </button>
      )}

      {player.url && (
        <div style={{ marginTop: 12 }}>
          <audio
            ref={player.audioRef}
            src={player.url}
            onPlay={() => player.setIsPlaying(true)}
            onPause={() => player.setIsPlaying(false)}
            onEnded={() => player.setIsPlaying(false)}
            style={{ display: "none" }}
          />
          <InteractivePlayer player={player} playLabel="Play" pauseLabel="Pause" stopLabel="Stop" />
          <button
            onClick={handleDownload}
            style={{
              marginTop: 8,
              padding: "8px 14px",
              fontSize: 12,
              fontWeight: 600,
              background: "rgba(139,92,246,0.15)",
              border: "1px solid rgba(139,92,246,0.3)",
              color: "#a78bfa",
              borderRadius: radii.md,
              cursor: "pointer",
              fontFamily: fonts.sans,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Icons.Download /> Download cast audio
          </button>
        </div>
      )}
    </div>
  );
}

const rescanBtn: React.CSSProperties = {
  padding: "5px 12px",
  fontSize: 11,
  fontWeight: 600,
  background: colors.surfaceAlt,
  color: colors.textDim,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.sm,
  cursor: "pointer",
  fontFamily: fonts.sans,
};
