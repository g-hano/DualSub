"""Resolve Hugging Face repo ids to local backend copies before hub cache."""
from __future__ import annotations

import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parent.parent


def configure_hf_cache() -> None:
    """Apply HF_HOME from settings when the hub cache env is not set yet."""
    if os.environ.get("HF_HOME") or os.environ.get("HF_HUB_CACHE"):
        return
    from .config import settings

    if settings.hf_home:
        os.environ["HF_HOME"] = settings.hf_home
        logger.debug("HF cache: %s", settings.hf_home)


def local_backend_model_dir(repo_id: str) -> Path:
    """``Qwen/Qwen3-TTS-...`` -> ``backend/Qwen3-TTS-...``."""
    return BACKEND_DIR / repo_id.split("/")[-1]


def local_backend_model_ready(path: Path) -> bool:
    if not (path / "config.json").is_file():
        return False
    if (path / "model.safetensors").is_file():
        return True
    if (path / "model.safetensors.index.json").is_file():
        return True
    if (path / "pytorch_model.bin").is_file():
        return True
    return any(path.glob("*.safetensors"))


def resolve_hf_model_path(repo_id: str) -> str:
    """Prefer ``backend/<model-name>`` when weights are present, else hub repo id."""
    local = local_backend_model_dir(repo_id)
    if local_backend_model_ready(local):
        logger.info("Using local model: %s", local)
        return str(local)
    return repo_id


def is_hf_model_available(repo_id: str) -> bool:
    if local_backend_model_ready(local_backend_model_dir(repo_id)):
        return True
    try:
        from huggingface_hub import try_to_load_from_cache
        from huggingface_hub.errors import LocalEntryNotFoundError

        path = try_to_load_from_cache(repo_id, "config.json", repo_type="model")
        return path is not None
    except (LocalEntryNotFoundError, Exception):
        return False
