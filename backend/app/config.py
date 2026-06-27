"""Configuration models and global settings for the dual-subtitle pipeline."""
from __future__ import annotations

from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


# Map ISO-639-1 codes to the full language names Qwen3-ASR expects.
# This is intentionally broad; only the source language is passed to the ASR model.
LANGUAGE_NAMES: dict[str, str] = {
    "sv": "Swedish",
    "en": "English",
    "de": "German",
    "fr": "French",
    "es": "Spanish",
    "it": "Italian",
    "nl": "Dutch",
    "da": "Danish",
    "no": "Norwegian",
    "fi": "Finnish",
    "pt": "Portuguese",
    "pl": "Polish",
    "ru": "Russian",
    "tr": "Turkish",
    "ar": "Arabic",
    "zh": "Chinese",
    "ja": "Japanese",
    "ko": "Korean",
}


def language_name(code: str) -> Optional[str]:
    """Return the full language name for an ISO code, or None for auto-detect."""
    if not code or code.lower() in ("auto", ""):
        return None
    return LANGUAGE_NAMES.get(code.lower(), code)


# Qwen3 ASR / forced-aligner variants exposed in the UI and download manager.
ASR_MODELS: list[dict[str, str]] = [
    {"repo_id": "Qwen/Qwen3-ASR-1.7B", "label": "Qwen3 ASR 1.7B"},
    {"repo_id": "Qwen/Qwen3-ASR-0.6B", "label": "Qwen3 ASR 0.6B"},
    {"repo_id": "Qwen/Qwen3-ASR-1.7B-hf", "label": "Qwen3 ASR 1.7B (HF weights)"},
    {"repo_id": "Qwen/Qwen3-ASR-0.6B-hf", "label": "Qwen3 ASR 0.6B (HF weights)"},
]

FORCED_ALIGNER_MODELS: list[dict[str, str]] = [
    {"repo_id": "Qwen/Qwen3-ForcedAligner-0.6B", "label": "Qwen3 Forced Aligner 0.6B"},
    {"repo_id": "Qwen/Qwen3-ForcedAligner-0.6B-hf", "label": "Qwen3 Forced Aligner 0.6B (HF weights)"},
]


class PipelineConfig(BaseModel):
    """Per-job configuration controlling the transcription/translation pipeline."""

    source_lang: str = Field("sv", description="ISO code of the spoken language")
    target_lang: str = Field("en", description="ISO code of the translation language")

    asr_model: str = "Qwen/Qwen3-ASR-1.7B"
    forced_aligner_model: str = "Qwen/Qwen3-ForcedAligner-0.6B"

    translator_backend: Literal["helsinki", "hunyuan", "translategemma"] = "helsinki"

    qc_enabled: bool = False
    lmstudio_url: str = "http://localhost:1234/v1"
    lmstudio_model: str = "local-model"
    qc_batch_size: int = Field(8, ge=1, le=32, description="Subtitle cues per LM Studio QC request")

    # Segmentation tuning.
    max_cue_chars: int = 84
    max_cue_duration: float = 6.0
    pause_gap: float = 0.6

    def helsinki_model(self, src: str, tgt: str) -> str:
        return f"Helsinki-NLP/opus-mt-{src}-{tgt}"


class Settings(BaseSettings):
    """Process-wide settings (paths, server)."""

    model_config = SettingsConfigDict(env_prefix="SUBTITLE_", env_file=".env", extra="ignore")

    data_dir: Path = Path(__file__).resolve().parent.parent / "data"
    device: str = "cuda:0"
    torch_dtype: str = "bfloat16"
    # Allow disabling heavy model loading for development / smoke testing.
    mock_models: bool = False

    @property
    def jobs_dir(self) -> Path:
        return self.data_dir / "jobs"

    def ensure_dirs(self) -> None:
        self.jobs_dir.mkdir(parents=True, exist_ok=True)


settings = Settings()
settings.ensure_dirs()
