import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  listGenerations,
  type Chapter,
  type Generation,
  type Project,
} from "@/api/projects";
import {
  listStudioRenders,
  type StudioRender,
} from "@/api/studio";
import { Button } from "@/components/Button";
import { useConfirm } from "@/components/ConfirmProvider";
import { IconButton } from "@/components/IconButton";
import * as Icons from "@/components/icons";
import { logger } from "@/logging/logger";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, space, transitions, typography } from "@/theme/tokens";
import type { Profile } from "@/types/domain";

import { AmbienceMixer } from "./AmbienceMixer";
import { ChapterAudioPanel } from "./ChapterAudioPanel";
import { ChapterVideoActions } from "./ChapterVideoActions";
import { ChapterVoicePicker } from "./ChapterVoicePicker";
import { CharacterCasting } from "./CharacterCasting";
import { ChunkMap } from "./ChunkMap";
import { QuickPreview } from "./QuickPreview";

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
  // Collapsed by default (MED-PERF-F3): a project with dozens of
  // chapters must not pay N × (generations + renders + chunk map)
  // fetches and a full card subtree per chapter on open.
  const [collapsed, setCollapsed] = useState(true);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [renders, setRenders] = useState<StudioRender[]>([]);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [statusError, setStatusError] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const [gens, rnds] = await Promise.all([
        listGenerations(chapter.id),
        listStudioRenders({ chapterId: chapter.id }),
      ]);
      setGenerations(gens);
      setRenders(rnds);
      setStatusError(false);
    } catch (e) {
      // The chips, audio panel and take selector all hang off this
      // fetch — a failure here is real, not "no data yet" (BAJO-16).
      setStatusError(true);
      logger.error("ChapterCard: failed to load chapter status", {
        chapterId: chapter.id,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setStatusLoaded(true);
    }
  }, [chapter.id]);

  // Status (and the ChunkMap in the body) only load once the card is
  // expanded; re-expanding refreshes so the chips never go stale.
  useEffect(() => {
    if (!collapsed) void loadStatus();
  }, [collapsed, loadStatus]);

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
    // Panels live in the card body — opening one on a collapsed card
    // must expand it, or the toggle would appear to do nothing.
    setCollapsed(false);
    setActivePanel((prev) => (prev === key ? null : key));
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
        {/* Chips only render once the deferred status fetch resolved —
            a collapsed card that never loaded must not show "inactive"
            chips for audio that actually exists. A failed fetch shows a
            retry instead of lying with empty chips (BAJO-16). */}
        {statusLoaded && statusError && (
          <span
            role="alert"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: space[2],
              fontSize: typography.size.xs,
              color: colors.danger,
            }}
          >
            {t.chapterStatusLoadError}
            <Button variant="ghost" size="sm" onClick={() => void loadStatus()}>
              {t.retry}
            </Button>
          </span>
        )}
        {statusLoaded && !statusError && (
          <>
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
          </>
        )}
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
          <ChapterVideoActions
            t={t}
            chapter={chapter}
            project={project}
            source={activeGen}
            onToast={onToast}
            onReloadStatus={loadStatus}
          />
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

          <ChapterAudioPanel
            t={t}
            chapterId={chapter.id}
            activeGen={activeGen}
            generations={generations}
            onToast={onToast}
            onOpenStudioWithSource={onOpenStudioWithSource}
            onSetActiveGeneration={handleSetActiveGeneration}
            onReloadStatus={loadStatus}
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

// Consistent toolbar button — one style for all 3 tools, only active state differs.
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
