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
import { useConfirm } from "@/components/ConfirmProvider";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/Skeleton";
import * as Icons from "@/components/icons";
import { ALL_VOICES, VOICES } from "@/constants/voices";
import { useSharedProfiles } from "@/hooks/profilesContext";
import { activateOnKey } from "@/utils/a11y";
import { downloadUrl } from "@/utils/download";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, space, transitions, typography } from "@/theme/tokens";
import type { Profile } from "@/types/domain";

import { ChapterCard } from "./ChapterCard";
import { relativeTime } from "./workbenchHelpers";


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
  const nameInputRef = useRef<HTMLInputElement>(null);
  const bulkTextRef = useRef<HTMLTextAreaElement>(null);
  const { profiles } = useSharedProfiles();

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
  useEffect(() => {
    onActiveProjectChange?.(selected?.name ?? null);
    return () => onActiveProjectChange?.(null);
  }, [selected, onActiveProjectChange]);

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
    const url = `${API_BASE}/export/${selectedId}`;
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

  const profilesWithSample = profiles.filter((p) => p.samples.length > 0);

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
