import { useRef, useState } from "react";

import { synthesize } from "@/api/synthesis";
import { InteractivePlayer } from "@/components/InteractivePlayer";
import * as Icons from "@/components/icons";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import type { Translations } from "@/i18n";
import { colors, fonts, radii } from "@/theme/tokens";
import type { Profile } from "@/types/domain";

interface Props {
  t: Translations;
  profiles: readonly Profile[];
  onToast: (msg: string) => void;
}

export function CompareTab({ t, profiles, onToast }: Props) {
  const [text, setText] = useState("");
  const [profileA, setProfileA] = useState<string | null>(null);
  const [profileB, setProfileB] = useState<string | null>(null);
  const [genA, setGenA] = useState(false);
  const [genB, setGenB] = useState(false);
  const playerA = useAudioPlayer();
  const playerB = useAudioPlayer();

  const profilesWithSample = profiles.filter((p) => p.sampleName !== null);

  const handleGenerate = async (side: "A" | "B"): Promise<void> => {
    const pid = side === "A" ? profileA : profileB;
    if (!pid || !text.trim()) return;
    const setGen = side === "A" ? setGenA : setGenB;
    const player = side === "A" ? playerA : playerB;
    setGen(true);
    try {
      const result = await synthesize({
        text,
        voiceId: "",
        format: "mp3",
        speed: 100,
        pitch: 0,
        volume: 80,
        profileId: pid,
      });
      player.load(result.blob, result.duration);
    } catch (e) {
      onToast(`Error: ${e instanceof Error ? e.message : "Unknown"}`);
    } finally {
      setGen(false);
    }
  };

  const canGenA = profileA !== null && text.trim().length > 0 && !genA;
  const canGenB = profileB !== null && text.trim().length > 0 && !genB;

  return (
    <div>
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: radii.xl,
          padding: 20,
          marginBottom: 20,
        }}
      >
        <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700 }}>
          A/B Voice Comparison
        </h3>
        <p style={{ margin: "0 0 12px", fontSize: 12, color: colors.textDim }}>
          Write a test paragraph, pick two profiles, and compare how they sound side by side.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write test text here (1-2 paragraphs recommended)..."
          rows={4}
          style={{
            width: "100%",
            background: colors.surfaceAlt,
            border: `1px solid ${colors.borderSubtle}`,
            borderRadius: radii.md,
            color: colors.text,
            fontFamily: fonts.sans,
            fontSize: 14,
            lineHeight: 1.6,
            padding: 12,
            resize: "vertical",
            outline: "none",
            boxSizing: "border-box",
          }}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {(["A", "B"] as const).map((side) => {
          const profileId = side === "A" ? profileA : profileB;
          const setProfile = side === "A" ? setProfileA : setProfileB;
          const player = side === "A" ? playerA : playerB;
          const generating = side === "A" ? genA : genB;
          const canGen = side === "A" ? canGenA : canGenB;

          return (
            <div
              key={side}
              style={{
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: radii.xl,
                padding: 20,
              }}
            >
              <h4 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700 }}>
                Voice {side}
              </h4>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  maxHeight: 200,
                  overflowY: "auto",
                  marginBottom: 12,
                }}
              >
                {profilesWithSample.length === 0 ? (
                  <p style={{ fontSize: 12, color: colors.textDim, textAlign: "center", padding: 16 }}>
                    {t.noProfiles}
                  </p>
                ) : (
                  profilesWithSample.map((p) => {
                    const active = profileId === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => setProfile(p.id)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "8px 12px",
                          borderRadius: radii.sm,
                          background: active ? colors.primarySoft : colors.surfaceSubtle,
                          border: active
                            ? `1px solid ${colors.primaryBorder}`
                            : `1px solid ${colors.borderFaint}`,
                          cursor: "pointer",
                          color: colors.text,
                          fontFamily: fonts.sans,
                          fontSize: 13,
                        }}
                      >
                        {p.name}
                        {active && <Icons.Check />}
                      </button>
                    );
                  })
                )}
              </div>

              <button
                onClick={() => void handleGenerate(side)}
                disabled={!canGen}
                style={{
                  width: "100%",
                  padding: "12px 0",
                  borderRadius: radii.lg,
                  background: canGen
                    ? side === "A"
                      ? "linear-gradient(135deg, #3b82f6, #2563eb)"
                      : "linear-gradient(135deg, #8b5cf6, #7c3aed)"
                    : colors.textDark,
                  border: "none",
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: canGen ? "pointer" : "default",
                  fontFamily: fonts.sans,
                  opacity: canGen ? 1 : 0.4,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                <Icons.Waveform />
                {generating ? "Generating..." : `Generate ${side}`}
              </button>

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
        })}
      </div>

      {/* Quick Preview — test snippet against all profiles at once */}
      <QuickPreview
        t={t}
        text={text.slice(0, 300)}
        profiles={profilesWithSample}
        onToast={onToast}
      />
    </div>
  );
}

