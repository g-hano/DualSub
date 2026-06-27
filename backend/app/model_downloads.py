"""Hugging Face model registry, cache inspection, and background downloads."""
from __future__ import annotations

import asyncio
import threading
import traceback
from dataclasses import dataclass
from enum import Enum
from typing import Dict, List, Optional

from huggingface_hub import HfApi, hf_hub_download, scan_cache_dir, try_to_load_from_cache
from huggingface_hub.errors import LocalEntryNotFoundError


class ModelCategory(str, Enum):
    asr = "asr"
    translation = "translation"


class DownloadStatus(str, Enum):
    not_downloaded = "not_downloaded"
    downloaded = "downloaded"
    downloading = "downloading"
    error = "error"


@dataclass(frozen=True)
class ModelEntry:
    id: str
    repo_id: str
    label: str
    category: ModelCategory
    description: str
    required: bool = False


MODEL_REGISTRY: List[ModelEntry] = [
    ModelEntry(
        id="qwen3-asr-1.7b",
        repo_id="Qwen/Qwen3-ASR-1.7B",
        label="Qwen3 ASR 1.7B",
        category=ModelCategory.asr,
        description="Speech-to-text transcription (default, larger).",
        required=True,
    ),
    ModelEntry(
        id="qwen3-asr-0.6b",
        repo_id="Qwen/Qwen3-ASR-0.6B",
        label="Qwen3 ASR 0.6B",
        category=ModelCategory.asr,
        description="Smaller ASR model — faster, less VRAM.",
    ),
    ModelEntry(
        id="qwen3-asr-1.7b-hf",
        repo_id="Qwen/Qwen3-ASR-1.7B-hf",
        label="Qwen3 ASR 1.7B (HF weights)",
        category=ModelCategory.asr,
        description="1.7B ASR with Hugging Face weight layout.",
    ),
    ModelEntry(
        id="qwen3-asr-0.6b-hf",
        repo_id="Qwen/Qwen3-ASR-0.6B-hf",
        label="Qwen3 ASR 0.6B (HF weights)",
        category=ModelCategory.asr,
        description="0.6B ASR with Hugging Face weight layout.",
    ),
    ModelEntry(
        id="qwen3-forced-aligner-0.6b",
        repo_id="Qwen/Qwen3-ForcedAligner-0.6B",
        label="Qwen3 Forced Aligner 0.6B",
        category=ModelCategory.asr,
        description="Word-level timestamp alignment (required for karaoke highlighting).",
        required=True,
    ),
    ModelEntry(
        id="qwen3-forced-aligner-0.6b-hf",
        repo_id="Qwen/Qwen3-ForcedAligner-0.6B-hf",
        label="Qwen3 Forced Aligner 0.6B (HF weights)",
        category=ModelCategory.asr,
        description="Forced aligner with Hugging Face weight layout.",
    ),
    ModelEntry(
        id="whisper-small",
        repo_id="openai/whisper-small",
        label="Whisper Small",
        category=ModelCategory.asr,
        description="Whisper small — fast, lower accuracy.",
    ),
    ModelEntry(
        id="whisper-medium",
        repo_id="openai/whisper-medium",
        label="Whisper Medium",
        category=ModelCategory.asr,
        description="Whisper medium — balanced speed/accuracy.",
    ),
    ModelEntry(
        id="whisper-large-v3",
        repo_id="openai/whisper-large-v3",
        label="Whisper Large v3",
        category=ModelCategory.asr,
        description="Whisper large v3 — best accuracy, most VRAM.",
    ),
    ModelEntry(
        id="opus-mt-sv-en",
        repo_id="Helsinki-NLP/opus-mt-sv-en",
        label="Helsinki opus-mt sv→en",
        category=ModelCategory.translation,
        description="Swedish to English (Helsinki backend).",
    ),
    ModelEntry(
        id="opus-mt-en-sv",
        repo_id="Helsinki-NLP/opus-mt-en-sv",
        label="Helsinki opus-mt en→sv",
        category=ModelCategory.translation,
        description="English to Swedish (QC back-translation).",
    ),
    ModelEntry(
        id="hunyuan-mt",
        repo_id="tencent/Hy-MT2-1.8B",
        label="Hunyuan Hy-MT2-1.8B",
        category=ModelCategory.translation,
        description="LLM translation backend.",
    ),
    ModelEntry(
        id="translategemma",
        repo_id="google/translategemma-4b-it",
        label="TranslateGemma 4B",
        category=ModelCategory.translation,
        description="Google TranslateGemma instruction model.",
    ),
]

_REGISTRY_BY_ID = {m.id: m for m in MODEL_REGISTRY}
_REGISTRY_BY_REPO = {m.repo_id: m for m in MODEL_REGISTRY}

