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
import { listIncompleteJobs } from "@/api/synthesis";
import { uploadCover } from "@/api/studio";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import * as Icons from "@/components/icons";
import { logger } from "@/logging/logger";
import { VOICES } from "@/constants/voices";
import { useSharedProfiles } from "@/hooks/profilesContext";
import { downloadUrl } from "@/utils/download";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, space, typography } from "@/theme/tokens";

import { ChapterCard } from "./ChapterCard";
import { ProjectCoverPicker } from "./ProjectCoverPicker";
import { ProjectSidebar } from "./ProjectSidebar";
import { ProjectVoicePicker } from "./ProjectVoicePicker";


// ── WorkbenchTab ────────────────────────────────────────────────────

interface WorkbenchTabProps {
  t: Translations;
  onToast: (msg: string) => void;
  onOpenStudioWithSource: (generationId: string) => void;
  onNavigateToQuickSynth: () => void;
  /** Notifies the parent (App) which project is currently open so it
   * can render context in the global header. Called with `null` when
   * no project is selected. */
  onActiveProjectChange?: (name: string | null) => void;
}

export function WorkbenchTab({ t, onToast, onOpenStudioWithSource, onNavigateToQuickSynth, onActiveProjectChange }: WorkbenchTabProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [projectName, setProjectName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [incompleteCount, setIncompleteCount] = useState(0);
  // UX-02: run the mastering preset over every chapter while exporting.
  const [masterOnExport, setMasterOnExport] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const bulkTextRef = useRef<HTMLTextAreaElement>(null);
  const { profiles } = useSharedProfiles();

  // Surface interrupted synthesis jobs as a small banner so the user
  // can resume from the Workbench instead of remembering to go to Quick
  // Synth. The full resume UI lives in SynthTab — we just nudge. A
  // failed probe only suppresses the nudge, but it gets logged (BAJO-16).
  useEffect(() => {
    void listIncompleteJobs()
      .then((r) => setIncompleteCount(r.count))
      .catch((e: unknown) => {
        setIncompleteCount(0);
        logger.warn("Workbench: failed to probe incomplete jobs", {
          error: e instanceof Error ? e.message : String(e),
        });
      });
  }, []);

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  const loadProjects = useCallback(async () => {
    setProjectsLoading(true);
    try {
      const list = await listProjects();
      setProjects(list.sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
    } catch { onToast(t.errLoadProjects); } finally {
      setProjectsLoading(false);
    }
  }, [onToast]);

  const loadChapters = useCallback(async (pid: string) => {
    try {
      const list = await listChapters(pid);
      setChapters(list.sort((a, b) => a.sort_order - b.sort_order));
    } catch { onToast(t.errLoadChapters); }
  }, [onToast]);

  useEffect(() => { void loadProjects(); }, [loadProjects]);

  useEffect(() => {
    if (selectedId) void loadChapters(selectedId);
    else setChapters([]);
  }, [selectedId, loadChapters]);

  useEffect(() => {
    if (selected) setProjectName(selected.name);
  }, [selected]);

  // Push the active project name up to App so the global header can
  // show it. Cleanup when this tab unmounts (rare — visited tabs stay
  // mounted) or when the user deselects.
  // Keyed por nombre, no por el objeto: cada refresh de la lista crea un
  // objeto nuevo para el mismo proyecto y el header parpadeaba null→nombre
  // en cada recarga (BAJO-8).
  const activeProjectName = selected?.name ?? null;
  useEffect(() => {
    onActiveProjectChange?.(activeProjectName);
    return () => onActiveProjectChange?.(null);
  }, [activeProjectName, onActiveProjectChange]);

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
    } catch { onToast(t.errCreateProject); }
  }, [onToast, t.workbenchDefaultProjectName]);

  const handleDeleteProject = useCallback(async (id: string) => {
    try {
      await deleteProject(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
      if (selectedId === id) setSelectedId(null);
    } catch { onToast(t.errDeleteProject); }
  }, [onToast, selectedId]);

  const handleRenameProject = useCallback(async () => {
    setRenaming(false);
    if (!selected || projectName === selected.name) return;
    try {
      const updated = await updateProject(selected.id, { name: projectName });
      setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } catch { onToast(t.errRenameProject); }
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
        onToast(t.errUpdateVoice);
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
      onToast(t.errClearCover);
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
    } catch { onToast(t.errAddChapter); }
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
    } catch { onToast(t.errSplitText); }
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
    } catch { onToast(t.errSplitText); }
  }, [selectedId, onToast, t.workbenchPastePrompt, t.workbenchSplitDone]);

  const handleUpdateChapter = useCallback(async (id: string, data: Partial<Chapter>) => {
    try {
      const updated = await updateChapter(id, data);
      setChapters((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    } catch { onToast(t.errUpdateChapter); }
  }, [onToast]);

  const handleDeleteChapter = useCallback(async (id: string) => {
    try {
      await deleteChapter(id);
      setChapters((prev) => prev.filter((c) => c.id !== id));
    } catch { onToast(t.errDeleteChapter); }
  }, [onToast]);

  const handleExportAll = (): void => {
    if (!selectedId) return;
    // Anchor download (GET) so the browser streams the ZIP to disk.
    const url = `${API_BASE}/export/${selectedId}${masterOnExport ? "?master=true" : ""}`;
    downloadUrl(url, `${projectName || "project"}_export.zip`);
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
                <>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: space[1],
                      fontSize: typography.size.xs,
                      color: colors.textDim,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={masterOnExport}
                      onChange={(e) => setMasterOnExport(e.target.checked)}
                    />
                    {t.workbenchMasterOnExport}
                  </label>
                  <Button variant="secondary" icon={<Icons.Download />} onClick={handleExportAll}>
                    {t.workbenchExportAll}
                  </Button>
                </>
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
