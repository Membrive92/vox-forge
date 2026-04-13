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
import { ChevDown, Download } from "@/components/icons";
import { colors, fonts, radii } from "@/theme/tokens";

import { AmbienceMixer } from "./AmbienceMixer";
import { CharacterCasting } from "./CharacterCasting";
import { ChunkMap } from "./ChunkMap";
import { QuickPreview } from "./QuickPreview";

function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function estimateDuration(text: string): string {
  const secs = text.length / 15;
  if (secs < 60) return `${Math.round(secs)}s`;
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

interface ChapterCardProps {
  chapter: Chapter;
  project: Project;
  onUpdate: (id: string, data: Partial<Chapter>) => Promise<void>;
  onDelete: (id: string) => void;
  onToast: (msg: string) => void;
}

function ChapterCard({ chapter, project, onUpdate, onDelete, onToast }: ChapterCardProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [showChunks, setShowChunks] = useState(false);
  const [showAmbient, setShowAmbient] = useState(false);
  const [showCasting, setShowCasting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
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

  return (
    <div style={{
      background: colors.surface, border: `1px solid ${colors.border}`,
      borderRadius: radii.lg, padding: 16, marginBottom: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          onClick={() => setCollapsed(c => !c)}
          aria-label={collapsed ? "Expand chapter" : "Collapse chapter"}
          style={{
            background: "none", border: "none", color: colors.textMuted, cursor: "pointer",
            transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 0.15s",
            padding: 2, display: "flex",
          }}
        ><ChevDown /></button>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={() => { if (title !== chapter.title) void onUpdate(chapter.id, { title }); }}
          style={{
            flex: 1, background: "transparent", border: "none", color: colors.text,
            fontFamily: fonts.sans, fontSize: 15, fontWeight: 600, outline: "none",
            padding: "2px 4px", borderRadius: radii.sm,
          }}
        />
        <button
          onClick={() => onDelete(chapter.id)}
          aria-label="Delete chapter"
          style={{
            background: "none", border: "none", color: colors.textFaint,
            cursor: "pointer", fontSize: 16, padding: "2px 6px",
          }}
        >x</button>
      </div>

      {!collapsed && (
        <>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            onBlur={saveText}
            rows={6}
            style={{
              width: "100%", marginTop: 8, background: colors.surfaceAlt,
              border: `1px solid ${colors.borderSubtle}`, borderRadius: radii.md,
              color: colors.text, fontFamily: fonts.sans, fontSize: 14,
              padding: 10, resize: "vertical", outline: "none", boxSizing: "border-box",
            }}
          />
          <div style={{
            display: "flex", gap: 16, marginTop: 6, alignItems: "center",
            fontSize: 12, color: colors.textDim, fontFamily: fonts.mono,
          }}>
            <span>{text.length} chars</span>
            <span>~{estimateDuration(text)}</span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              <button
                onClick={() => setShowChunks(v => !v)}
                style={{
                  padding: "4px 12px",
                  fontSize: 11,
                  fontWeight: 600,
                  background: showChunks ? colors.primarySoft : colors.surfaceAlt,
                  color: showChunks ? colors.primaryLight : colors.textDim,
                  border: `1px solid ${showChunks ? colors.primaryBorder : colors.border}`,
                  borderRadius: radii.sm,
                  cursor: "pointer",
                  fontFamily: fonts.sans,
                }}
              >
                {showChunks ? "Hide Chunks" : "Chunk Map"}
              </button>
              <button
                onClick={() => setShowPreview(v => !v)}
                style={{
                  padding: "4px 12px",
                  fontSize: 11,
                  fontWeight: 600,
                  background: showPreview ? "rgba(59,130,246,0.15)" : colors.surfaceAlt,
                  color: showPreview ? colors.primaryLight : colors.textDim,
                  border: `1px solid ${showPreview ? colors.primaryBorder : colors.border}`,
                  borderRadius: radii.sm,
                  cursor: "pointer",
                  fontFamily: fonts.sans,
                }}
              >
                {showPreview ? "Hide Preview" : "Preview"}
              </button>
              <button
                onClick={() => setShowCasting(v => !v)}
                style={{
                  padding: "4px 12px",
                  fontSize: 11,
                  fontWeight: 600,
                  background: showCasting ? "rgba(139,92,246,0.15)" : colors.surfaceAlt,
                  color: showCasting ? "#a78bfa" : colors.textDim,
                  border: `1px solid ${showCasting ? "rgba(139,92,246,0.3)" : colors.border}`,
                  borderRadius: radii.sm,
                  cursor: "pointer",
                  fontFamily: fonts.sans,
                }}
              >
                {showCasting ? "Hide Cast" : "Cast"}
              </button>
              <button
                onClick={() => setShowAmbient(v => !v)}
                style={{
                  padding: "4px 12px",
                  fontSize: 11,
                  fontWeight: 600,
                  background: showAmbient ? "rgba(16,185,129,0.15)" : colors.surfaceAlt,
                  color: showAmbient ? "#34d399" : colors.textDim,
                  border: `1px solid ${showAmbient ? "rgba(16,185,129,0.3)" : colors.border}`,
                  borderRadius: radii.sm,
                  cursor: "pointer",
                  fontFamily: fonts.sans,
                }}
              >
                {showAmbient ? "Hide Ambient" : "Ambient"}
              </button>
            </div>
          </div>
          {showPreview && (
            <div style={{ marginTop: 12 }}>
              <QuickPreview
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
          {showCasting && (
            <div style={{ marginTop: 12 }}>
              <CharacterCasting
                chapterText={text}
                chapterTitle={chapter.title}
                onToast={onToast}
              />
            </div>
          )}
          {showChunks && (
            <div style={{ marginTop: 12 }}>
              <ChunkMap
                chapterId={chapter.id}
                chapterTitle={chapter.title}
                onToast={onToast}
              />
            </div>
          )}
          {showAmbient && (
            <div style={{ marginTop: 12 }}>
              <AmbienceMixer
                chapterId={chapter.id}
                onToast={onToast}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function WorkbenchTab({ onToast }: { onToast: (msg: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [projectName, setProjectName] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  const selected = projects.find(p => p.id === selectedId) ?? null;

  const loadProjects = useCallback(async () => {
    try {
      const list = await listProjects();
      setProjects(list.sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
    } catch { onToast("Failed to load projects"); }
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
      const p = await createProject({ name: "Untitled Project" });
      setProjects(prev => [p, ...prev]);
      setSelectedId(p.id);
      setTimeout(() => nameInputRef.current?.select(), 50);
    } catch { onToast("Failed to create project"); }
  }, [onToast]);

  const handleDeleteProject = useCallback(async (id: string) => {
    try {
      await deleteProject(id);
      setProjects(prev => prev.filter(p => p.id !== id));
      if (selectedId === id) setSelectedId(null);
    } catch { onToast("Failed to delete project"); }
  }, [onToast, selectedId]);

  const handleRenameProject = useCallback(async () => {
    if (!selected || projectName === selected.name) return;
    try {
      const updated = await updateProject(selected.id, { name: projectName });
      setProjects(prev => prev.map(p => p.id === updated.id ? updated : p));
    } catch { onToast("Failed to rename project"); }
  }, [selected, projectName, onToast]);

  const handleAddChapter = useCallback(async () => {
    if (!selectedId) return;
    try {
      const ch = await createChapter(selectedId, {
        title: `Chapter ${chapters.length + 1}`,
        sort_order: chapters.length,
      });
      setChapters(prev => [...prev, ch]);
    } catch { onToast("Failed to add chapter"); }
  }, [selectedId, chapters.length, onToast]);

  const handleSplitText = useCallback(async () => {
    if (!selectedId) return;
    const text = prompt("Paste the full text to split into chapters:");
    if (!text) return;
    try {
      const chs = await splitIntoChapters(selectedId, text);
      setChapters(chs.sort((a, b) => a.sort_order - b.sort_order));
      onToast(`Split into ${chs.length} chapters`);
    } catch { onToast("Failed to split text"); }
  }, [selectedId, onToast]);

  const handleUpdateChapter = useCallback(async (id: string, data: Partial<Chapter>) => {
    try {
      const updated = await updateChapter(id, data);
      setChapters(prev => prev.map(c => c.id === updated.id ? updated : c));
    } catch { onToast("Failed to update chapter"); }
  }, [onToast]);

  const handleDeleteChapter = useCallback(async (id: string) => {
    try {
      await deleteChapter(id);
      setChapters(prev => prev.filter(c => c.id !== id));
    } catch { onToast("Failed to delete chapter"); }
  }, [onToast]);

  const btnStyle: React.CSSProperties = {
    background: colors.primarySoft, color: colors.primaryLight,
    border: `1px solid ${colors.primaryBorder}`, borderRadius: radii.md,
    padding: "8px 14px", cursor: "pointer", fontFamily: fonts.sans,
    fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 6,
  };

  return (
    <div style={{ display: "flex", height: "100%", fontFamily: fonts.sans }}>
      {/* Sidebar */}
      <div style={{
        width: 250, minWidth: 250, borderRight: `1px solid ${colors.border}`,
        display: "flex", flexDirection: "column", background: colors.surfaceSubtle,
      }}>
        <div style={{ padding: 12 }}>
          <button
            onClick={() => void handleNewProject()}
            style={{
              ...btnStyle, width: "100%", justifyContent: "center",
              background: colors.primary, color: "#fff", border: "none",
            }}
          >+ New Project</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 8px" }}>
          {projects.map(p => (
            <div
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              style={{
                padding: "10px 12px", borderRadius: radii.md, cursor: "pointer",
                marginBottom: 4, display: "flex", alignItems: "center",
                background: p.id === selectedId ? colors.primarySoft : "transparent",
                border: p.id === selectedId
                  ? `1px solid ${colors.primaryBorder}`
                  : "1px solid transparent",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  color: p.id === selectedId ? colors.primaryLight : colors.text,
                  fontSize: 14, fontWeight: 500, overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{p.name}</div>
                <div style={{ color: colors.textDim, fontSize: 11, marginTop: 2 }}>
                  {shortDate(p.updated_at)}
                </div>
              </div>
              <button
                onClick={e => { e.stopPropagation(); void handleDeleteProject(p.id); }}
                aria-label={`Delete project ${p.name}`}
                style={{
                  background: "none", border: "none", color: colors.textFaint,
                  cursor: "pointer", fontSize: 14, padding: "2px 6px",
                  borderRadius: radii.sm, flexShrink: 0,
                }}
              >x</button>
            </div>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
        {!selected ? (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            height: "100%", color: colors.textDim, fontSize: 15,
          }}>
            Select a project or create a new one to get started.
          </div>
        ) : (
          <>
            <input
              ref={nameInputRef}
              value={projectName}
              onChange={e => setProjectName(e.target.value)}
              onBlur={() => void handleRenameProject()}
              style={{
                background: "transparent", border: "none", color: colors.text,
                fontFamily: fonts.serif, fontSize: 24, fontWeight: 700,
                outline: "none", width: "100%", padding: "0 0 12px",
                borderBottom: `1px solid ${colors.borderSubtle}`,
              }}
            />

            <div style={{ display: "flex", gap: 10, margin: "16px 0 20px" }}>
              <button onClick={() => void handleAddChapter()} style={btnStyle}>
                + Chapter
              </button>
              <button onClick={() => void handleSplitText()} style={btnStyle}>
                Split Text
              </button>
              <button
                onClick={() => {
                  if (!selectedId) return;
                  const url = `${API_BASE}/export/${selectedId}`;
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${projectName || "project"}_export.zip`;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  onToast("Export started — the file will download when all chapters are synthesized");
                }}
                style={btnStyle}
              >
                <Download /> Export All
              </button>
            </div>

            {chapters.length === 0 && (
              <div style={{ color: colors.textDim, fontSize: 14, padding: "20px 0" }}>
                No chapters yet. Add one or split a full text.
              </div>
            )}

            {chapters.map(ch => (
              <ChapterCard
                key={ch.id}
                chapter={ch}
                project={selected}
                onUpdate={handleUpdateChapter}
                onDelete={(id) => void handleDeleteChapter(id)}
                onToast={onToast}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
