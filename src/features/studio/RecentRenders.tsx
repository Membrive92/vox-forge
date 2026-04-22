import { useState } from "react";

import { API_BASE } from "@/api/client";
import type { StudioRender } from "@/api/studio";
import { Button } from "@/components/Button";
import { IconButton } from "@/components/IconButton";
import * as Icons from "@/components/icons";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, typography } from "@/theme/tokens";

type Filter = "all" | "audio" | "video";

interface Props {
  t: Translations;
  renders: readonly StudioRender[];
  loading: boolean;
  onRefresh: (kind?: "audio" | "video") => void;
  onDelete: (renderId: string) => void;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function RecentRenders({ t, renders, loading, onRefresh, onDelete }: Props) {
  const [filter, setFilter] = useState<Filter>("all");

  const handleFilter = (f: Filter): void => {
    setFilter(f);
    onRefresh(f === "all" ? undefined : f);
  };

  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: radii.xl,
        padding: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: typography.size.base, fontWeight: 700 }}>
          {t.studioRecentTitle}
        </h3>
        <Button
          variant="ghost"
          size="sm"
          disabled={loading}
          onClick={() => onRefresh(filter === "all" ? undefined : filter)}
        >
          {t.studioRefresh}
        </Button>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {(["all", "audio", "video"] as const).map((f) => {
          const active = filter === f;
          const label =
            f === "all"
              ? t.studioRecentFilterAll
              : f === "audio"
                ? t.studioRecentFilterAudio
                : t.studioRecentFilterVideo;
          return (
            <button
              key={f}
              type="button"
              onClick={() => handleFilter(f)}
              style={{
                padding: "4px 10px",
                fontSize: typography.size.xs,
                fontWeight: 600,
                borderRadius: radii.sm,
                background: active ? colors.primarySoft : "transparent",
                color: active ? colors.primaryLight : colors.textDim,
                border: `1px solid ${active ? colors.primaryBorder : colors.borderFaint}`,
                cursor: "pointer",
                fontFamily: fonts.sans,
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {renders.length === 0 ? (
        <p style={{ margin: 0, fontSize: typography.size.xs, color: colors.textFaint, padding: "12px 4px" }}>
          {t.studioRecentEmpty}
        </p>
      ) : (
        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: "none",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            maxHeight: 280,
            overflowY: "auto",
          }}
        >
          {renders.map((r) => {
            const audioUrl = `${API_BASE}/studio/audio?path=${encodeURIComponent(r.output_path)}`;
            return (
              <li
                key={r.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 10px",
                  borderRadius: radii.md,
                  background: colors.surfaceSubtle,
                  border: `1px solid ${colors.borderFaint}`,
                }}
              >
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    fontFamily: fonts.mono,
                    padding: "2px 6px",
                    borderRadius: 3,
                    background: r.kind === "video" ? "rgba(139,92,246,0.15)" : "rgba(59,130,246,0.15)",
                    color: r.kind === "video" ? "#a78bfa" : colors.primaryLight,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    minWidth: 42,
                    textAlign: "center",
                  }}
                >
                  {r.kind}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p
                    style={{
                      margin: 0,
                      fontSize: typography.size.xs,
                      color: colors.text,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {r.output_path.split(/[\\/]/).pop()}
                  </p>
                  <p
                    style={{
                      margin: 0,
                      fontSize: typography.size.xs,
                      color: colors.textDim,
                      fontFamily: fonts.mono,
                    }}
                  >
                    {formatDate(r.created_at)} · {r.duration_s.toFixed(1)}s · {formatSize(r.size_bytes)}
                  </p>
                </div>
                {r.kind === "audio" ? (
                  <a
                    href={audioUrl}
                    download
                    style={{
                      color: colors.primaryLight,
                      fontSize: typography.size.xs,
                      textDecoration: "none",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <Icons.Download />
                  </a>
                ) : null}
                <IconButton
                  aria-label={t.studioRecentDelete}
                  variant="danger"
                  size="sm"
                  onClick={() => onDelete(r.id)}
                >
                  <Icons.Trash />
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
