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
import { Button } from "@/components/Button";
import { InteractivePlayer } from "@/components/InteractivePlayer";
import * as Icons from "@/components/icons";
import { VOICES } from "@/constants/voices";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { useProfiles } from "@/hooks/useProfiles";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, typography } from "@/theme/tokens";

interface Props {
  t: Translations;
  chapterText: string;
  chapterTitle: string;
  onToast: (msg: string) => void;
}

export function CharacterCasting({ t, chapterText, chapterTitle, onToast }: Props) {
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
        onToast(t.castingNoTagsFound);
      }
    } catch (e) {
      onToast(`Error: ${e instanceof Error ? e.message : t.unknownError}`);
    } finally {
      setScanning(false);
    }
  }, [chapterText, onToast, t.castingNoTagsFound, t.unknownError]);

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
      onToast(`Error: ${e instanceof Error ? e.message : t.unknownError}`);
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
        <h4 style={{ margin: 0, fontSize: typography.size.base, fontWeight: 700 }}>{t.castingTitle}</h4>
        <button
          onClick={() => void scan()}
          disabled={scanning}
          style={rescanBtn}
        >
          {scanning ? t.castingRescanning : t.castingRescan}
        </button>
      </div>

      {characters.length === 0 ? (
        <div
          style={{
            padding: 16,
            borderRadius: radii.md,
            background: colors.surfaceSubtle,
            border: `1px dashed ${colors.borderFaint}`,
            fontSize: typography.size.sm,
            color: colors.textDim,
            lineHeight: 1.6,
          }}
        >
          <p style={{ margin: "0 0 8px", fontWeight: 600, color: colors.textMuted }}>
            {t.castingNoDetected}
          </p>
          <p style={{ margin: 0 }}>
            {t.castingAddTagsHint}
          </p>
          <pre
            style={{
              margin: "10px 0 0",
              padding: 10,
              background: colors.surfaceAlt,
              borderRadius: radii.sm,
              fontFamily: fonts.mono,
              fontSize: typography.size.xs,
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
                    fontSize: typography.size.sm,
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
                    fontSize: typography.size.sm,
                    fontFamily: fonts.sans,
                    outline: "none",
                    cursor: "pointer",
                  }}
                >
                  <option value="">{t.castingDefaultVoice}</option>
                  {profilesWithSample.length > 0 && (
                    <optgroup label={t.castingClonedProfiles}>
                      {profilesWithSample.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label={t.castingSystemVoices}>
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
        <div style={{ marginTop: 12 }}>
          <Button
            variant="primary"
            icon={<Icons.Waveform />}
            loading={generating}
            fullWidth
            onClick={() => void handleGenerate()}
          >
            {generating
              ? t.generating
              : characters.length === 1
                ? t.castingCastVoice
                : t.castingCastVoices.replace("{n}", String(characters.length))}
          </Button>
        </div>
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
          <InteractivePlayer player={player} playLabel={t.play} pauseLabel={t.pause} stopLabel={t.stop} />
          <button
            onClick={handleDownload}
            style={{
              marginTop: 8,
              padding: "8px 14px",
              fontSize: typography.size.sm,
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
            <Icons.Download /> {t.castingDownload}
          </button>
        </div>
      )}
    </div>
  );
}

const rescanBtn: React.CSSProperties = {
  padding: "5px 12px",
  fontSize: typography.size.xs,
  fontWeight: 600,
  background: colors.surfaceAlt,
  color: colors.textDim,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.sm,
  cursor: "pointer",
  fontFamily: fonts.sans,
};
