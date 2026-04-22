import { useState } from "react";

import type { SrtEntry, TranscribeResult } from "@/api/studio";
import { Button } from "@/components/Button";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, typography } from "@/theme/tokens";

interface Props {
  t: Translations;
  enabled: boolean;
  isTranscribing: boolean;
  transcript: TranscribeResult | null;
  onTranscribe: (language?: string) => void;
  onCancel: () => void;
  onEntryClick?: (entry: SrtEntry) => void;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function TranscribePanel({
  t,
  enabled,
  isTranscribing,
  transcript,
  onTranscribe,
  onCancel,
  onEntryClick,
}: Props) {
  const [language, setLanguage] = useState("");

  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: radii.xl,
        padding: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: typography.size.base, fontWeight: 700 }}>
            {t.studioTranscribeTitle}
          </h3>
          <p style={{ margin: "2px 0 0", fontSize: typography.size.xs, color: colors.textDim }}>
            {t.studioTranscribeHint}
          </p>
        </div>
        {isTranscribing ? (
          <Button variant="danger" size="sm" onClick={onCancel}>
            {t.cancel}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            disabled={!enabled}
            onClick={() => onTranscribe(language.trim() || undefined)}
          >
            {transcript ? t.studioTranscribeRegen : t.studioTranscribeStart}
          </Button>
        )}
      </div>

      <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
        <label style={{ fontSize: typography.size.xs, color: colors.textDim }}>
          {t.studioTranscribeLangHint}
        </label>
        <input
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          placeholder="es, en, fr…"
          style={{
            width: 90,
            padding: "4px 8px",
            borderRadius: radii.sm,
            background: colors.surfaceAlt,
            border: `1px solid ${colors.border}`,
            color: colors.text,
            fontSize: typography.size.xs,
            fontFamily: fonts.mono,
            outline: "none",
          }}
        />
      </div>

      {transcript ? (
        <>
          <p
            style={{
              margin: "12px 0 8px",
              fontSize: typography.size.xs,
              color: colors.textDim,
              fontFamily: fonts.mono,
            }}
          >
            {t.studioTranscribeDone
              .replace("{n}", String(transcript.entries.length))
              .replace("{w}", String(transcript.word_count))
              .replace("{engine}", transcript.engine)}
          </p>
          <ul
            style={{
              margin: 0,
              padding: 8,
              listStyle: "none",
              display: "flex",
              flexDirection: "column",
              gap: 4,
              maxHeight: 240,
              overflowY: "auto",
              background: colors.surfaceSubtle,
              border: `1px solid ${colors.borderFaint}`,
              borderRadius: radii.md,
            }}
          >
            {transcript.entries.map((entry) => (
              <li key={entry.index}>
                <button
                  type="button"
                  onClick={() => onEntryClick?.(entry)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "6px 8px",
                    borderRadius: radii.sm,
                    background: "transparent",
                    border: "none",
                    cursor: onEntryClick ? "pointer" : "default",
                    display: "flex",
                    gap: 10,
                    color: colors.text,
                    fontFamily: fonts.sans,
                    fontSize: typography.size.xs,
                  }}
                >
                  <span
                    style={{
                      color: colors.textDim,
                      fontFamily: fonts.mono,
                      minWidth: 52,
                      flexShrink: 0,
                    }}
                  >
                    {formatTime(entry.start_s)}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>{entry.text}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p
          style={{
            margin: "12px 0 0",
            fontSize: typography.size.xs,
            color: colors.textFaint,
          }}
        >
          {t.studioTranscribeEmpty}
        </p>
      )}
    </div>
  );
}
