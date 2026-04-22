import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createChapter,
  createProject,
  deleteChapter,
  deleteProject,
  listChapters,
  listGenerations,
  listProjects,
  splitIntoChapters,
  updateChapter,
  updateProject,
  type Chapter,
  type Generation,
  type Project,
} from "@/api/projects";
import { API_BASE, isAbortError } from "@/api/client";
import { listIncompleteJobs } from "@/api/synthesis";
import {
  listStudioRenders,
  renderVideo,
  uploadCover,
  type StudioRender,
} from "@/api/studio";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { IconButton } from "@/components/IconButton";
import { Skeleton } from "@/components/Skeleton";
import * as Icons from "@/components/icons";
import { ALL_VOICES, VOICES } from "@/constants/voices";
import { useProfiles } from "@/hooks/useProfiles";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, space, transitions, typography } from "@/theme/tokens";
import type { Profile } from "@/types/domain";

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
  profiles: readonly Profile[];
  onUpdate: (id: string, data: Partial<Chapter>) => Promise<void>;
  onDelete: (id: string) => void;
  onToast: (msg: string) => void;
  onOpenStudioWithSource: (generationId: string) => void;
}

// Regex to detect [Character] markup at the start of a line. Case-
// insensitive and allows accented chars. Used to surface a "N personajes"
// badge so users discover the Cast feature.
const CHARACTER_TAG_RE = /(?:^|\n)\s*\[([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9\s'-]{0,39})\]/g;

function detectCharacters(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(CHARACTER_TAG_RE)) {
    const name = m[1]?.trim();
    if (name) seen.add(name);
  }
  return [...seen];
}

function ChapterCard({ t, chapter, project, profiles, onUpdate, onDelete, onToast, onOpenStudioWithSource }: ChapterCardProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [renders, setRenders] = useState<StudioRender[]>([]);
  const [isRendering, setIsRendering] = useState(false);
  const renderAbortRef = useRef<AbortController | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const [gens, rnds] = await Promise.all([
        listGenerations(chapter.id),
        listStudioRenders({ chapterId: chapter.id }),
      ]);
      setGenerations(gens);
      setRenders(rnds);
    } catch { /* non-critical */ }
  }, [chapter.id]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);
  useEffect(() => () => { renderAbortRef.current?.abort(); }, []);

  const latestDoneGen = generations.find((g) => g.status === "done" && g.file_path);
  // ``generations`` is sorted newest-first; if the newest hasn't
  // reached "done", it's either in-flight, cancelled or crashed.
  const latestGen = generations[0];
  const hasGenError = latestGen && latestGen.status === "error";
  const audioEditCount = renders.filter((r) => r.kind === "audio").length;
  const videoRenderCount = renders.filter((r) => r.kind === "video").length;
  // One panel at a time — cleaner than 4 independent booleans and makes
  // the toolbar feel like a mini-tab bar.
  const [activePanel, setActivePanel] = useState<PanelKey>(null);
  const [title, setTitle] = useState(chapter.title);
  const [text, setText] = useState(chapter.text);
  const characters = useMemo(() => detectCharacters(text), [text]);
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

  const handleRenderVideo = async (): Promise<void> => {
    if (!latestDoneGen?.file_path) return;
    if (!project.cover_path) {
      onToast(t.workbenchNeedCoverFirst);
      return;
    }
    const controller = new AbortController();
    renderAbortRef.current = controller;
    setIsRendering(true);
    try {
      await renderVideo(
        {
          audio_path: latestDoneGen.file_path,
          cover_path: project.cover_path,
          project_id: project.id,
          chapter_id: chapter.id,
          options: { title_text: chapter.title, subtitles_mode: "none" },
        },
        controller.signal,
      );
      onToast(t.workbenchVideoReady);
      await loadStatus();
    } catch (e) {
      if (isAbortError(e)) {
        onToast(t.renderCancelled);
      } else {
        onToast(`Error: ${e instanceof Error ? e.message : t.unknownError}`);
      }
    } finally {
      setIsRendering(false);
      if (renderAbortRef.current === controller) renderAbortRef.current = null;
    }
  };

  const handleCancelRender = (): void => {
    renderAbortRef.current?.abort();
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

      {/* Status row — chips + character hint + render-video action */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: space[2],
          marginTop: space[2],
          flexWrap: "wrap",
        }}
      >
        <StatusChip
          label={t.chapterStatusSynth}
          active={latestDoneGen !== undefined}
          color={colors.primary}
        />
        {hasGenError && (
          <StatusChip
            label={t.chapterStatusError}
            active
            color="#f87171"
            onClick={() => setActivePanel("chunks")}
          />
        )}
        <StatusChip
          label={t.chapterStatusEdits.replace("{n}", String(audioEditCount))}
          active={audioEditCount > 0}
          color="#a78bfa"
          {...(audioEditCount > 0 && latestDoneGen
            ? { onClick: (() => {
                const g = latestDoneGen;
                return () => onOpenStudioWithSource(g.id);
              })() }
            : {})}
        />
        <StatusChip
          label={t.chapterStatusVideos.replace("{n}", String(videoRenderCount))}
          active={videoRenderCount > 0}
          color="#f59e0b"
        />
        {characters.length > 0 && (
          <button
            type="button"
            onClick={() => togglePanel("cast")}
            title={t.chapterCharactersHint}
            style={{
              padding: "2px 8px",
              fontSize: 10,
              fontWeight: 700,
              fontFamily: fonts.mono,
              borderRadius: radii.sm,
              background: "rgba(34,197,94,0.15)",
              color: "#4ade80",
              border: "1px solid rgba(34,197,94,0.3)",
              cursor: "pointer",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            {t.chapterCharactersDetected.replace("{n}", String(characters.length))}
          </button>
        )}
        <div style={{ flex: 1 }} />
        {latestDoneGen && (
          isRendering ? (
            <Button variant="danger" size="sm" onClick={handleCancelRender}>
              {t.cancel}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              icon={<Icons.Mic />}
              onClick={() => void handleRenderVideo()}
              disabled={!project.cover_path}
              title={!project.cover_path ? t.workbenchNeedCoverFirst : undefined}
            >
              {t.workbenchRenderVideo}
            </Button>
          )
        )}
      </div>

      {/* Body */}
      {!collapsed && (
        <>
          <ChapterVoicePicker
            t={t}
            chapter={chapter}
            project={project}
            profiles={profiles}
            onChange={(voiceId, profileId) =>
              void onUpdate(chapter.id, { voice_id: voiceId, profile_id: profileId })
            }
          />

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
                voiceId={chapter.voice_id ?? project.voice_id}
                profileId={chapter.profile_id ?? project.profile_id}
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
                onOpenStudioWithSource={onOpenStudioWithSource}
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
// Small inline chip used in the status row. If ``onClick`` is provided
// and ``active``, renders as a clickable link (e.g. "2 edits" jumps to
// Studio); otherwise it's a passive indicator.
function StatusChip({
  label,
  active,
  color,
  onClick,
}: {
  label: string;
  active: boolean;
  color: string;
  onClick?: () => void;
}) {
  const baseStyle: React.CSSProperties = {
    padding: "2px 8px",
    fontSize: 10,
    fontWeight: 700,
    fontFamily: fonts.mono,
    borderRadius: radii.sm,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    background: active ? `${color}26` : "rgba(148,163,184,0.08)",
    color: active ? color : colors.textFaint,
    border: active ? `1px solid ${color}55` : `1px solid ${colors.borderFaint}`,
  };
  if (onClick && active) {
    return (
      <button type="button" onClick={onClick} style={{ ...baseStyle, cursor: "pointer" }}>
        {label}
      </button>
    );
  }
  return <span style={baseStyle}>{label}</span>;
}

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

interface WorkbenchTabProps {
  t: Translations;
  onToast: (msg: string) => void;
  onOpenStudioWithSource: (generationId: string) => void;
  onNavigateToQuickSynth: () => void;
}

export function WorkbenchTab({ t, onToast, onOpenStudioWithSource, onNavigateToQuickSynth }: WorkbenchTabProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [projectName, setProjectName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [incompleteCount, setIncompleteCount] = useState(0);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const bulkTextRef = useRef<HTMLTextAreaElement>(null);
  const { profiles } = useProfiles();

  // Surface interrupted synthesis jobs as a small banner so the user
  // can resume from the Workbench instead of remembering to go to Quick
  // Synth. The full resume UI lives in SynthTab — we just nudge.
  useEffect(() => {
    void listIncompleteJobs()
      .then((r) => setIncompleteCount(r.count))
      .catch(() => setIncompleteCount(0));
  }, []);

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
      // Default to the first ES voice; without it, QuickPreview /
      // Synthesize fire off an empty voice_id and Edge-TTS rejects it.
      const defaultVoice = VOICES.es[0]?.id ?? "";
      const p = await createProject({
        name: t.workbenchDefaultProjectName,
        voice_id: defaultVoice,
        language: "es",
      });
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

  const handleChangeVoice = useCallback(
    async (voiceId: string, profileId: string | null) => {
      if (!selected) return;
      try {
        // Derive language from the voice id prefix ("es-ES-..." → "es").
        const lang = voiceId.slice(0, 2) || selected.language;
        const updated = await updateProject(selected.id, {
          voice_id: voiceId,
          profile_id: profileId,
          language: lang,
        });
        setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      } catch {
        onToast("Failed to update voice");
      }
    },
    [selected, onToast],
  );

  const handleSetCover = useCallback(
    async (file: File) => {
      if (!selected) return;
      try {
        const { path } = await uploadCover(file);
        const updated = await updateProject(selected.id, { cover_path: path });
        setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        onToast(t.workbenchCoverSet);
      } catch (e) {
        onToast(`Error: ${e instanceof Error ? e.message : t.unknownError}`);
      }
    },
    [selected, onToast, t.workbenchCoverSet, t.unknownError],
  );

  const handleClearCover = useCallback(async () => {
    if (!selected) return;
    try {
      const updated = await updateProject(selected.id, { cover_path: null });
      setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } catch {
      onToast("Failed to clear cover");
    }
  }, [selected, onToast]);

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
        {incompleteCount > 0 && (
          <div
            role="status"
            style={{
              marginBottom: space[4],
              padding: "10px 14px",
              background: "rgba(245,158,11,0.08)",
              border: "1px solid rgba(245,158,11,0.3)",
              borderRadius: radii.md,
              display: "flex",
              alignItems: "center",
              gap: space[3],
              fontSize: typography.size.sm,
            }}
          >
            <span style={{ color: "#f59e0b", fontWeight: 700 }}>⚠</span>
            <span style={{ color: colors.textMuted, flex: 1 }}>
              {t.workbenchIncompleteJobs.replace("{n}", String(incompleteCount))}
            </span>
            <Button variant="ghost" size="sm" onClick={onNavigateToQuickSynth}>
              {t.workbenchResumeJobs}
            </Button>
          </div>
        )}
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

            {/* Project voice + cover */}
            <ProjectVoicePicker
              t={t}
              project={selected}
              profiles={profiles}
              onChange={(voiceId, profileId) => void handleChangeVoice(voiceId, profileId)}
            />
            <ProjectCoverPicker
              t={t}
              project={selected}
              onPickCover={(file) => void handleSetCover(file)}
              onClearCover={() => void handleClearCover()}
            />

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
                  profiles={profiles}
                  onUpdate={handleUpdateChapter}
                  onDelete={(id) => void handleDeleteChapter(id)}
                  onToast={onToast}
                  onOpenStudioWithSource={onOpenStudioWithSource}
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

// ── ChapterVoicePicker ──────────────────────────────────────────────

interface ChapterVoicePickerProps {
  t: Translations;
  chapter: Chapter;
  project: Project;
  profiles: readonly Profile[];
  onChange: (voiceId: string | null, profileId: string | null) => void;
}

// Small inline select that lets a chapter override its voice without
// duplicating the full project selector. Value encoding:
//   "inherit"          → fall back to project (both fields cleared)
//   "voice:<id>"       → system voice override
//   "profile:<id>"     → cloned profile override
function ChapterVoicePicker({ t, chapter, project, profiles, onChange }: ChapterVoicePickerProps) {
  const currentValue = chapter.profile_id
    ? `profile:${chapter.profile_id}`
    : chapter.voice_id
      ? `voice:${chapter.voice_id}`
      : "inherit";

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const raw = e.target.value;
    if (raw === "inherit") {
      onChange(null, null);
      return;
    }
    if (raw.startsWith("profile:")) {
      const id = raw.slice("profile:".length);
      const p = profiles.find((pp) => pp.id === id);
      if (!p) return;
      onChange(p.voiceId, p.id);
    } else if (raw.startsWith("voice:")) {
      onChange(raw.slice("voice:".length), null);
    }
  };

  const profilesWithSample = profiles.filter((p) => p.sampleName !== null);
  const isInheriting = currentValue === "inherit";

  // Label shown when inheriting — derive from the project's active voice
  // so the user sees "(heredado: Álvaro)" instead of a bare "heredar".
  const inheritedLabel =
    project.profile_id
      ? profiles.find((p) => p.id === project.profile_id)?.name ?? project.voice_id
      : ALL_VOICES.find((v) => v.id === project.voice_id)?.name ?? project.voice_id;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: space[2],
        marginTop: space[3],
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
        {t.chapterVoice}
      </label>
      <select
        value={currentValue}
        onChange={handleChange}
        style={{
          padding: "4px 8px",
          borderRadius: radii.sm,
          background: colors.surfaceAlt,
          border: `1px solid ${isInheriting ? colors.borderFaint : colors.primaryBorder}`,
          color: colors.text,
          fontSize: typography.size.xs,
          fontFamily: fonts.sans,
          outline: "none",
          cursor: "pointer",
          minWidth: 220,
        }}
      >
        <option value="inherit">
          {t.chapterVoiceInherit.replace("{name}", inheritedLabel)}
        </option>
        {profilesWithSample.length > 0 && (
          <optgroup label={t.castingClonedProfiles}>
            {profilesWithSample.map((p) => (
              <option key={p.id} value={`profile:${p.id}`}>
                {p.name}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label={`${t.castingSystemVoices} — ${t.voicesLangSpanish}`}>
          {VOICES.es.map((v) => (
            <option key={v.id} value={`voice:${v.id}`}>
              {v.name} · {v.accent}
            </option>
          ))}
        </optgroup>
        <optgroup label={`${t.castingSystemVoices} — ${t.voicesLangEnglish}`}>
          {VOICES.en.map((v) => (
            <option key={v.id} value={`voice:${v.id}`}>
              {v.name} · {v.accent}
            </option>
          ))}
        </optgroup>
      </select>
      {!isInheriting && (
        <button
          type="button"
          onClick={() => onChange(null, null)}
          title={t.chapterVoiceClear}
          style={{
            background: "none",
            border: "none",
            color: colors.textFaint,
            cursor: "pointer",
            fontSize: typography.size.xs,
            padding: "2px 6px",
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

// ── ProjectVoicePicker ──────────────────────────────────────────────

interface VoicePickerProps {
  t: Translations;
  project: Project;
  profiles: readonly Profile[];
  onChange: (voiceId: string, profileId: string | null) => void;
}

// Value encoding: system voices use "voice:<id>", profiles use "profile:<id>"
// so the same <select> can disambiguate with a single string value.
function ProjectVoicePicker({ t, project, profiles, onChange }: VoicePickerProps) {
  const currentValue = project.profile_id
    ? `profile:${project.profile_id}`
    : `voice:${project.voice_id}`;

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const raw = e.target.value;
    if (raw.startsWith("profile:")) {
      const id = raw.slice("profile:".length);
      const p = profiles.find((pp) => pp.id === id);
      if (!p) return;
      onChange(p.voiceId, p.id);
    } else if (raw.startsWith("voice:")) {
      onChange(raw.slice("voice:".length), null);
    }
  };

  const profilesWithSample = profiles.filter((p) => p.sampleName !== null);

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
        {t.voice}
      </label>
      <select
        value={currentValue}
        onChange={handleChange}
        style={{
          padding: "6px 10px",
          borderRadius: radii.sm,
          background: colors.surfaceAlt,
          border: `1px solid ${colors.border}`,
          color: colors.text,
          fontSize: typography.size.sm,
          fontFamily: fonts.sans,
          outline: "none",
          cursor: "pointer",
          minWidth: 240,
        }}
      >
        {profilesWithSample.length > 0 && (
          <optgroup label={t.castingClonedProfiles}>
            {profilesWithSample.map((p) => (
              <option key={p.id} value={`profile:${p.id}`}>
                {p.name}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label={`${t.castingSystemVoices} — ${t.voicesLangSpanish}`}>
          {VOICES.es.map((v) => (
            <option key={v.id} value={`voice:${v.id}`}>
              {v.name} · {v.accent}
            </option>
          ))}
        </optgroup>
        <optgroup label={`${t.castingSystemVoices} — ${t.voicesLangEnglish}`}>
          {VOICES.en.map((v) => (
            <option key={v.id} value={`voice:${v.id}`}>
              {v.name} · {v.accent}
            </option>
          ))}
        </optgroup>
        {/* If the project's current voice_id isn't in the known list
           (e.g. legacy empty string), show it as a fallback so the
           selector doesn't silently drop the value. */}
        {!ALL_VOICES.some((v) => v.id === project.voice_id) &&
          !project.profile_id && (
            <option value={`voice:${project.voice_id}`} disabled>
              {project.voice_id || "—"}
            </option>
          )}
      </select>
    </div>
  );
}

// ── ProjectCoverPicker ──────────────────────────────────────────────

interface CoverPickerProps {
  t: Translations;
  project: Project;
  onPickCover: (file: File) => void;
  onClearCover: () => void;
}

function ProjectCoverPicker({ t, project, onPickCover, onClearCover }: CoverPickerProps) {
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
