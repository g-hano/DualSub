"""Helsinki-NLP opus-mt registry and language-pair resolution."""
from __future__ import annotations

import importlib.util
from functools import lru_cache
from pathlib import Path
from typing import Dict, Tuple

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
_SCRAPE_PATH = _REPO_ROOT / "helsinki_models.py"


def _load_scrape_module():
    if not _SCRAPE_PATH.is_file():
        raise FileNotFoundError(
            f"Helsinki model list not found at {_SCRAPE_PATH}. "
            "Add helsinki_models.py to the project root."
        )
    spec = importlib.util.spec_from_file_location("_helsinki_scrape", _SCRAPE_PATH)
    if spec is None or spec.loader is None:
        raise ImportError(f"Could not load {_SCRAPE_PATH}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@lru_cache(maxsize=1)
def helsinki_repo_ids() -> tuple[str, ...]:
    mod = _load_scrape_module()
    return tuple(mod.helsinki_models)


@lru_cache(maxsize=1)
def _pair_index() -> Dict[Tuple[str, str], str]:
    """Map (source_iso, target_iso) to Helsinki-NLP repo id for simple opus-mt pairs."""
    mod = _load_scrape_module()
    clear = set(mod.get_clearly_formatted_langauge_directions())
    pairs: Dict[Tuple[str, str], str] = {}
    for repo in mod.helsinki_models:
        prefix = "Helsinki-NLP/opus-mt-"
        if not repo.startswith(prefix):
            continue
        direction = repo[len(prefix) :]
        if direction not in clear:
            continue
        src, tgt = direction.split("-", 1)
        pairs[(src, tgt)] = repo
    return pairs


def helsinki_pair_available(src: str, tgt: str) -> bool:
    return (src.lower(), tgt.lower()) in _pair_index()


def resolve_helsinki_repo(src: str, tgt: str) -> str:
    """Return the HuggingFace repo id for a Helsinki opus-mt direction."""
    key = (src.lower(), tgt.lower())
    repo = _pair_index().get(key)
    if repo is None:
        raise ValueError(
            f"No Helsinki opus-mt model for {src}->{tgt}. "
            "Choose NLLB or Hunyuan for this language pair, or pick a supported direction."
        )
    return repo