TRANSLATOR_REPOS = {
    "hunyuan": "tencent/Hy-MT2-1.8B",
    "translategemma": "google/translategemma-4b-it",
}


def repos_for_job(
    *,
    source_lang: str,
    target_lang: str,
    asr_model: str,
    forced_aligner_model: str,
    translator_backend: str,
    qc_enabled: bool,
    asr_engine: str = "qwen",
    whisper_model: str = "openai/whisper-large-v3",
) -> List[str]:
    """Return Hugging Face repo ids required for a pipeline job."""
    if asr_engine == "whisper":
        repos = [whisper_model]
    else:
        repos = [asr_model, forced_aligner_model]
    if translator_backend == "helsinki":
        repos.append(f"Helsinki-NLP/opus-mt-{source_lang}-{target_lang}")
        if qc_enabled:
            repos.append(f"Helsinki-NLP/opus-mt-{target_lang}-{source_lang}")
    elif translator_backend in TRANSLATOR_REPOS:
        repos.append(TRANSLATOR_REPOS[translator_backend])
    # Preserve order, drop duplicates.
    return list(dict.fromkeys(repos))


@dataclass
class DownloadState:
    status: DownloadStatus = DownloadStatus.not_downloaded
    progress: float = 0.0
    message: str = ""
    error: Optional[str] = None
    size_on_disk: int = 0


@dataclass
class _ActiveDownload:
    state: DownloadState
    thread: threading.Thread


def _cache_size_bytes(repo_id: str) -> int:
    try:
        info = scan_cache_dir()
        for repo in info.repos:
            if repo.repo_id == repo_id and repo.repo_type == "model":
                return repo.size_on_disk
    except Exception:
        pass
    return 0


def is_model_cached(repo_id: str) -> bool:
    try:
        path = try_to_load_from_cache(repo_id, "config.json", repo_type="model")
        return path is not None
    except (LocalEntryNotFoundError, Exception):
        return False


def _make_tqdm(reporter: DownloadState, file_index: int, file_total: int):
    from tqdm.auto import tqdm as base_tqdm

    class FileTqdm(base_tqdm):
        def update(self, n=1):
            super().update(n)
            if self.total and self.total > 0:
                file_frac = self.n / self.total
                reporter.progress = min((file_index + file_frac) / file_total, 0.99)
            if self.desc:
                reporter.message = str(self.desc)

    return FileTqdm


