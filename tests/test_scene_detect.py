"""Tests for SRT scene detection (PROD-03 / production plan B2).

Pure functions only — the router endpoint is covered in
``test_studio.py`` alongside the other Studio endpoints.
"""
from __future__ import annotations


def _seg(start: float, end: float, text: str, index: int = 1):
    from backend.services.transcriber import SrtSegment

    return SrtSegment(index=index, start=start, end=end, text=text)


# ---------------------------------------------------------------------------
# parse_srt
# ---------------------------------------------------------------------------


class TestParseSrt:
    def test_empty_content_yields_no_segments(self) -> None:
        from backend.services.scene_detect import parse_srt

        assert parse_srt("") == []
        assert parse_srt("\n\n  \n") == []

    def test_parses_standard_blocks(self) -> None:
        from backend.services.scene_detect import parse_srt

        srt = (
            "1\n00:00:00,000 --> 00:00:02,500\nHello there.\n"
            "\n"
            "2\n00:00:02,500 --> 00:00:05,000\nSecond line.\n"
        )
        segs = parse_srt(srt)
        assert len(segs) == 2
        assert segs[0].start == 0.0
        assert segs[0].end == 2.5
        assert segs[0].text == "Hello there."
        assert segs[1].index == 2
        assert segs[1].text == "Second line."

    def test_multiline_text_joined_with_spaces(self) -> None:
        from backend.services.scene_detect import parse_srt

        srt = "1\n00:01:00,000 --> 00:01:04,000\nFirst visual line\nsecond visual line\n"
        segs = parse_srt(srt)
        assert len(segs) == 1
        assert segs[0].start == 60.0
        assert segs[0].text == "First visual line second visual line"

    def test_crlf_and_malformed_blocks_tolerated(self) -> None:
        """Hand-edited SRTs happen; a broken block is skipped, not fatal."""
        from backend.services.scene_detect import parse_srt

        srt = (
            "1\r\n00:00:00,000 --> 00:00:02,000\r\nLine one.\r\n"
            "\r\n"
            "garbage block without timestamps\r\n"
            "\r\n"
            "3\r\n00:00:04,000 --> 00:00:06,000\r\nLine three.\r\n"
        )
        segs = parse_srt(srt)
        assert [s.text for s in segs] == ["Line one.", "Line three."]
        # Indices are re-sequenced over the surviving blocks.
        assert [s.index for s in segs] == [1, 2]


# ---------------------------------------------------------------------------
# group_into_scenes — boundaries demanded by PROD-03
# ---------------------------------------------------------------------------


class TestGroupIntoScenes:
    def test_empty_srt_yields_no_scenes(self) -> None:
        from backend.services.scene_detect import group_into_scenes

        assert group_into_scenes([], target_scene_seconds=25.0) == []

    def test_single_entry_is_one_scene(self) -> None:
        from backend.services.scene_detect import group_into_scenes

        scenes = group_into_scenes([_seg(1.0, 4.0, "Only line.")], target_scene_seconds=25.0)
        assert len(scenes) == 1
        assert scenes[0].start_s == 1.0
        assert scenes[0].end_s == 4.0
        assert scenes[0].text_summary == "Only line."

    def test_groups_by_target_duration(self) -> None:
        """Ten 5s entries with target 25 -> two scenes of 25s each."""
        from backend.services.scene_detect import group_into_scenes

        entries = [_seg(i * 5.0, (i + 1) * 5.0, f"line {i}", index=i + 1) for i in range(10)]
        scenes = group_into_scenes(entries, target_scene_seconds=25.0)
        assert [(s.start_s, s.end_s) for s in scenes] == [(0.0, 25.0), (25.0, 50.0)]

    def test_exact_multiple_leaves_no_dangling_scene(self) -> None:
        """Span exactly == target closes the scene; no empty trailing scene."""
        from backend.services.scene_detect import group_into_scenes

        entries = [_seg(i * 5.0, (i + 1) * 5.0, f"line {i}", index=i + 1) for i in range(5)]
        scenes = group_into_scenes(entries, target_scene_seconds=25.0)
        assert len(scenes) == 1
        assert (scenes[0].start_s, scenes[0].end_s) == (0.0, 25.0)

    def test_long_entry_becomes_its_own_scene(self) -> None:
        """An entry longer than the target neither breaks nor inflates
        its neighbours: it closes the previous scene and stands alone."""
        from backend.services.scene_detect import group_into_scenes

        entries = [
            _seg(0.0, 5.0, "short before", index=1),
            _seg(5.0, 45.0, "one very long monologue", index=2),
            _seg(45.0, 50.0, "short after", index=3),
        ]
        scenes = group_into_scenes(entries, target_scene_seconds=25.0)
        assert [(s.start_s, s.end_s) for s in scenes] == [
            (0.0, 5.0),
            (5.0, 45.0),
            (45.0, 50.0),
        ]
        assert scenes[1].text_summary == "one very long monologue"

    def test_paragraph_pause_closes_scene_early(self) -> None:
        """A gap >= PARAGRAPH_PAUSE_S between entries is a scene break
        even though the target duration was not reached."""
        from backend.services.scene_detect import group_into_scenes

        entries = [
            _seg(0.0, 4.0, "before the pause", index=1),
            _seg(6.0, 10.0, "after the pause", index=2),  # 2s gap
        ]
        scenes = group_into_scenes(entries, target_scene_seconds=25.0)
        assert [(s.start_s, s.end_s) for s in scenes] == [(0.0, 4.0), (6.0, 10.0)]

    def test_small_gap_does_not_split(self) -> None:
        from backend.services.scene_detect import group_into_scenes

        entries = [
            _seg(0.0, 4.0, "first", index=1),
            _seg(4.5, 8.0, "second", index=2),  # 0.5s gap: same paragraph
        ]
        scenes = group_into_scenes(entries, target_scene_seconds=25.0)
        assert len(scenes) == 1
        assert scenes[0].text_summary == "first second"

    def test_summary_keeps_first_words_only(self) -> None:
        from backend.services.scene_detect import group_into_scenes

        long_text = " ".join(f"word{i}" for i in range(30))
        scenes = group_into_scenes([_seg(0.0, 10.0, long_text)], target_scene_seconds=25.0)
        summary = scenes[0].text_summary
        assert summary.startswith("word0 word1")
        assert summary.endswith("…")
        # 12 words + ellipsis, nowhere near the 30 input words.
        assert len(summary.rstrip("…").split()) == 12