interface QuickPreviewProps {
  t: Translations;
  text: string;
  profiles: readonly Profile[];
  onToast: (msg: string) => void;
}

function QuickPreview({ t, text, profiles, onToast }: QuickPreviewProps) {
  const [results, setResults] = useState<Map<string, { url: string; duration: number }>>(new Map());
  const [running, setRunning] = useState(false);
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());

  if (profiles.length < 2 || !text.trim()) return null;

  const handlePreviewAll = async (): Promise<void> => {
    setRunning(true);
    const snippet = text.slice(0, 300);
    const newResults = new Map<string, { url: string; duration: number }>();

    for (const p of profiles) {
      try {
        const result = await synthesize({
          text: snippet,
          voiceId: "",
          format: "mp3",
          speed: 100,
          pitch: 0,
          volume: 80,
          profileId: p.id,
        });
        const url = URL.createObjectURL(result.blob);
        newResults.set(p.id, { url, duration: result.duration });
      } catch {
        // Skip failed profiles
      }
    }
    setResults(newResults);
    setRunning(false);
    if (newResults.size > 0) {
      onToast(`Preview generated for ${newResults.size} profiles`);
    }
  };

  const handlePlay = (profileId: string): void => {
    // Stop all others first
    for (const [id, el] of audioRefs.current) {
      if (id !== profileId) {
        el.pause();
        el.currentTime = 0;
      }
    }
    const el = audioRefs.current.get(profileId);
    if (el) void el.play().catch(() => undefined);
  };

  return (
    <div
      style={{
        marginTop: 20,
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: radii.xl,
        padding: 20,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>
          Quick Preview — first 300 chars vs all profiles
        </h4>
        <button
          onClick={() => void handlePreviewAll()}
          disabled={running || !text.trim()}
          style={{
            padding: "8px 16px",
            background: running ? colors.textDark : "linear-gradient(135deg, #10b981, #059669)",
            color: "#fff",
            border: "none",
            borderRadius: radii.md,
            fontSize: 12,
            fontWeight: 700,
            cursor: running ? "default" : "pointer",
            fontFamily: fonts.sans,
            opacity: running ? 0.5 : 1,
          }}
        >
          {running ? "Generating..." : "Preview All"}
        </button>
      </div>

      {results.size > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {profiles.map((p) => {
            const r = results.get(p.id);
            if (!r) return null;
            return (
              <div
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 14px",
                  background: colors.surfaceSubtle,
                  border: `1px solid ${colors.borderFaint}`,
                  borderRadius: radii.sm,
                }}
              >
                <button
                  onClick={() => handlePlay(p.id)}
                  aria-label={`${t.play} ${p.name}`}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    background: colors.primary,
                    border: "none",
                    color: "#fff",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Icons.Play />
                </button>
                <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                <span style={{ fontSize: 11, color: colors.textDim, fontFamily: fonts.mono }}>
                  {r.duration.toFixed(1)}s
                </span>
                <audio
                  ref={(el) => {
                    if (el) audioRefs.current.set(p.id, el);
                    else audioRefs.current.delete(p.id);
                  }}
                  src={r.url}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
