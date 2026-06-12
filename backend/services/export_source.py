"""Single source of truth for which audio wins a chapter's export (UX-02).

Priority — previously embedded (and silent) in the batch export:
  1. Latest Studio edit (``studio_renders`` kind="audio") — includes
     one-click masters.
  2. The chapter's explicitly active generation (``active_generation_id``).
  3. Most recent ``done`` generation.
  4. Nothing usable on disk -> fresh synthesis at export time.

Both the batch export and ``GET /api/chapters/{id}/export-source``
consume this helper so the label the UI shows and the file the ZIP
actually bundles can never diverge.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from . import project_manager as pm
from . import studio_store
from .mastering import is_mastering_ops

ExportSourceKind = Literal[
    "studio_edit", "active_take", "latest_generation", "fresh_synthesis"
]


@dataclass(frozen=True)
class ExportSource:
    """The audio that will win the export for one chapter.

    ``path`` is None only for ``fresh_synthesis`` (nothing on disk yet).
    """

    kind: ExportSourceKind
    path: Path | None
    render_id: str | None = None
    generation_id: str | None = None
    created_at: str | None = None
    mastered: bool = False


async def resolve_export_source(chapter: dict[str, Any]) -> ExportSource:
    """Resolve the export priority for ``chapter`` against current disk state.

    Rows whose file vanished from disk fall through to the next tier, so
    discarding a Studio edit immediately restores the take's priority.
    """
    chapter_id = chapter["id"]

    # (1) Latest Studio edit for this chapter
    edits = await studio_store.list_renders(kind="audio", chapter_id=chapter_id, limit=1)
    if edits:
        out = Path(edits[0]["output_path"])
        if out.exists():
            return ExportSource(
                kind="studio_edit",
                path=out,
                render_id=edits[0]["id"],
                created_at=edits[0]["created_at"],
                mastered=is_mastering_ops(edits[0].get("operations")),
            )

    # (2) Chapter's explicitly marked active generation
    active_id = chapter.get("active_generation_id")
    if active_id:
        active = await pm.get_generation(active_id)
        if (
            active
            and active.get("chapter_id") == chapter_id
            and active.get("status") == "done"
            and active.get("file_path")
        ):
            out = Path(active["file_path"])
            if out.exists():
                return ExportSource(
                    kind="active_take",
                    path=out,
                    generation_id=active_id,
                    created_at=active.get("created_at"),
                )

    # (3) Most recent ``done`` generation
    gen = await pm.get_latest_done_generation(chapter_id)
    if gen and gen.get("file_path"):
        out = Path(gen["file_path"])
        if out.exists():
            return ExportSource(
                kind="latest_generation",
                path=out,
                generation_id=gen["id"],
                created_at=gen.get("created_at"),
            )

    # (4) Nothing on disk — export will synthesize fresh
    return ExportSource(kind="fresh_synthesis", path=None)
