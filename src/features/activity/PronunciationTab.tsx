import { useEffect, useState } from "react";

import {
  deletePronunciation,
  listPronunciations,
  upsertPronunciation,
} from "@/api/pronunciation";
import { Button } from "@/components/Button";
import { colors, fonts, radii, typography } from "@/theme/tokens";

interface Props {
  onToast: (msg: string) => void;
}

export function PronunciationTab({ onToast }: Props) {
  const [entries, setEntries] = useState<Record<string, string>>({});
  const [word, setWord] = useState("");
  const [replacement, setReplacement] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async (): Promise<void> => {
    try {
      const data = await listPronunciations();
      setEntries(data.entries);
    } catch (e) {
      onToast(`Error: ${e instanceof Error ? e.message : "Unknown"}`);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAdd = async (): Promise<void> => {
    if (!word.trim() || !replacement.trim()) return;
    setLoading(true);
    try {
      await upsertPronunciation({ word: word.trim(), replacement: replacement.trim() });
      setWord("");
      setReplacement("");
      await load();
      onToast("Saved");
    } catch (e) {
      onToast(`Error: ${e instanceof Error ? e.message : "Unknown"}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (w: string): Promise<void> => {
    if (!window.confirm(`Delete "${w}"?`)) return;
    try {
      await deletePronunciation(w);
      await load();
    } catch (e) {
      onToast(`Error: ${e instanceof Error ? e.message : "Unknown"}`);
    }
  };

  const sortedEntries = Object.entries(entries).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: radii.xl,
        padding: 24,
        backdropFilter: "blur(12px)",
        maxWidth: 800,
        margin: "0 auto",
      }}
    >
      <h3 style={{ margin: "0 0 4px", fontSize: typography.size.lg, fontWeight: 700 }}>Pronunciation dictionary</h3>
      <p style={{ margin: "0 0 20px", fontSize: typography.size.sm, color: colors.textDim }}>
        Override how specific words are spoken. Useful for fantasy names, acronyms, or loanwords
        the TTS engine mispronounces. Replacements are applied as whole-word, case-insensitive
        substitutions before all other normalization.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          value={word}
          onChange={(e) => setWord(e.target.value)}
          placeholder="Word (e.g. Caelthir)"
          style={inputStyle}
        />
        <input
          value={replacement}
          onChange={(e) => setReplacement(e.target.value)}
          placeholder="Phonetic spelling (e.g. Quelzir)"
          style={inputStyle}
        />
        <Button
          variant="primary"
          loading={loading}
          disabled={!word.trim() || !replacement.trim()}
          onClick={() => void handleAdd()}
        >
          Add
        </Button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {sortedEntries.length === 0 ? (
          <p style={{ fontSize: typography.size.sm, color: colors.textDim, textAlign: "center", padding: 20 }}>
            No entries yet
          </p>
        ) : (
          sortedEntries.map(([w, r]) => (
            <div
              key={w}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "8px 12px",
                background: colors.surfaceSubtle,
                border: `1px solid ${colors.borderFaint}`,
                borderRadius: radii.sm,
                fontFamily: fonts.mono,
                fontSize: typography.size.sm,
              }}
            >
              <span style={{ flex: 1, color: colors.text }}>{w}</span>
              <span style={{ color: colors.textDim, margin: "0 12px" }}>→</span>
              <span style={{ flex: 1, color: colors.primaryLight }}>{r}</span>
              <button
                onClick={() => void handleDelete(w)}
                aria-label={`Delete ${w}`}
                style={{
                  background: "none",
                  border: "none",
                  color: colors.textFaint,
                  cursor: "pointer",
                  fontSize: typography.size.lg,
                  padding: "0 6px",
                }}
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: "8px 12px",
  background: colors.surfaceAlt,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.sm,
  color: colors.text,
  fontSize: typography.size.sm,
  fontFamily: fonts.sans,
  outline: "none",
};
