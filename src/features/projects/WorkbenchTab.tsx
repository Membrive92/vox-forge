import { useCallback, useEffect, useRef, useState } from "react";

import {
  createChapter,
  createProject,
  deleteChapter,
  deleteProject,
  listChapters,
  listProjects,
  splitIntoChapters,
  updateChapter,
  updateProject,
  type Chapter,
  type Project,
} from "@/api/projects";
import { API_BASE } from "@/api/client";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { IconButton } from "@/components/IconButton";
import { Skeleton } from "@/components/Skeleton";
import * as Icons from "@/components/icons";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, space, transitions, typography } from "@/theme/tokens";

import { AmbienceMixer } from "./AmbienceMixer";
import { CharacterCasting } from "./CharacterCasting";
import { ChunkMap } from "./ChunkMap";
import { QuickPreview } from "./QuickPreview";

// ── Utility helpers ─────────────────────────────────────────────────

function relativeTime(iso: string, t: Translations): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return t.timeJustNow;
  if (mins < 60) return t.timeMinutesAgo.replace("{n}", String(mins));
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t.timeHoursAgo.replace("{n}", String(hours));
  const days = Math.floor(hours / 24);
  if (days < 7) return t.timeDaysAgo.replace("{n}", String(days));
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function estimateDuration(text: string): string {
  const secs = text.length / 15;
  if (secs < 60) return `${Math.round(secs)}s`;
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

type PanelKey = "chunks" | "preview" | "cast" | "ambient" | null;

// ── ChapterCard ─────────────────────────────────────────────────────

interface ChapterCardProps {
  t: Translations;
  chapter: Chapter;
  project: Project;
  onUpdate: (id: string, data: Partial<Chapter>) => Promise<void>;
  onDelete: (id: string) => void;
  onToast: (msg: string) => void;
}

function ChapterCard({ t, chapter, project, onUpdate, onDelete, onToast }: ChapterCardProps) {
  const [collapsed, setCollapsed] = useState(false);
  // One panel at a time — cleaner than 4 independent booleans and makes
  // the toolbar feel like a mini-tab bar.
  const [activePanel, setActivePanel] = useState<PanelKey>(null);
  const [title, setTitle] = useState(chapter.title);
  const [text, setText] = useState(chapter.text);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setTitle(chapter.title); }, [chapter.title]);
  useEffect(() => { setText(chapter.text); }, [chapter.text]);

  const saveText = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (text !== chapter.text) void onUpdate(chapter.id, { text });
    }, 1000);
  }, [text, chapter.text, chapter.id, onUpdate]);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const togglePanel = (key: Exclude<PanelKey, null>): void => {
    setActivePanel((prev) => (prev === key ? null : key));
  };

  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: radii.lg,
        padding: space[4],
        marginBottom: space[3],
      }}
    >
      {/* Header: collapse + title + meta + toolbar + delete */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: space[2],
          flexWrap: "wrap",
        }}
      >
        <button
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand chapter" : "Collapse chapter"}
          style={{
            background: "none",
            border: "none",
            color: colors.textMuted,
            cursor: "pointer",
            transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
            transition: transitions.fast,
            padding: 2,
            display: "flex",
          }}
        >
          <Icons.ChevDown />
        </button>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => { if (title !== chapter.title) void onUpdate(chapter.id, { title }); }}
          style={{
            minWidth: 140,
            flex: 1,
            background: "transparent",
            border: "none",
            color: colors.text,
            fontFamily: fonts.sans,
            fontSize: typography.size.base,
            fontWeight: typography.weight.semibold,
            outline: "none",
            padding: "2px 4px",
            borderRadius: radii.sm,
          }}
        />

        {/* Meta — char count + duration, visible even when collapsed */}
        <span
          style={{
            fontSize: typography.size.xs,
            color: colors.textDim,
            fontFamily: fonts.mono,
            whiteSpace: "nowrap",
          }}
        >
          {text.length} chars · ~{estimateDuration(text)}
        </span>

        {/* Toolbar — 4 tool toggles */}
        <div style={{ display: "flex", gap: space[1], flexShrink: 0 }}>
          <ToolToggle
            label={t.chapterPreview}
            active={activePanel === "preview"}
            onClick={() => togglePanel("preview")}
          />
          <ToolToggle
            label={t.chapterChunks}
            active={activePanel === "chunks"}
            onClick={() => togglePanel("chunks")}
          />
          <ToolToggle
            label={t.chapterCast}
            active={activePanel === "cast"}
            onClick={() => togglePanel("cast")}
          />
          <ToolToggle
            label={t.chapterAmbient}
            active={activePanel === "ambient"}
            onClick={() => togglePanel("ambient")}
          />
        </div>

        <IconButton
          aria-label={`Delete chapter ${chapter.title}`}
          variant="ghost"
          size="sm"
          onClick={() => onDelete(chapter.id)}
        >
          <Icons.Trash />
        </IconButton>
      </div>

      {/* Body */}
      {!collapsed && (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={saveText}
            rows={6}
            style={{
              width: "100%",
              marginTop: space[3],
              background: colors.surfaceAlt,
              border: `1px solid ${colors.borderSubtle}`,
              borderRadius: radii.md,
              color: colors.text,
              fontFamily: fonts.sans,
              fontSize: typography.size.base,
              lineHeight: typography.leading.relaxed,
              padding: space[3],
              resize: "vertical",
              outline: "none",
              boxSizing: "border-box",
            }}
          />

          {activePanel === "preview" && (
            <div style={{ marginTop: space[3] }}>
              <QuickPreview
                t={t}
                chapterText={text}
                voiceId={project.voice_id}
                profileId={project.profile_id}
                speed={project.speed}
                pitch={project.pitch}
                volume={project.volume}
                outputFormat={project.output_format}
                onToast={onToast}
              />
            </div>
          )}
          {activePanel === "chunks" && (
            <div style={{ marginTop: space[3] }}>
              <ChunkMap
                t={t}
                chapterId={chapter.id}
                chapterTitle={chapter.title}
                onToast={onToast}
              />
            </div>
          )}
          {activePanel === "cast" && (
            <div style={{ marginTop: space[3] }}>
              <CharacterCasting
                t={t}
                chapterText={text}
                chapterTitle={chapter.title}
                onToast={onToast}
              />
            </div>
          )}
          {activePanel === "ambient" && (
            <div style={{ marginTop: space[3] }}>
              <AmbienceMixer t={t} chapterId={chapter.id} onToast={onToast} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Consistent toolbar button — one style for all 4 tools, only active state differs.
function ToolToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      style={{
        padding: "6px 12px",
        fontSize: typography.size.xs,
        fontWeight: typography.weight.semibold,
        background: active ? colors.primarySoft : "transparent",
        color: active ? colors.primaryLight : colors.textDim,
        border: `1px solid ${active ? colors.primaryBorder : colors.border}`,
        borderRadius: radii.sm,
        cursor: "pointer",
        fontFamily: fonts.sans,
        transition: transitions.fast,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

// ── WorkbenchTab ────────────────────────────────────────────────────

export function WorkbenchTab({ t, onToast }: { t: Translations; onToast: (msg: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [projectName, setProjectName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const bulkTextRef = useRef<HTMLTextAreaElement>(null);

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  const loadProjects = useCallback(async () => {
    setProjectsLoading(true);
    try {
      const list = await listProjects();
      setProjects(list.sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
    } catch { onToast("Failed to load projects"); } finally {
      setProjectsLoading(false);
    }
  }, [onToast]);

  const loadChapters = useCallback(async (pid: string) => {
    try {
      const list = await listChapters(pid);
      setChapters(list.sort((a, b) => a.sort_order - b.sort_order));
    } catch { onToast("Failed to load chapters"); }
  }, [onToast]);

  useEffect(() => { void loadProjects(); }, [loadProjects]);

  useEffect(() => {
    if (selectedId) void loadChapters(selectedId);
    else setChapters([]);
  }, [selectedId, loadChapters]);

  useEffect(() => {
    if (selected) setProjectName(selected.name);
  }, [selected]);

  const handleNewProject = useCallback(async () => {
    try {
      const p = await createProject({ name: t.workbenchDefaultProjectName });
      setProjects((prev) => [p, ...prev]);
      setSelectedId(p.id);
      setRenaming(true);
      setTimeout(() => nameInputRef.current?.select(), 50);
    } catch { onToast("Failed to create project"); }
  }, [onToast, t.workbenchDefaultProjectName]);

  const handleDeleteProject = useCallback(async (id: string) => {
    try {
      await deleteProject(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
      if (selectedId === id) setSelectedId(null);
    } catch { onToast("Failed to delete project"); }
  }, [onToast, selectedId]);

  const handleRenameProject = useCallback(async () => {
    setRenaming(false);
    if (!selected || projectName === selected.name) return;
    try {
      const updated = await updateProject(selected.id, { name: projectName });
      setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } catch { onToast("Failed to rename project"); }
  }, [selected, projectName, onToast]);

  const handleAddChapter = useCallback(async () => {
    if (!selectedId) return;
    try {
      const ch = await createChapter(selectedId, {
        title: t.workbenchDefaultChapterName.replace("{n}", String(chapters.length + 1)),
        sort_order: chapters.length,
      });
      setChapters((prev) => [...prev, ch]);
    } catch { onToast("Failed to add chapter"); }
  }, [selectedId, chapters.length, onToast, t.workbenchDefaultChapterName]);

  const handleSplitPaste = useCallback(async () => {
    if (!selectedId) return;
    const text = bulkTextRef.current?.value ?? "";
    if (!text.trim()) {
      onToast(t.workbenchPasteFirst);
      return;
    }
    try {
      const chs = await splitIntoChapters(selectedId, text);
      setChapters(chs.sort((a, b) => a.sort_order - b.sort_order));
      onToast(t.workbenchSplitDone.replace("{n}", String(chs.length)));
    } catch { onToast("Failed to split text"); }
  }, [selectedId, onToast, t.workbenchPasteFirst, t.workbenchSplitDone]);

  const handleSplitPrompt = useCallback(async () => {
    // Fallback for when the user has existing chapters — we don't want
    // to show the paste box at the top in that case.
    if (!selectedId) return;
    const text = window.prompt(t.workbenchPastePrompt);
    if (!text) return;
    try {
      const chs = await splitIntoChapters(selectedId, text);
      setChapters(chs.sort((a, b) => a.sort_order - b.sort_order));
      onToast(t.workbenchSplitDone.replace("{n}", String(chs.length)));
    } catch { onToast("Failed to split text"); }
  }, [selectedId, onToast, t.workbenchPastePrompt, t.workbenchSplitDone]);

  const handleUpdateChapter = useCallback(async (id: string, data: Partial<Chapter>) => {
    try {
      const updated = await updateChapter(id, data);
      setChapters((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    } catch { onToast("Failed to update chapter"); }
  }, [onToast]);

  const handleDeleteChapter = useCallback(async (id: string) => {
    try {
      await deleteChapter(id);
      setChapters((prev) => prev.filter((c) => c.id !== id));
    } catch { onToast("Failed to delete chapter"); }
  }, [onToast]);

  const handleExportAll = (): void => {
    if (!selectedId) return;
    const url = `${API_BASE}/export/${selectedId}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `${projectName || "project"}_export.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    onToast(t.workbenchExportStarted);
  };

  return (
    <div style={{ display: "flex", height: "100%", fontFamily: fonts.sans }}>
      {/* Sidebar */}
      <ProjectSidebar
        t={t}
        projects={projects}
        selectedId={selectedId}
        loading={projectsLoading}
        onSelect={setSelectedId}
        onNew={() => void handleNewProject()}
        onDelete={(id) => void handleDeleteProject(id)}
      />

      {/* Main */}
      <div style={{ flex: 1, overflowY: "auto", padding: space[6] }}>
        {!selected ? (
          <EmptyState
            icon={<Icons.Book />}
            title={t.workbenchWelcomeTitle}
            description={t.workbenchWelcomeDesc}
            action={
              <Button
                variant="primary"
                size="lg"
                onClick={() => void handleNewProject()}
              >
                {t.workbenchCreateFirst}
              </Button>
            }
          >
            <div
              style={{
                marginTop: space[6],
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: space[3],
                maxWidth: 640,
              }}
            >
              <HowItWorksStep n={1} title={t.workbenchStep1Title} description={t.workbenchStep1Desc} />
              <HowItWorksStep n={2} title={t.workbenchStep2Title} description={t.workbenchStep2Desc} />
              <HowItWorksStep n={3} title={t.workbenchStep3Title} description={t.workbenchStep3Desc} />
            </div>
          </EmptyState>
        ) : (
          <>
            <Breadcrumb
              items={[
                { label: t.workbenchBreadcrumb },
                { label: projectName || t.workbenchUntitledProject },
              ]}
            />

            {/* Project header: editable name with affordance */}
            <div
              onClick={() => {
                if (!renaming) {
                  setRenaming(true);
                  setTimeout(() => nameInputRef.current?.focus(), 20);
                }
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: space[2],
                paddingBottom: space[3],
                borderBottom: `1px solid ${colors.borderSubtle}`,
                cursor: renaming ? "text" : "pointer",
              }}
            >
              <input
                ref={nameInputRef}
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                onFocus={() => setRenaming(true)}
                onBlur={() => void handleRenameProject()}
                placeholder={t.workbenchUntitledProject}
                style={{
                  background: "transparent",
                  border: "none",
                  color: colors.text,
                  fontFamily: fonts.serif,
                  fontSize: 24,
                  fontWeight: typography.weight.bold,
                  outline: "none",
                  flex: 1,
                  padding: 0,
                  cursor: renaming ? "text" : "pointer",
                }}
              />
              {!renaming && (
                <span
                  aria-hidden
                  style={{
                    color: colors.textFaint,
                    display: "flex",
                    opacity: 0.5,
                  }}
                >
                  <Icons.Edit />
                </span>
              )}
            </div>

            {/* Primary actions */}
            <div style={{ display: "flex", gap: space[2], margin: `${space[4]}px 0 ${space[5]}px` }}>
              <Button variant="secondary" onClick={() => void handleAddChapter()}>
                {t.workbenchAddChapter}
              </Button>
              {chapters.length > 0 && (
                <Button variant="secondary" onClick={() => void handleSplitPrompt()}>
                  {t.workbenchSplitText}
                </Button>
              )}
              <div style={{ flex: 1 }} />
              {chapters.length > 0 && (
                <Button variant="secondary" icon={<Icons.Download />} onClick={handleExportAll}>
                  {t.workbenchExportAll}
                </Button>
              )}
            </div>

            {/* Empty chapters: hero paste box */}
            {chapters.length === 0 ? (
              <div
                style={{
                  background: colors.surface,
                  border: `1px dashed ${colors.border}`,
                  borderRadius: radii.xl,
                  padding: space[6],
                  textAlign: "center",
                }}
              >
                <h3
                  style={{
                    margin: 0,
                    fontSize: typography.size.lg,
                    fontWeight: typography.weight.bold,
                    color: colors.text,
                  }}
                >
                  {t.workbenchPasteYourStory}
                </h3>
                <p
                  style={{
                    margin: `${space[2]}px auto ${space[4]}px`,
                    fontSize: typography.size.sm,
                    color: colors.textDim,
                    maxWidth: 520,
                    lineHeight: typography.leading.normal,
                  }}
                >
                  {t.workbenchSplitDescription}
                </p>
                <textarea
                  ref={bulkTextRef}
                  placeholder="# Chapter One&#10;It was a dark and stormy night...&#10;&#10;# Chapter Two&#10;..."
                  rows={10}
                  style={{
                    width: "100%",
                    maxWidth: 720,
                    background: colors.surfaceAlt,
                    border: `1px solid ${colors.borderSubtle}`,
                    borderRadius: radii.md,
                    color: colors.text,
                    fontFamily: fonts.sans,
                    fontSize: typography.size.base,
                    lineHeight: typography.leading.relaxed,
                    padding: space[4],
                    resize: "vertical",
                    outline: "none",
                    boxSizing: "border-box",
                    marginBottom: space[3],
                  }}
                />
                <div style={{ display: "flex", gap: space[2], justifyContent: "center" }}>
                  <Button variant="primary" onClick={() => void handleSplitPaste()}>
                    {t.workbenchSplitInto}
                  </Button>
                  <Button variant="ghost" onClick={() => void handleAddChapter()}>
                    {t.workbenchOrAddManual}
                  </Button>
                </div>
              </div>
            ) : (
              chapters.map((ch) => (
                <ChapterCard
                  key={ch.id}
                  t={t}
                  chapter={ch}
                  project={selected}
                  onUpdate={handleUpdateChapter}
                  onDelete={(id) => void handleDeleteChapter(id)}
                  onToast={onToast}
                />
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── HowItWorksStep (onboarding card) ───────────────────────────────

function HowItWorksStep({ n, title, description }: { n: number; title: string; description: string }) {
  return (
    <div
      style={{
        background: colors.surfaceSubtle,
        border: `1px solid ${colors.borderFaint}`,
        borderRadius: radii.md,
        padding: space[4],
        textAlign: "left",
      }}
    >
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: "50%",
          background: colors.primarySoft,
          color: colors.primaryLight,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: typography.size.xs,
          fontWeight: typography.weight.bold,
          marginBottom: space[2],
        }}
      >
        {n}
      </div>
      <h4
        style={{
          margin: 0,
          fontSize: typography.size.sm,
          fontWeight: typography.weight.semibold,
          color: colors.text,
        }}
      >
        {title}
      </h4>
      <p
        style={{
          margin: `${space[1]}px 0 0`,
          fontSize: typography.size.xs,
          color: colors.textDim,
          lineHeight: typography.leading.normal,
        }}
      >
        {description}
      </p>
    </div>
  );
}

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

function ProjectSidebar({ t, projects, selectedId, loading, onSelect, onNew, onDelete }: SidebarProps) {
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
  return (
    <div
      onClick={onSelect}
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
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          aria-label={`Delete project ${project.name}`}
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
