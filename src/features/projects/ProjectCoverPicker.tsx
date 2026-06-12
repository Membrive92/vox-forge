import { useRef } from "react";

import type { Project } from "@/api/projects";
import { Button } from "@/components/Button";
import type { Translations } from "@/i18n";
import { colors, fonts, space, typography } from "@/theme/tokens";

// ── ProjectCoverPicker ──────────────────────────────────────────────

interface CoverPickerProps {
  t: Translations;
  project: Project;
  onPickCover: (file: File) => void;
  onClearCover: () => void;
}

export function ProjectCoverPicker({ t, project, onPickCover, onClearCover }: CoverPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const coverFilename = project.cover_path
    ? project.cover_path.split(/[\\/]/).pop() ?? project.cover_path
    : null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: space[2],
        padding: `${space[2]}px 0 ${space[3]}px`,
        borderBottom: `1px solid ${colors.borderSubtle}`,
      }}
    >
      <label
        style={{
          fontSize: typography.size.xs,
          color: colors.textDim,
          fontWeight: typography.weight.semibold,
          textTransform: "uppercase",
          letterSpacing: "1px",
        }}
      >
        {t.workbenchCover}
      </label>
      <input
        ref={inputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.webp"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPickCover(f);
          e.target.value = "";
        }}
      />
      {coverFilename ? (
        <>
          <span
            style={{
              fontSize: typography.size.xs,
              color: colors.textMuted,
              fontFamily: fonts.mono,
              maxWidth: 240,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {coverFilename}
          </span>
          <Button variant="ghost" size="sm" onClick={() => inputRef.current?.click()}>
            {t.workbenchChangeCover}
          </Button>
          <Button variant="ghost" size="sm" onClick={onClearCover}>
            ×
          </Button>
        </>
      ) : (
        <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()}>
          {t.workbenchUploadCover}
        </Button>
      )}
    </div>
  );
}
