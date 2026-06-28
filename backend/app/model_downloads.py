"""HuggingFace model registry, cache inspection, and background downloads."""
from __future__ import annotations

import asyncio
import os
import threading
import traceback
from dataclasses import dataclass
from enum import Enum
from typing import Dict, List, Optional

from huggingface_hub import HfApi, scan_cache_dir, snapshot_download

from .config import OMNIVOICE_MODEL, QWEN_TTS_TOKENIZER, VOXCPM_MODEL, settings
from .model_paths import is_hf_model_available


class ModelCategory(str, Enum):
    asr = "asr"
    translation = "translation"
    tts = "tts"


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
        description="1.7B ASR with HuggingFace weight layout.",
    ),
    ModelEntry(
        id="qwen3-asr-0.6b-hf",
        repo_id="Qwen/Qwen3-ASR-0.6B-hf",
        label="Qwen3 ASR 0.6B (HF weights)",
        category=ModelCategory.asr,
        description="0.6B ASR with HuggingFace weight layout.",
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
        description="Forced aligner with HuggingFace weight layout.",
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
        id="whisper-large-v3-turbo",
        repo_id="openai/whisper-large-v3-turbo",
        label="Whisper Large v3 Turbo",
        category=ModelCategory.asr,
        description="Whisper large v3 turbo — faster with minor quality trade-off.",
    ),
    ModelEntry(
        id="nemotron-3.5-asr",
        repo_id="nvidia/nemotron-3.5-asr-streaming-0.6b",
        label="Nemotron 3.5 ASR Streaming 0.6B",
        category=ModelCategory.asr,
        description="NVIDIA Nemotron multilingual ASR (40 locales).",
    ),
    ModelEntry(
        id="hunyuan-mt1.5-1.8b",
        repo_id="tencent/HY-MT1.5-1.8B",
        label="Hunyuan HY-MT1.5-1.8B",
        category=ModelCategory.translation,
        description="Tencent Hunyuan 1.8B translation model (recommended).",
    ),
    ModelEntry(
        id="hunyuan-mt1.5-1.8b-fp8",
        repo_id="tencent/HY-MT1.5-1.8B-FP8",
        label="Hunyuan HY-MT1.5-1.8B FP8",
        category=ModelCategory.translation,
        description="Hunyuan 1.8B FP8 quantized.",
    ),
    ModelEntry(
        id="hunyuan-mt1.5-1.8b-gptq",
        repo_id="tencent/HY-MT1.5-1.8B-GPTQ-Int4",
        label="Hunyuan HY-MT1.5-1.8B GPTQ Int4",
        category=ModelCategory.translation,
        description="Hunyuan 1.8B GPTQ Int4 quantized.",
    ),
    ModelEntry(
        id="hunyuan-mt1.5-7b",
        repo_id="tencent/HY-MT1.5-7B",
        label="Hunyuan HY-MT1.5-7B",
        category=ModelCategory.translation,
        description="Tencent Hunyuan 7B translation model.",
    ),
    ModelEntry(
        id="hunyuan-mt1.5-7b-fp8",
        repo_id="tencent/HY-MT1.5-7B-FP8",
        label="Hunyuan HY-MT1.5-7B FP8",
        category=ModelCategory.translation,
        description="Hunyuan 7B FP8 quantized.",
    ),
    ModelEntry(
        id="hunyuan-mt1.5-7b-gptq",
        repo_id="tencent/HY-MT1.5-7B-GPTQ-Int4",
        label="Hunyuan HY-MT1.5-7B GPTQ Int4",
        category=ModelCategory.translation,
        description="Hunyuan 7B GPTQ Int4 quantized.",
    ),
    ModelEntry(
        id="hunyuan-mt2-1.8b",
        repo_id="tencent/Hy-MT2-1.8B",
        label="Hunyuan Hy-MT2-1.8B",
        category=ModelCategory.translation,
        description="Tencent Hy-MT2 1.8B fast-thinking translation model.",
    ),
    ModelEntry(
        id="hunyuan-mt2-1.8b-fp8",
        repo_id="tencent/Hy-MT2-1.8B-FP8",
        label="Hunyuan Hy-MT2-1.8B FP8",
        category=ModelCategory.translation,
        description="Hy-MT2 1.8B FP8 quantized.",
    ),
    ModelEntry(
        id="hunyuan-mt2-7b",
        repo_id="tencent/Hy-MT2-7B",
        label="Hunyuan Hy-MT2-7B",
        category=ModelCategory.translation,
        description="Tencent Hy-MT2 7B fast-thinking translation model.",
    ),
    ModelEntry(
        id="hunyuan-mt2-7b-fp8",
        repo_id="tencent/Hy-MT2-7B-FP8",
        label="Hunyuan Hy-MT2-7B FP8",
        category=ModelCategory.translation,
        description="Hy-MT2 7B FP8 quantized.",
    ),
    ModelEntry(
        id="translategemma",
        repo_id="google/translategemma-4b-it",
        label="TranslateGemma 4B",
        category=ModelCategory.translation,
        description="Google TranslateGemma instruction model.",
    ),
    ModelEntry(
        id="nllb-600m-distilled",
        repo_id="facebook/nllb-200-distilled-600M",
        label="NLLB 600M Distilled",
        category=ModelCategory.translation,
        description="Meta NLLB-200 distilled 600M — fast multilingual translation.",
    ),
    ModelEntry(
        id="nllb-1.3b",
        repo_id="facebook/nllb-200-1.3B",
        label="NLLB 1.3B",
        category=ModelCategory.translation,
        description="Meta NLLB-200 1.3B parameter model.",
    ),
    ModelEntry(
        id="nllb-1.3b-distilled",
        repo_id="facebook/nllb-200-distilled-1.3B",
        label="NLLB 1.3B Distilled",
        category=ModelCategory.translation,
        description="Meta NLLB-200 distilled 1.3B.",
    ),
    ModelEntry(
        id="nllb-3.3b",
        repo_id="facebook/nllb-200-3.3B",
        label="NLLB 3.3B",
        category=ModelCategory.translation,
        description="Meta NLLB-200 3.3B — best quality, heavy VRAM.",
    ),
    ModelEntry(
        id="qwen3-tts-tokenizer",
        repo_id=QWEN_TTS_TOKENIZER,
        label="Qwen3 TTS Tokenizer 12Hz",
        category=ModelCategory.tts,
        description="Shared tokenizer for all Qwen3-TTS models.",
        required=True,
    ),
    ModelEntry(
        id="qwen3-tts-1.7b-custom",
        repo_id="Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
        label="Qwen3 TTS 1.7B CustomVoice",
        category=ModelCategory.tts,
        description="Qwen3 preset speakers with optional style instruct.",
    ),
    ModelEntry(
        id="qwen3-tts-0.6b-custom",
        repo_id="Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
        label="Qwen3 TTS 0.6B CustomVoice",
        category=ModelCategory.tts,
        description="Smaller Qwen3 CustomVoice — less VRAM.",
    ),
    ModelEntry(
        id="qwen3-tts-1.7b-design",
        repo_id="Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign",
        label="Qwen3 TTS 1.7B VoiceDesign",
        category=ModelCategory.tts,
        description="Natural-language voice design for Qwen3-TTS.",
    ),
    ModelEntry(
        id="qwen3-tts-1.7b-base",
        repo_id="Qwen/Qwen3-TTS-12Hz-1.7B-Base",
        label="Qwen3 TTS 1.7B Base",
        category=ModelCategory.tts,
        description="Qwen3 voice clone from reference audio + transcript.",
    ),
    ModelEntry(
        id="qwen3-tts-0.6b-base",
        repo_id="Qwen/Qwen3-TTS-12Hz-0.6B-Base",
        label="Qwen3 TTS 0.6B Base",
        category=ModelCategory.tts,
        description="Smaller Qwen3 voice clone — less VRAM.",
    ),
    ModelEntry(
        id="voxcpm2",
        repo_id=VOXCPM_MODEL,
        label="VoxCPM2",
        category=ModelCategory.tts,
        description="Multilingual TTS with voice design and cloning.",
    ),
    ModelEntry(
        id="omnivoice",
        repo_id=OMNIVOICE_MODEL,
        label="OmniVoice",
        category=ModelCategory.tts,
        description="Zero-shot voice cloning TTS.",
    ),
]

