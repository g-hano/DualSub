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

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def _entry(self, model_id: str) -> ModelEntry:
        if model_id not in _REGISTRY_BY_ID:
            raise KeyError(f"Unknown model: {model_id}")
        return _REGISTRY_BY_ID[model_id]

    def _state(self, model_id: str) -> DownloadState:
        if model_id not in self._states:
            self._states[model_id] = DownloadState()
        return self._states[model_id]

    def _refresh_cached(self, model_id: str) -> DownloadState:
        entry = self._entry(model_id)
        state = self._state(model_id)
        if model_id in self._active:
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

    def list_models(self) -> List[dict]:
        out: List[dict] = []
        for entry in MODEL_REGISTRY:
            state = self._refresh_cached(entry.id)
            out.append(
                {
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
            )
        return out

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
