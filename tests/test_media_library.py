"""Media library backend (T2I-1): media_store + generate-into-library +
list / delete / file-by-id endpoints.

Everything runs on the default ``PlaceholderProvider`` — no GPU, no
network. Backend modules are imported lazily inside helpers/tests so the
session fixture in ``conftest.py`` installs its stubs and rewrites
``VOXFORGE_BASE_DIR`` before any backend code resolves on-disk paths.
"""
from __future__ import annotations

import json
from pathlib import Path


# ── Service: media_store CRUD ───────────────────────────────────────


def test_media_store_round_trip(client) -> None:
    import asyncio

    from backend.services import media_store

    async def run() -> dict:
        created = await media_store.create_asset(
            kind="image",
            filename="a.png",
            thumb_filename="a.png",
            origin="generated",
            prompt="a quiet harbor",
            seed=42,
            aspect_ratio="16:9",
            width=1248,
            height=720,
        )
        fetched = await media_store.get_asset(created["id"])
        listed = await media_store.list_assets()
        deleted = await media_store.delete_asset(created["id"])
        gone = await media_store.get_asset(created["id"])
        return {
            "created": created,
            "fetched": fetched,
            "listed_ids": [a["id"] for a in listed],
            "deleted": deleted,
            "gone": gone,
        }

    loop = asyncio.new_event_loop()
    try:
        result = loop.run_until_complete(run())
    finally:
        loop.close()

    assert result["created"]["kind"] == "image"
    assert result["created"]["origin"] == "generated"
    assert result["created"]["seed"] == 42
    assert result["fetched"]["id"] == result["created"]["id"]
    assert result["created"]["id"] in result["listed_ids"]
    assert result["deleted"] is True
    assert result["gone"] is None


def test_media_store_list_filters_by_origin(client) -> None:
    import asyncio

    from backend.services import media_store

    async def run() -> dict:
        await media_store.create_asset(
            kind="image", filename="g.png", origin="generated", prompt="gen one",
        )
        await media_store.create_asset(
            kind="image", filename="u.png", origin="upload", prompt="uploaded one",
        )
        generated = await media_store.list_assets(origin="generated")
        uploaded = await media_store.list_assets(origin="upload")
        return {"generated": generated, "uploaded": uploaded}

    loop = asyncio.new_event_loop()
    try:
        result = loop.run_until_complete(run())
    finally:
        loop.close()

    assert all(a["origin"] == "generated" for a in result["generated"])
    assert all(a["origin"] == "upload" for a in result["uploaded"])


def test_media_store_list_filters_by_query(client) -> None:
    import asyncio

    from backend.services import media_store

    async def run() -> list[str]:
        await media_store.create_asset(
            kind="image", filename="l.png", origin="generated",
            prompt="a lighthouse on a cliff",
        )
        await media_store.create_asset(
            kind="image", filename="f.png", origin="generated",
            prompt="a forest in autumn",
        )
        hits = await media_store.list_assets(query="lighthouse")
        return [a["prompt"] for a in hits]

    loop = asyncio.new_event_loop()
    try:
        prompts = loop.run_until_complete(run())
    finally:
        loop.close()

    assert any("lighthouse" in (p or "") for p in prompts)
    assert all("forest" not in (p or "") for p in prompts)


# ── Router: POST /api/studio/media/generate ─────────────────────────