_REGISTRY_BY_ID = {m.id: m for m in MODEL_REGISTRY}
_REGISTRY_BY_REPO = {m.repo_id: m for m in MODEL_REGISTRY}

TRANSLATOR_REPOS = {
    "translategemma": "google/translategemma-4b-it",
}


def get_hf_token() -> Optional[str]:
    """Return the active HF token (runtime override > settings env)."""
    mgr = globals().get("download_manager")
    if mgr is not None and mgr.runtime_hf_token:
        return mgr.runtime_hf_token
    return settings.hf_token or None


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
    nemotron_model: str = "nvidia/nemotron-3.5-asr-streaming-0.6b",
    nllb_model: str = "facebook/nllb-200-distilled-600M",
    hunyuan_model: str = "tencent/HY-MT1.5-1.8B",
    job_mode: str = "subtitle",
    tts_backend: str = "qwen",
    tts_model: str = "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
) -> List[str]:
    """Return HuggingFace repo ids required for a pipeline job."""
    if asr_engine == "whisper":
        repos = [whisper_model]
    elif asr_engine == "nemotron":
        repos = [nemotron_model]
    else:
        repos = [asr_model, forced_aligner_model]
    if translator_backend == "helsinki":
        from .helsinki_models import resolve_helsinki_repo

        repos.append(resolve_helsinki_repo(source_lang, target_lang))
        if qc_enabled:
            repos.append(resolve_helsinki_repo(target_lang, source_lang))
    elif translator_backend == "nllb":
        repos.append(nllb_model)
    elif translator_backend == "hunyuan":
        repos.append(hunyuan_model)
    elif translator_backend in TRANSLATOR_REPOS:
        repos.append(TRANSLATOR_REPOS[translator_backend])

    if job_mode == "dub":
        if tts_backend == "qwen":
            repos.append(QWEN_TTS_TOKENIZER)
            repos.append(tts_model)
        elif tts_backend == "voxcpm":
            repos.append(VOXCPM_MODEL)
        elif tts_backend == "omnivoice":
            repos.append(OMNIVOICE_MODEL)

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
    return is_hf_model_available(repo_id)


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
        self.runtime_hf_token: Optional[str] = None
        if settings.hf_token:
            os.environ["HF_TOKEN"] = settings.hf_token
            os.environ["HUGGING_FACE_HUB_TOKEN"] = settings.hf_token

    def _apply_hf_token_env(self) -> None:
        token = get_hf_token()
        if token:
            os.environ["HF_TOKEN"] = token
            os.environ["HUGGING_FACE_HUB_TOKEN"] = token
        else:
            os.environ.pop("HF_TOKEN", None)
            os.environ.pop("HUGGING_FACE_HUB_TOKEN", None)

    def set_hf_token(self, token: Optional[str]) -> dict:
        """Set or clear runtime HF token; validate with whoami when setting."""
        if token is not None and not token.strip():
            token = None
        elif token is not None:
            token = token.strip()
            api = HfApi(token=token)
            try:
                info = api.whoami()
            except Exception as exc:  # noqa: BLE001
                raise ValueError(f"Invalid HuggingFace token: {exc}") from exc
            self.runtime_hf_token = token
            self._apply_hf_token_env()
            return {
                "configured": True,
                "username": info.get("name") or info.get("fullname"),
                "source": "runtime",
            }

        self.runtime_hf_token = None
        self._apply_hf_token_env()
        return self.get_hf_auth_status()

    def get_hf_auth_status(self) -> dict:
        token = get_hf_token()
        if not token:
            return {"configured": False, "username": None, "source": None}

        source = "runtime" if self.runtime_hf_token else "env"
        try:
            info = HfApi(token=token).whoami()
            username = info.get("name") or info.get("fullname")
        except Exception:  # noqa: BLE001
            return {"configured": False, "username": None, "source": source}

        return {"configured": True, "username": username, "source": source}

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
            if "asr" in lowered or "aligner" in lowered or "whisper" in lowered or "nemotron" in lowered:
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

    def get_model_state(self, model_id: str) -> Optional[dict]:
        try:
            entry = self._entry(model_id)
        except KeyError:
            return None
        state = self._refresh_cached_entry(entry)
        return {
            "model_id": model_id,
            "repo_id": entry.repo_id,
            "status": state.status.value,
            "progress": round(state.progress, 3),
            "message": state.message,
            "error": state.error,
            "size_on_disk": state.size_on_disk,
        }

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
        token = get_hf_token()
        try:
            state.status = DownloadStatus.downloading
            state.progress = 0.0
            state.error = None
            state.message = "Fetching file list..."
            self._emit(model_id)

            state.message = "Downloading repository..."
            self._emit(model_id)
            tqdm_cls = _make_tqdm(state, 0, 1)
            snapshot_download(
                repo_id=entry.repo_id,
                repo_type="model",
                token=token,
                tqdm_class=tqdm_cls,
            )
            state.progress = 1.0
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
