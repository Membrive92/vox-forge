import { useEffect, useState } from "react";

import {
  deletePronunciation,
  listPronunciations,
  upsertPronunciation,
} from "@/api/pronunciation";
import { Button } from "@/components/Button";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, typography } from "@/theme/tokens";

interface Props {
  t: Translations;
  onToast: (msg: string) => void;
}

export function PronunciationTab({ t, onToast }: Props) {
  const [entries, setEntries] = useState<Record<string, string>>({});
  const [word, setWord] = useState("");
  const [replacement, setReplacement] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async (): Promise<void> => {
    try {
      const data = await listPronunciations();
      setEntries(data.entries);
    } catch (e) {
      onToast(`Error: ${e instanceof Error ? e.message : t.unknownError}`);
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
      onToast(t.pronunciationSavedToast);
    } catch (e) {
      onToast(`Error: ${e instanceof Error ? e.message : t.unknownError}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (w: string): Promise<void> => {
    if (!window.confirm(t.pronunciationDeleteConfirm.replace("{word}", w))) return;
    try {
      await deletePronunciation(w);
      await load();
    } catch (e) {
      onToast(`Error: ${e instanceof Error ? e.message : t.unknownError}`);
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
      <h3 style={{ margin: "0 0 4px", fontSize: typography.size.lg, fontWeight: 700 }}>{t.settingsPronunciation}</h3>
      <p style={{ margin: "0 0 20px", fontSize: typography.size.sm, color: colors.textDim }}>
        {t.pronunciationDictDesc}
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          value={word}
          onChange={(e) => setWord(e.target.value)}
          placeholder={t.pronunciationWordPlaceholder}
          style={inputStyle}
        />
        <input
          value={replacement}
          onChange={(e) => setReplacement(e.target.value)}
          placeholder={t.pronunciationReplacementPlaceholder}
          style={inputStyle}
        />
        <Button
          variant="primary"
          loading={loading}
          disabled={!word.trim() || !replacement.trim()}
          onClick={() => void handleAdd()}
        >
          {t.pronunciationAdd}
        </Button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {sortedEntries.length === 0 ? (
          <p style={{ fontSize: typography.size.sm, color: colors.textDim, textAlign: "center", padding: 20 }}>
            {t.pronunciationEmpty}
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
                aria-label={`${t.actionDelete} ${w}`}
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
};
