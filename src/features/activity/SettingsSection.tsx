/**
 * Settings section for the Activity tab (Phase 4).
 *
 * Hosts the pronunciation dictionary and export defaults. These live
 * inside Activity because they're global configuration, not a workflow —
 * you set them once and forget, so they don't deserve a top-level tab.
 */
import { useState } from "react";

import { PronunciationTab } from "./PronunciationTab";
import { useExportSettings } from "@/hooks/useExportSettings";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, typography } from "@/theme/tokens";

interface Props {
  t: Translations;
  onToast: (msg: string) => void;
}

export function SettingsSection({ t, onToast }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          padding: "14px 20px",
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: radii.xl,
          color: colors.text,
          fontFamily: fonts.sans,
          fontSize: typography.size.base,
          fontWeight: 700,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span>{t.settingsSection}</span>
        <span
          style={{
            color: colors.textDim,
            fontSize: 18,
            lineHeight: 1,
          }}
        >
          {open ? "−" : "+"}
        </span>
      </button>

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: 12 }}>
          <SubSection title={t.settingsExportDefaults}>
            <ExportDefaultsForm t={t} />
          </SubSection>

          <SubSection title={t.settingsPronunciation}>
            <PronunciationTab t={t} onToast={onToast} />
          </SubSection>
        </div>
      )}
    </div>
  );
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4
        style={{
          margin: "0 0 10px",
          fontSize: typography.size.xs,
          fontWeight: 700,
          color: colors.textDim,
          textTransform: "uppercase",
          letterSpacing: "2px",
          fontFamily: fonts.sans,
        }}
      >
        {title}
      </h4>
      {children}
    </div>
  );
}

function ExportDefaultsForm({ t }: { t: Translations }) {
  const { settings, update, renderFilename } = useExportSettings();

  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: radii.xl,
        padding: 20,
      }}
    >
      <p
        style={{
          margin: "0 0 16px",
          fontSize: typography.size.sm,
          color: colors.textDim,
          lineHeight: 1.5,
        }}
      >
        {t.exportDefaultsDesc}
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field
          label={t.exportFieldTitle}
          value={settings.storyTitle}
          onChange={(v) => update({ storyTitle: v })}
          placeholder={t.exportTitlePlaceholder}
        />
        <Field
          label={t.exportFieldArtist}
          value={settings.artist}
          onChange={(v) => update({ artist: v })}
          placeholder={t.exportArtistPlaceholder}
        />
        <Field
          label={t.exportFieldAlbum}
          value={settings.album}
          onChange={(v) => update({ album: v })}
          placeholder={t.exportAlbumPlaceholder}
        />
        <Field
          label={t.exportFieldTrack}
          type="number"
          value={String(settings.trackNumber)}
          onChange={(v) => update({ trackNumber: Math.max(1, Number(v) || 1) })}
        />
      </div>

      <div style={{ marginTop: 12 }}>
        <Field
          label={t.exportFieldFilename}
          value={settings.filenamePattern}
          onChange={(v) => update({ filenamePattern: v })}
          placeholder="{story}_{track}_{date}.{fmt}"
        />
        <p
          style={{
            margin: "6px 0 0",
            fontSize: typography.size.xs,
            color: colors.textFaint,
            fontFamily: fonts.mono,
          }}
        >
          {t.exportTokensLabel} {"{story}"} {"{artist}"} {"{track}"} {"{date}"} {"{time}"} {"{fmt}"}
        </p>
        <p
          style={{
            margin: "8px 0 0",
            fontSize: typography.size.xs,
            color: colors.primaryLight,
            fontFamily: fonts.mono,
            wordBreak: "break-all",
          }}
        >
          → {renderFilename("mp3")}
        </p>
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}

function Field({ label, value, onChange, placeholder, type = "text" }: FieldProps) {
  return (
    <label style={{ display: "block" }}>
      <span
        style={{
          display: "block",
          fontSize: typography.size.xs,
          color: colors.textFaint,
          fontFamily: fonts.mono,
          textTransform: "uppercase",
          letterSpacing: "1px",
          marginBottom: 4,
        }}
      >
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: "100%",
          padding: "8px 12px",
          background: colors.surfaceAlt,
          border: `1px solid ${colors.borderFaint}`,
          borderRadius: radii.sm,
          color: colors.text,
          fontSize: typography.size.sm,
          fontFamily: fonts.sans,
          boxSizing: "border-box",
        }}
      />
    </label>
  );
}
