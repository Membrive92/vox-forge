import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  listGenerations,
  type Chapter,
  type Generation,
  type Project,
} from "@/api/projects";
import { uploadChapterAudio } from "@/api/chapterSynth";
import { isAbortError } from "@/api/client";
import {
  listStudioRenders,
  renderVideo,
  type StudioRender,
} from "@/api/studio";
import { Button } from "@/components/Button";
import { useConfirm } from "@/components/ConfirmProvider";
import { IconButton } from "@/components/IconButton";
import * as Icons from "@/components/icons";
import { ALL_VOICES, VOICES } from "@/constants/voices";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, space, transitions, typography } from "@/theme/tokens";
import type { Profile } from "@/types/domain";

import { AmbienceMixer } from "./AmbienceMixer";
import { ChapterRecorder } from "./ChapterRecorder";
import { CharacterCasting } from "./CharacterCasting";
import { ChunkMap } from "./ChunkMap";
import { QuickPreview } from "./QuickPreview";
import { relativeTime } from "./workbenchHelpers";
import { getGenerationAudioUrl } from "@/api/studio";

// ── ChapterCard + its private subcomponents ──────────────────────

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

export function ChapterCard({ t, chapter, project, profiles, onUpdate, onDelete, onToast, onOpenStudioWithSource }: ChapterCardProps) {
  const confirm = useConfirm();
  const [collapsed, setCollapsed] = useState(false);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [renders, setRenders] = useState<StudioRender[]>([]);
  const [isRendering, setIsRendering] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [recorderOpen, setRecorderOpen] = useState(false);
  const [isSavingRecording, setIsSavingRecording] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
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
    // Use the chapter's active take, falling back to newest done.
    const source = chapter.active_generation_id
      ? generations.find((g) => g.id === chapter.active_generation_id) ?? latestDoneGen
      : latestDoneGen;
    if (!source?.file_path) return;
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
          audio_path: source.file_path,
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

  const handleUploadAudio = async (file: File): Promise<void> => {
    setIsUploading(true);
    try {
      await uploadChapterAudio(chapter.id, file);
      onToast(t.chapterUploadSuccess);
      await loadStatus();
    } catch (e) {
      onToast(`Error: ${e instanceof Error ? e.message : t.unknownError}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleSaveRecording = async (file: File): Promise<void> => {
    setIsSavingRecording(true);
    try {
      await uploadChapterAudio(chapter.id, file);
      onToast(t.chapterUploadSuccess);
      setRecorderOpen(false);
      await loadStatus();
    } catch (e) {
      onToast(`Error: ${e instanceof Error ? e.message : t.unknownError}`);
    } finally {
      setIsSavingRecording(false);
    }
  };

  const handleSetActiveGeneration = async (genId: string | null): Promise<void> => {
    try {
      await onUpdate(chapter.id, { active_generation_id: genId });
      await loadStatus();
    } catch (e) {
      onToast(`Error: ${e instanceof Error ? e.message : t.unknownError}`);
    }
  };

  // Current "active" generation according to chapter metadata, falling
  // back to the newest ``done`` one. This is what the chapter's status
  // row + render-video button operate on.
  const activeGen = chapter.active_generation_id
    ? generations.find((g) => g.id === chapter.active_generation_id) ?? latestDoneGen
    : latestDoneGen;

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

        {/* Toolbar — Chunks (synth + audio) is now always visible below.
            Preview / Cast / Ambient remain opt-in toggles. */}
        <div style={{ display: "flex", gap: space[1], flexShrink: 0 }}>
          <ToolToggle
            label={t.chapterPreview}
            active={activePanel === "preview"}
            onClick={() => togglePanel("preview")}
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
          aria-label={`${t.actionDelete} ${chapter.title}`}
          variant="ghost"
          size="sm"
          onClick={async () => {
            if (
              await confirm({
                title: t.confirmDeleteTitle,
                message: t.confirmDeleteChapter.replace("{name}", chapter.title),
                confirmText: t.actionDelete,
                cancelText: t.cancel,
                confirmVariant: "danger",
              })
            ) {
              onDelete(chapter.id);
            }
          }}
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
              boxSizing: "border-box",
            }}
          />

          {/* Audio playback panel for uploaded/recorded/synthesized audio */}
          {activeGen?.status === "done" && activeGen?.file_path && (
            <div
              style={{
                marginTop: space[3],
                padding: space[3],
                background: colors.surfaceAlt,
                border: `1px solid ${colors.borderSubtle}`,
                borderRadius: radii.md,
                display: "flex",
                flexDirection: "column",
                gap: space[2],
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: space[2] }}>
                <div style={{ flex: 1 }}>
                  <audio
                    controls
                    src={getGenerationAudioUrl(activeGen.file_path)}
                    style={{
                      width: "100%",
                      maxWidth: "100%",
                    }}
                  />
                </div>
                <div style={{ display: "flex", gap: space[2], flexWrap: "wrap", fontSize: typography.size.xs }}>
                  {activeGen.duration && (
                    <span
                      style={{
                        padding: "2px 8px",
                        background: colors.primarySoft,
                        color: colors.primaryLight,
                        borderRadius: radii.sm,
                        fontFamily: fonts.mono,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {activeGen.duration.toFixed(1)}s
                    </span>
                  )}
                  <span
                    style={{
                      padding: "2px 8px",
                      background: colors.surface,
                      color: colors.textMuted,
                      border: `1px solid ${colors.borderSubtle}`,
                      borderRadius: radii.sm,
                      fontFamily: fonts.mono,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {activeGen.engine === "upload"
                      ? t.chapterTakeEngineUpload
                      : activeGen.engine === "recording" || activeGen.engine === "record"
                        ? t.chapterTakeEngineRecord
                        : t.chapterTakeEngineTts}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Icons.Edit />}
                    onClick={() => onOpenStudioWithSource(activeGen.id)}
                  >
                    {t.chapterEditInStudio}
                  </Button>
                </div>
              </div>
              {(activeGen.engine === "recording" || activeGen.engine === "record") && (
                <p style={{ margin: 0, fontSize: typography.size.xs, color: colors.textDim }}>
                  {t.chapterRecordedTakeNote}
                </p>
              )}
              {activeGen.engine === "upload" && (
                <p style={{ margin: 0, fontSize: typography.size.xs, color: colors.textDim }}>
                  {t.chapterUploadTakeNote}
                </p>
              )}
            </div>
          )}

          {/* Audio source row: upload / record / pick active take */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: space[2],
              marginTop: space[2],
              flexWrap: "wrap",
            }}
          >
            <input
              ref={uploadInputRef}
              type="file"
              accept=".wav,.mp3,.ogg,.flac,.webm,.m4a"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUploadAudio(f);
                e.target.value = "";
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              loading={isUploading}
              onClick={() => uploadInputRef.current?.click()}
              icon={<Icons.Upload />}
            >
              {t.chapterUploadAudio}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<Icons.Mic />}
              onClick={() => setRecorderOpen(true)}
            >
              {t.chapterRecord}
            </Button>
            <div style={{ flex: 1 }} />
            {generations.length > 1 && (
              <TakeSelector
                t={t}
                generations={generations}
                activeId={activeGen?.id ?? null}
                onChange={handleSetActiveGeneration}
              />
            )}
          </div>

          {recorderOpen && (
            <div style={{ marginTop: space[3] }}>
              <ChapterRecorder
                t={t}
                isSaving={isSavingRecording}
                onSave={handleSaveRecording}
                onCancel={() => setRecorderOpen(false)}
              />
            </div>
          )}

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
          {/* ChunkMap (synthesize + per-chunk regen + chapter audio
              player + download) is the primary action surface for a
              chapter and is now always visible — no longer behind a
              "Mapa de chunks" sub-tab toggle. */}
          <div style={{ marginTop: space[3] }}>
            <ChunkMap
              t={t}
              chapterId={chapter.id}
              chapterTitle={chapter.title}
              onToast={onToast}
              onOpenStudioWithSource={onOpenStudioWithSource}
            />
          </div>
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



// ── TakeSelector ───────────────────────────────────────────────────

interface TakeSelectorProps {
  t: Translations;
  generations: readonly Generation[];
  activeId: string | null;
  onChange: (genId: string | null) => Promise<void> | void;
}

function TakeSelector({ t, generations, activeId, onChange }: TakeSelectorProps) {
  const engineLabel = (engine: string): string => {
    if (engine === "upload") return t.chapterTakeEngineUpload;
    if (engine === "recording" || engine === "record") return t.chapterTakeEngineRecord;
    return t.chapterTakeEngineTts;
  };

  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: space[1],
        fontSize: typography.size.xs,
        color: colors.textDim,
      }}
    >
      {t.chapterTakes}
      <select
        value={activeId ?? ""}
        onChange={(e) => void onChange(e.target.value || null)}
        style={{
          padding: "4px 8px",
          borderRadius: radii.sm,
          background: colors.surfaceAlt,
          border: `1px solid ${colors.border}`,
          color: colors.text,
          fontSize: typography.size.xs,
          fontFamily: fonts.sans,
          cursor: "pointer",
        }}
      >
        {generations.map((g) => {
          const dur = g.duration ? `${g.duration.toFixed(1)}s` : "—";
          const label = t.chapterTakeLabel
            .replace("{engine}", engineLabel(g.engine))
            .replace("{when}", relativeTime(g.created_at, t))
            .replace("{dur}", dur);
          return (
            <option key={g.id} value={g.id}>
              {label}{g.status !== "done" ? ` · ${g.status}` : ""}
            </option>
          );
        })}
      </select>
    </label>
  );
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

  const profilesWithSample = profiles.filter((p) => p.samples.length > 0);
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

