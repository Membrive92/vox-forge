import { Button } from "@/components/Button";
import * as Icons from "@/components/icons";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, typography } from "@/theme/tokens";

import type { StudioSource } from "@/api/studio";

interface Props {
  t: Translations;
  sources: readonly StudioSource[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (source: StudioSource) => void;
  onRefresh: () => void;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function SourcePicker({ t, sources, loading, selectedId, onSelect, onRefresh }: Props) {
  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: radii.xl,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        height: "100%",
        minHeight: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ margin: 0, fontSize: typography.size.base, fontWeight: 700 }}>
          {t.studioSourcesTitle}
        </h3>
        <Button variant="ghost" size="sm" onClick={onRefresh} disabled={loading}>
          {t.studioRefresh}
        </Button>
      </div>

      {loading ? (
        <p style={{ margin: 0, fontSize: typography.size.sm, color: colors.textDim }}>
          {t.studioSourcesLoading}
        </p>
      ) : sources.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "24px 12px",
            background: colors.surfaceSubtle,
            borderRadius: radii.lg,
            border: `1px dashed ${colors.borderFaint}`,
          }}
        >
          <div style={{ color: colors.textGhost, marginBottom: 6 }}>
            <Icons.Mic />
          </div>
          <p style={{ margin: 0, fontSize: typography.size.xs, color: colors.textDim }}>
            {t.studioSourcesEmpty}
          </p>
        </div>
      ) : (
        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: "none",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            overflowY: "auto",
            flex: 1,
            minHeight: 0,
          }}
        >
          {sources.map((source) => {
            const active = selectedId === source.id;
            return (
              <li key={source.id}>
                <button
                  type="button"
                  onClick={() => onSelect(source)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 12px",
                    borderRadius: radii.md,
                    background: active ? colors.primarySoft : colors.surfaceAlt,
                    border: active
                      ? `1px solid ${colors.primaryBorder}`
                      : `1px solid ${colors.borderHair}`,
                    color: colors.text,
                    cursor: "pointer",
                    transition: "all 0.15s",
                    fontFamily: fonts.sans,
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      fontSize: typography.size.sm,
                      fontWeight: 600,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {source.chapter_title}
                  </p>
                  <p
                    style={{
                      margin: "2px 0 0",
                      fontSize: typography.size.xs,
                      color: colors.textDim,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {source.project_name}
                  </p>
                  <p
                    style={{
                      margin: "4px 0 0",
                      fontSize: typography.size.xs,
                      fontFamily: fonts.mono,
                      color: colors.textFaint,
                    }}
                  >
                    {formatDuration(source.duration_s)}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
