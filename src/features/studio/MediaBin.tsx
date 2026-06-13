import { useState } from "react";

import { mediaFileUrl, type MediaAsset } from "@/api/studio";
import { Button } from "@/components/Button";
import { useConfirm } from "@/components/ConfirmProvider";
import { IconButton } from "@/components/IconButton";
import * as Icons from "@/components/icons";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, typography } from "@/theme/tokens";

interface Props {
  t: Translations;
  assets: readonly MediaAsset[];
  loading: boolean;
  onRefresh: (query?: string) => void;
  onDelete: (assetId: string) => void;
  /** "Usar como portada" — feeds the video render cover slot. */
  onUseAsCover: (asset: MediaAsset) => void;
}

function originLabel(t: Translations, origin: MediaAsset["origin"]): string {
  switch (origin) {
    case "generated": return t.studioMediaBinOriginGenerated;
    case "upload": return t.studioMediaBinOriginUpload;
    case "imported": return t.studioMediaBinOriginImported;
  }
}

/**
 * Thumbnail grid over the media library (T2I-2 / UX-03 M1-M2). Each tile
 * is served by id (``/media/file/{id}?thumb=true``) — the client never
 * touches a filesystem path. Delete is confirm-gated; "Usar como
 * portada" hands the asset back to the parent for the video render.
 */
export function MediaBin({ t, assets, loading, onRefresh, onDelete, onUseAsCover }: Props) {
  const confirm = useConfirm();
  const [search, setSearch] = useState("");

  const submitSearch = (): void => onRefresh(search.trim() || undefined);

  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: radii.xl,
        padding: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <h3 style={{ margin: 0, fontSize: typography.size.base, fontWeight: 700 }}>
          {t.studioMediaBinTitle}
        </h3>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitSearch();
              }
            }}
            placeholder={t.studioMediaBinSearch}
            aria-label={t.studioMediaBinSearch}
            style={{
              width: 160,
              boxSizing: "border-box",
              padding: "5px 9px",
              borderRadius: radii.sm,
              background: colors.surfaceAlt,
              border: `1px solid ${colors.border}`,
              color: colors.text,
              fontSize: typography.size.xs,
              fontFamily: fonts.sans,
            }}
          />
          <Button variant="ghost" size="sm" disabled={loading} onClick={submitSearch}>
            {t.studioMediaBinRefresh}
          </Button>
        </div>
      </div>

      {assets.length === 0 ? (
        <p style={{ margin: 0, fontSize: typography.size.xs, color: colors.textFaint, padding: "12px 4px" }}>
          {t.studioMediaBinEmpty}
        </p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
            gap: 12,
          }}
        >
          {assets.map((asset) => (
            <figure
              key={asset.id}
              style={{
                margin: 0,
                borderRadius: radii.md,
                background: colors.surfaceSubtle,
                border: `1px solid ${colors.borderFaint}`,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div style={{ position: "relative", aspectRatio: "16 / 9", background: "#000" }}>
                <img
                  src={mediaFileUrl(asset.id, true)}
                  alt={asset.prompt ?? asset.filename}
                  loading="lazy"
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
                <span
                  style={{
                    position: "absolute",
                    top: 6,
                    left: 6,
                    fontSize: 9,
                    fontWeight: 700,
                    fontFamily: fonts.mono,
                    padding: "2px 6px",
                    borderRadius: 3,
                    background: "rgba(0,0,0,0.6)",
                    color: colors.primaryLight,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}
                >
                  {originLabel(t, asset.origin)}
                </span>
                <span style={{ position: "absolute", top: 4, right: 4 }}>
                  <IconButton
                    aria-label={t.studioMediaBinDelete}
                    variant="danger"
                    size="sm"
                    onClick={async () => {
                      if (
                        await confirm({
                          title: t.confirmDeleteTitle,
                          message: t.studioMediaBinConfirmDelete,
                          confirmText: t.actionDelete,
                          cancelText: t.cancel,
                          confirmVariant: "danger",
                        })
                      ) {
                        onDelete(asset.id);
                      }
                    }}
                  >
                    <Icons.Trash />
                  </IconButton>
                </span>
              </div>

              <figcaption style={{ padding: "8px 10px", flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                <p
                  title={asset.prompt ?? ""}
                  style={{
                    margin: 0,
                    fontSize: typography.size.xs,
                    color: colors.text,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {asset.prompt ?? asset.filename}
                </p>
                {asset.seed !== null ? (
                  <p style={{ margin: 0, fontSize: 10, fontFamily: fonts.mono, color: colors.textDim }}>
                    {t.studioMediaBinSeed.replace("{seed}", String(asset.seed))}
                  </p>
                ) : null}
                <Button
                  variant="secondary"
                  size="sm"
                  title={t.studioMediaBinCoverSet}
                  onClick={() => onUseAsCover(asset)}
                >
                  {t.studioMediaBinUseAsCover}
                </Button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
