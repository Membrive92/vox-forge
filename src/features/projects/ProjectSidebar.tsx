import { useState } from "react";

import type { Project } from "@/api/projects";
import { Button } from "@/components/Button";
import { useConfirm } from "@/components/ConfirmProvider";
import { Skeleton } from "@/components/Skeleton";
import { activateOnKey } from "@/utils/a11y";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, space, transitions, typography } from "@/theme/tokens";

import { relativeTime } from "./workbenchHelpers";

// ── ProjectSidebar ──────────────────────────────────────────────────

interface SidebarProps {
  t: Translations;
  projects: readonly Project[];
  selectedId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

export function ProjectSidebar({ t, projects, selectedId, loading, onSelect, onNew, onDelete }: SidebarProps) {
  return (
    <div
      className="vf-workbench-sidebar"
      style={{
        borderRight: `1px solid ${colors.border}`,
        display: "flex",
        flexDirection: "column",
        background: colors.surfaceSubtle,
      }}
    >
      <div style={{ padding: space[3] }}>
        <Button variant="primary" fullWidth onClick={onNew}>
          {t.workbenchNewProject}
        </Button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: `0 ${space[2]}px ${space[2]}px` }}>
        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: space[1], padding: `${space[1]}px ${space[2]}px` }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={44} radius={8} />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <p
            style={{
              margin: 0,
              padding: `${space[4]}px ${space[3]}px`,
              fontSize: typography.size.xs,
              color: colors.textFaint,
              textAlign: "center",
              lineHeight: typography.leading.normal,
            }}
          >
            {t.workbenchNoProjects}
          </p>
        ) : (
          projects.map((p) => (
            <SidebarProjectRow
              key={p.id}
              t={t}
              project={p}
              active={p.id === selectedId}
              onSelect={() => onSelect(p.id)}
              onDelete={() => onDelete(p.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface ProjectRowProps {
  t: Translations;
  project: Project;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

function SidebarProjectRow({ t, project, active, onSelect, onDelete }: ProjectRowProps) {
  const [hover, setHover] = useState(false);
  const confirm = useConfirm();
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={project.name}
      aria-current={active ? "true" : undefined}
      onClick={onSelect}
      onKeyDown={activateOnKey(onSelect)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: `${space[2]}px ${space[3]}px`,
        borderRadius: radii.md,
        cursor: "pointer",
        marginBottom: space[1],
        display: "flex",
        alignItems: "center",
        gap: space[2],
        background: active ? colors.primarySoft : hover ? colors.surfaceAlt : "transparent",
        border: active ? `1px solid ${colors.primaryBorder}` : "1px solid transparent",
        transition: transitions.fast,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            color: active ? colors.primaryLight : colors.text,
            fontSize: typography.size.sm,
            fontWeight: typography.weight.medium,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {project.name}
        </div>
        <div
          style={{
            color: colors.textDim,
            fontSize: typography.size.xs,
            marginTop: 2,
            fontFamily: fonts.mono,
          }}
        >
          {relativeTime(project.updated_at, t)}
        </div>
      </div>
      {(hover || active) && (
        <button
          onClick={async (e) => {
            e.stopPropagation();
            if (
              await confirm({
                title: t.confirmDeleteTitle,
                message: t.confirmDeleteProject.replace("{name}", project.name),
                confirmText: t.actionDelete,
                cancelText: t.cancel,
                confirmVariant: "danger",
              })
            ) {
              onDelete();
            }
          }}
          aria-label={`${t.actionDelete} ${project.name}`}
          style={{
            background: "none",
            border: "none",
            color: colors.textFaint,
            cursor: "pointer",
            fontSize: typography.size.base,
            padding: "4px 8px",
            borderRadius: radii.sm,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            lineHeight: 1,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
