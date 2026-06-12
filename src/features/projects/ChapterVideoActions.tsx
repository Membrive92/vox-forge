import { useEffect, useRef, useState } from "react";

import type { Chapter, Generation, Project } from "@/api/projects";
import { isAbortError } from "@/api/client";
import { renderVideo } from "@/api/studio";
import { Button } from "@/components/Button";
import * as Icons from "@/components/icons";
import { useJobMirror } from "@/hooks/jobsContext";
import type { Translations } from "@/i18n";

// ── ChapterVideoActions ─────────────────────────────────────────────
//
// The "Render video" action of a ChapterCard's status row, with its
// in-flight cancel state. Renders the chapter's active take over the
// project cover via the Studio backend.

interface ChapterVideoActionsProps {
  t: Translations;
  chapter: Chapter;
  project: Project;
  /** The take the video will be rendered from (active gen of the chapter). */
  source: Generation | undefined;
  onToast: (msg: string) => void;
  /** Re-fetch generations/renders after a successful render. */
  onReloadStatus: () => Promise<void>;
}

export function ChapterVideoActions({
  t,
  chapter,
  project,
  source,
  onToast,
  onReloadStatus,
}: ChapterVideoActionsProps) {
  const [isRendering, setIsRendering] = useState(false);
  const renderAbortRef = useRef<AbortController | null>(null);

  // UX-01: chapter video renders run for minutes — mirror them into the
  // global tray so leaving the Workbench doesn't hide the progress.
  useJobMirror({
    active: isRendering,
    kind: "video-render",
    originTab: "workbench",
    label: chapter.title,
  });

  useEffect(() => () => { renderAbortRef.current?.abort(); }, []);

  const handleRenderVideo = async (): Promise<void> => {
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
      await onReloadStatus();
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

  return isRendering ? (
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
  );
}