class ModelDownloadManager:
    def __init__(self) -> None:
        self._states: Dict[str, DownloadState] = {}
        self._active: Dict[str, _ActiveDownload] = {}
        self._subscribers: Dict[str, List[asyncio.Queue]] = {}
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._lock = threading.Lock()
        self._extras: Dict[str, ModelEntry] = {}

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def _entry(self, model_id: str) -> ModelEntry:
        if model_id in _REGISTRY_BY_ID:
            return _REGISTRY_BY_ID[model_id]
        if model_id in self._extras:
            return self._extras[model_id]
        raise KeyError(f"Unknown model: {model_id}")

    def _get_or_create_entry(self, repo_id: str) -> ModelEntry:
        if repo_id in _REGISTRY_BY_REPO:
            return _REGISTRY_BY_REPO[repo_id]
        model_id = f"repo:{repo_id.replace('/', '__')}"
        if model_id not in self._extras:
            lowered = repo_id.lower()
            if "asr" in lowered or "aligner" in lowered or "whisper" in lowered:
                category = ModelCategory.asr
            else:
                category = ModelCategory.translation
            self._extras[model_id] = ModelEntry(
                id=model_id,
                repo_id=repo_id,
                label=repo_id.split("/")[-1],
                category=category,
                description="Auto-downloaded for the current job.",
            )
        return self._extras[model_id]

    def _state(self, model_id: str) -> DownloadState:
        if model_id not in self._states:
            self._states[model_id] = DownloadState()
        return self._states[model_id]

    def _refresh_cached_entry(self, entry: ModelEntry) -> DownloadState:
        state = self._state(entry.id)
        if entry.id in self._active:
            return state
        size = _cache_size_bytes(entry.repo_id)
        state.size_on_disk = size
        if is_model_cached(entry.repo_id):
            state.status = DownloadStatus.downloaded
            state.progress = 1.0
            state.message = "Cached locally"
            state.error = None
        elif state.status not in (DownloadStatus.downloading, DownloadStatus.error):
            state.status = DownloadStatus.not_downloaded
            state.progress = 0.0
            state.message = ""
        return state

    def _refresh_cached(self, model_id: str) -> DownloadState:
        return self._refresh_cached_entry(self._entry(model_id))

    def _entry_to_dict(self, entry: ModelEntry, state: DownloadState) -> dict:
        return {
            "id": entry.id,
            "repo_id": entry.repo_id,
            "label": entry.label,
            "category": entry.category.value,
            "description": entry.description,
            "required": entry.required,
            "status": state.status.value,
            "progress": round(state.progress, 3),
            "message": state.message,
            "error": state.error,
            "size_on_disk": state.size_on_disk,
        }

    def list_models(self) -> List[dict]:
        out: List[dict] = []
        seen: set[str] = set()
        for entry in list(MODEL_REGISTRY) + list(self._extras.values()):
            if entry.id in seen:
                continue
            seen.add(entry.id)
            state = self._refresh_cached_entry(entry)
            out.append(self._entry_to_dict(entry, state))
        return out

    def ensure_repos(self, repo_ids: List[str]) -> dict:
        """Start downloads for any uncached repos; return tracking ids."""
        started: List[str] = []
        waiting: List[str] = []
        ready: List[str] = []
        for repo_id in repo_ids:
            entry = self._get_or_create_entry(repo_id)
            state = self._refresh_cached_entry(entry)
            if state.status == DownloadStatus.downloaded:
                ready.append(entry.id)
            elif state.status == DownloadStatus.downloading:
                waiting.append(entry.id)
            else:
                self.start_download(entry.id)
                started.append(entry.id)
        pending = started + waiting
        return {
            "started": started,
            "waiting": waiting,
            "ready": ready,
            "pending": pending,
        }

    def subscribe(self, model_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self._subscribers.setdefault(model_id, []).append(q)
        return q

    def unsubscribe(self, model_id: str, q: asyncio.Queue) -> None:
        subs = self._subscribers.get(model_id, [])
        if q in subs:
            subs.remove(q)

    def _emit(self, model_id: str) -> None:
        state = self._state(model_id)
        entry = self._entry(model_id)
        payload = {
            "model_id": model_id,
            "repo_id": entry.repo_id,
            "status": state.status.value,
            "progress": round(state.progress, 3),
            "message": state.message,
            "error": state.error,
            "size_on_disk": state.size_on_disk,
        }
        loop = self._loop
        for q in list(self._subscribers.get(model_id, [])):
            if loop is not None:
                loop.call_soon_threadsafe(q.put_nowait, payload)

    def _download_worker(self, model_id: str) -> None:
        entry = self._entry(model_id)
        state = self._state(model_id)
        try:
            state.status = DownloadStatus.downloading
            state.progress = 0.0
            state.error = None
            state.message = "Fetching file list..."
            self._emit(model_id)

            api = HfApi()
            files = api.list_repo_files(entry.repo_id)
            total = max(len(files), 1)

            for i, filename in enumerate(files):
                state.message = f"{filename} ({i + 1}/{total})"
                self._emit(model_id)
                tqdm_cls = _make_tqdm(state, i, total)
                hf_hub_download(
                    entry.repo_id,
                    filename,
                    repo_type="model",
                    tqdm_class=tqdm_cls,
                )
                state.progress = (i + 1) / total
                self._emit(model_id)

            state.status = DownloadStatus.downloaded
            state.progress = 1.0
            state.message = "Download complete"
            state.size_on_disk = _cache_size_bytes(entry.repo_id)
            self._emit(model_id)
        except Exception as exc:  # noqa: BLE001
            state.status = DownloadStatus.error
            state.error = f"{exc}\n{traceback.format_exc()}"
            state.message = str(exc)
            self._emit(model_id)
        finally:
            with self._lock:
                self._active.pop(model_id, None)

    def start_download(self, model_id: str) -> DownloadState:
        self._entry(model_id)
        state = self._refresh_cached(model_id)
        if state.status == DownloadStatus.downloaded:
            return state
        with self._lock:
            if model_id in self._active:
                return self._active[model_id].state
            state.status = DownloadStatus.downloading
            state.progress = 0.0
            state.message = "Starting..."
            thread = threading.Thread(
                target=self._download_worker, args=(model_id,), daemon=True
            )
            self._active[model_id] = _ActiveDownload(state=state, thread=thread)
            thread.start()
        self._emit(model_id)
        return state

    def validate_model_id(self, model_id: str) -> ModelEntry:
        return self._entry(model_id)

    def start_required_downloads(self) -> List[str]:
        started: List[str] = []
        for entry in MODEL_REGISTRY:
            if not entry.required:
                continue
            state = self._refresh_cached(entry.id)
            if state.status != DownloadStatus.downloaded:
                self.start_download(entry.id)
                started.append(entry.id)
        return started


download_manager = ModelDownloadManager()