def test_generate_into_library_inserts_row_and_writes_files(client) -> None:
    from backend.paths import STUDIO_MEDIA_DIR, STUDIO_MEDIA_THUMBS_DIR

    response = client.post(
        "/api/studio/media/generate",
        json={"prompt": "A lighthouse on a cliff at dusk", "aspect_ratio": "16:9", "seed": 42},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["count"] == 1
    asset = body["assets"][0]
    assert asset["origin"] == "generated"
    assert asset["kind"] == "image"
    assert asset["seed"] == 42
    assert asset["aspect_ratio"] == "16:9"
    assert asset["prompt"] == "A lighthouse on a cliff at dusk"
    # 16:9 placeholder renders at 1920x1080.
    assert asset["width"] == 1920 and asset["height"] == 1080

    # PNG, thumbnail and sidecar all exist on disk.
    png = STUDIO_MEDIA_DIR / asset["filename"]
    assert png.is_file()
    thumb = STUDIO_MEDIA_THUMBS_DIR / asset["thumb_filename"]
    assert thumb.is_file()
    sidecar = STUDIO_MEDIA_DIR / (Path(asset["filename"]).stem + ".json")
    assert sidecar.is_file()

    # meta_json carries the SPEC_PIPELINE §3 sidecar shape.
    meta = json.loads(asset["meta_json"])
    assert meta["kind"] == "image"
    assert meta["params"]["prompt"] == "A lighthouse on a cliff at dusk"
    assert meta["params"]["seed"] == 42
    assert "timings" in meta and "models" in meta and "workflow" in meta

    # The row is discoverable through the list endpoint.
    listed = client.get("/api/studio/media").json()
    assert any(a["id"] == asset["id"] for a in listed["assets"])


def test_generate_thumbnail_is_capped_at_256px(client) -> None:
    from PIL import Image

    from backend.paths import STUDIO_MEDIA_THUMBS_DIR

    response = client.post(
        "/api/studio/media/generate",
        json={"prompt": "Thumbnail size check", "aspect_ratio": "16:9", "seed": 1},
    )
    asset = response.json()["assets"][0]
    thumb = STUDIO_MEDIA_THUMBS_DIR / asset["thumb_filename"]
    with Image.open(thumb) as img:
        assert max(img.width, img.height) <= 256


def test_generate_batch_count_creates_sequential_rows(client) -> None:
    response = client.post(
        "/api/studio/media/generate",
        json={"prompt": "Batch of three", "aspect_ratio": "1:1", "seed": 100, "count": 3},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["count"] == 3
    seeds = sorted(a["seed"] for a in body["assets"])
    # Seeds step off the base so a batch isn't N identical frames.
    assert seeds == [100, 101, 102]
    # Each asset got its own row + file.
    assert len({a["id"] for a in body["assets"]}) == 3
    assert len({a["filename"] for a in body["assets"]}) == 3


def test_generate_rejects_invalid_aspect(client) -> None:
    response = client.post(
        "/api/studio/media/generate",
        json={"prompt": "Valid prompt", "aspect_ratio": "21:9"},
    )
    assert response.status_code == 400
    assert response.json()["code"] == "invalid_parameter"


def test_generate_rejects_empty_prompt(client) -> None:
    response = client.post(
        "/api/studio/media/generate",
        json={"prompt": "", "aspect_ratio": "16:9"},
    )
    assert response.status_code == 422


def test_generate_rejects_count_out_of_range(client) -> None:
    response = client.post(
        "/api/studio/media/generate",
        json={"prompt": "Too many", "aspect_ratio": "16:9", "count": 9},
    )
    assert response.status_code == 422


# ── Router: GET /api/studio/media (filters) ─────────────────────────


def test_list_media_newest_first_and_filters(client) -> None:
    client.post(
        "/api/studio/media/generate",
        json={"prompt": "filter alpha unique", "aspect_ratio": "1:1", "seed": 5},
    )
    client.post(
        "/api/studio/media/generate",
        json={"prompt": "filter beta unique", "aspect_ratio": "1:1", "seed": 6},
    )

    # origin filter
    generated = client.get("/api/studio/media?origin=generated").json()
    assert generated["count"] >= 2
    assert all(a["origin"] == "generated" for a in generated["assets"])

    # query filter
    hits = client.get("/api/studio/media?q=alpha unique").json()
    assert hits["count"] >= 1
    assert all("alpha" in (a["prompt"] or "") for a in hits["assets"])
    assert all("beta" not in (a["prompt"] or "") for a in hits["assets"])


def test_list_media_rejects_bad_kind(client) -> None:
    response = client.get("/api/studio/media?kind=weird")
    assert response.status_code == 400
    assert response.json()["code"] == "invalid_parameter"


def test_list_media_rejects_bad_origin(client) -> None:
    response = client.get("/api/studio/media?origin=nonsense")
    assert response.status_code == 400
    assert response.json()["code"] == "invalid_parameter"


# ── Router: DELETE /api/studio/media/{id} ───────────────────────────


def test_delete_media_removes_row_and_files(client) -> None:
    from backend.paths import STUDIO_MEDIA_DIR, STUDIO_MEDIA_THUMBS_DIR

    asset = client.post(
        "/api/studio/media/generate",
        json={"prompt": "Delete me", "aspect_ratio": "16:9", "seed": 11},
    ).json()["assets"][0]

    png = STUDIO_MEDIA_DIR / asset["filename"]
    thumb = STUDIO_MEDIA_THUMBS_DIR / asset["thumb_filename"]
    sidecar = STUDIO_MEDIA_DIR / (Path(asset["filename"]).stem + ".json")
    assert png.is_file() and thumb.is_file() and sidecar.is_file()

    del_resp = client.delete(f"/api/studio/media/{asset['id']}")
    assert del_resp.status_code == 200
    assert del_resp.json()["status"] == "deleted"

    # Row gone
    listed = client.get("/api/studio/media").json()
    assert not any(a["id"] == asset["id"] for a in listed["assets"])
    # Files gone
    assert not png.exists()
    assert not thumb.exists()
    assert not sidecar.exists()


def test_delete_nonexistent_media_404(client) -> None:
    response = client.delete("/api/studio/media/does_not_exist")
    assert response.status_code == 404


# ── Router: GET /api/studio/media/file/{id} ─────────────────────────


def test_media_file_served_by_id(client) -> None:
    asset = client.post(
        "/api/studio/media/generate",
        json={"prompt": "Serve me by id", "aspect_ratio": "16:9", "seed": 22},
    ).json()["assets"][0]

    full = client.get(f"/api/studio/media/file/{asset['id']}")
    assert full.status_code == 200
    assert full.headers["content-type"].startswith("image/")
    assert len(full.content) > 0
    assert full.content.startswith(b"\x89PNG")

    thumb = client.get(f"/api/studio/media/file/{asset['id']}?thumb=true")
    assert thumb.status_code == 200
    assert thumb.headers["content-type"].startswith("image/")
    # Thumbnail is smaller than the full image.
    assert len(thumb.content) < len(full.content)


def test_media_file_bad_id_404(client) -> None:
    response = client.get("/api/studio/media/file/does_not_exist")
    assert response.status_code == 404
