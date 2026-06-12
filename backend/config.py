"""Application configuration via environment variables."""
from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central VoxForge configuration.

    All options can be overridden via environment variables with the
    ``VOXFORGE_`` prefix. Example: ``VOXFORGE_CORS_ORIGINS='["http://localhost:3000"]'``.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="VOXFORGE_",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Paths
    base_dir: Path = Path(__file__).parent.parent
    data_subdir: str = "data"

    # CORS — local-first: only the local dev frontends may call the API
    # cross-origin. The app itself talks to the backend through Vite's
    # same-origin proxy, so this allowlist doesn't affect normal use; it
    # just stops arbitrary websites from scripting the local API. Override
    # via VOXFORGE_CORS_ORIGINS='["http://host:port", ...]' if needed.
    cors_origins: list[str] = [
        "http://localhost:3000", "http://127.0.0.1:3000",
        "http://localhost:3001", "http://127.0.0.1:3001",
        "http://localhost:5173", "http://127.0.0.1:5173",
    ]

    # Synthesis limits
    max_text_length: int = 500_000
    chunk_max_chars: int = 3_000  # Max chars per chunk for Edge-TTS

    # Voice quality — ASR-in-the-loop candidate re-ranking (VOZ-08).
    # faster-whisper model used to transcribe XTTS candidates (and Studio
    # subtitles). Override via VOXFORGE_WHISPER_MODEL (e.g. "medium").
    whisper_model: str = "small"
    # Minimum intelligibility (normalized fuzz ratio, 0-1, of transcribed
    # vs expected text) a clone candidate must reach. Below it the engine
    # escalates to extra candidates before accepting the best available.
    # Override via VOXFORGE_INTELLIGIBILITY_THRESHOLD.
    intelligibility_threshold: float = Field(default=0.90, ge=0.0, le=1.0)

    # XTTS v2 sampler (VOZ-09) — decoding parameters for voice cloning,
    # reopened now that the ASR re-ranker (VOZ-08) catches unintelligible
    # candidates. The FINAL numbers are fixed by the HUMANO A/B listening
    # gate, not by this file: iterate via env (VOXFORGE_XTTS_TEMPERATURE,
    # VOXFORGE_XTTS_TOP_P, ...) without touching code.
    # Old emergency values (the near-greedy sampler that compensated for
    # the diction-blind candidate scorer — flat prosody, distorted word
    # endings): temperature=0.1, top_p=0.4, top_k=20,
    # repetition_penalty=10.0. Use them as the "old" arm of the A/B.
    xtts_temperature: float = Field(default=0.70, gt=0.0, le=1.5)
    xtts_top_p: float = Field(default=0.85, gt=0.0, le=1.0)
    xtts_top_k: int = Field(default=50, ge=1)
    xtts_repetition_penalty: float = Field(default=6.0, ge=1.0)
    # Beam search (num_beams > 1) triggers tensor-shape errors inside
    # XTTS v2 — keep 1 unless that upstream bug is fixed.
    xtts_num_beams: int = Field(default=1, ge=1)
    # Seconds of reference audio used for GPT voice conditioning.
    xtts_gpt_cond_len: int = Field(default=30, ge=1, le=60)

    # Fine-tuned XTTS checkpoint (VOZ-11). Directory produced by the
    # Coqui/AllTalk fine-tuning pipeline, containing at least
    # config.json + model.pth + vocab.json — see
    # internal-docs/xtts-finetune.md. Default None = stock XTTS v2.
    # Override via VOXFORGE_XTTS_CHECKPOINT_DIR.
    xtts_checkpoint_dir: Path | None = None

    # Image generation (PROD-02). "comfyui" talks HTTP to the SAME
    # ComfyUI instance/workspace that img_generation_module provisions
    # (the backend never runs diffusion itself); "placeholder" renders a
    # deterministic text-on-gradient PNG and needs nothing external.
    image_provider: Literal["placeholder", "comfyui"] = "placeholder"
    comfyui_url: str = "http://127.0.0.1:8188"
    # Whole-job budget: submit + queue + diffusion + download.
    comfyui_timeout_s: float = Field(default=120.0, gt=0)
    # Workflow JSON (ComfyUI "Save (API Format)" export, parametrized by
    # reserved _meta.title nodes). Relative paths resolve against
    # ``base_dir``. The default is the img_generation_module's canonical
    # Z-Image-Turbo t2i export — a HUMAN step (PROD-05) produces it; the
    # provider fails with the instructions until then.
    comfyui_workflow_path: Path = Path("img_generation_module/workflows/zimage_t2i_fp8.api.json")

    # Maintenance
    cleanup_max_age_hours: int = 24

    # Service
    log_level: str = "INFO"


settings = Settings()
