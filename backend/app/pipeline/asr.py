"""Speech recognition with two selectable engines:

  - Qwen3-ASR plus word-level timestamps via the Qwen3-ForcedAligner companion.
  - Whisper (via the transformers ASR pipeline) with built-in word timestamps.

Models are loaded lazily and cached process-wide because they are large, and
can be released from the GPU via :func:`unload` before the translation stage.
"""
from __future__ import annotations

import gc
import logging
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

from ..config import language_name, settings
from ..logging_config import suppress_hf_progress_bars

logger = logging.getLogger(__name__)


@dataclass
class AsrWord:
    w: str
    start: float
    end: float


@dataclass
class AsrResult:
    language: Optional[str]
    text: str
    words: List[AsrWord]


_model = None
_whisper = None
_model_lock = threading.Lock()


def _torch_dtype():
    import torch

    return {
        "bfloat16": torch.bfloat16,
        "float16": torch.float16,
        "float32": torch.float32,
    }.get(settings.torch_dtype, torch.bfloat16)


def _load_qwen_model(asr_model: str, aligner_model: str):
    """Load and cache the Qwen3ASRModel with the forced aligner attached."""
    global _model
    if _model is not None:
        return _model
    with _model_lock:
        if _model is not None:
            return _model
        from qwen_asr import Qwen3ASRModel  # type: ignore

        suppress_hf_progress_bars()
        dtype = _torch_dtype()
        _model = Qwen3ASRModel.from_pretrained(
            asr_model,
            dtype=dtype,
            device_map=settings.device,
            max_inference_batch_size=8,
            max_new_tokens=2048,
            forced_aligner=aligner_model,
            forced_aligner_kwargs=dict(
                dtype=dtype,
                device_map=settings.device,
            ),
        )
        return _model


def _load_whisper_model(whisper_model: str):
    """Load and cache a Whisper ASR pipeline from transformers."""
    global _whisper
    if _whisper is not None:
        return _whisper
    with _model_lock:
        if _whisper is not None:
            return _whisper
        from transformers import pipeline

        suppress_hf_progress_bars()
        device = 0 if settings.device.startswith("cuda") else -1
        _whisper = pipeline(
            "automatic-speech-recognition",
            model=whisper_model,
            dtype=_torch_dtype(),
            device=device,
        )
        return _whisper


def unload() -> None:
    """Release cached ASR models from GPU/CPU memory.

    Called before the translation stage so the ASR model frees its VRAM before
    the translator loads.
    """
    global _model, _whisper
    with _model_lock:
        had_model = _model is not None or _whisper is not None
        _model = None
        _whisper = None
    if not had_model:
        return
    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:  # noqa: BLE001
        pass
    logger.info("Unloaded ASR model from memory")


def _coerce_words(time_stamps) -> List[AsrWord]:
    words: List[AsrWord] = []
    for ts in time_stamps or []:
        text = getattr(ts, "text", None)
        start = getattr(ts, "start_time", None)
        end = getattr(ts, "end_time", None)
        if text is None and isinstance(ts, dict):
            text = ts.get("text")
            start = ts.get("start_time")
            end = ts.get("end_time")
        if text is None or start is None or end is None:
            continue
        token = str(text).strip()
        if not token:
            continue
        words.append(AsrWord(w=token, start=float(start), end=float(end)))
    return words


def transcribe(wav_path: Path, source_lang: str, config) -> AsrResult:
    """Transcribe a WAV file, returning text and word-level timestamps."""
    if settings.mock_models:
        return _mock_transcribe(wav_path, source_lang)

    if getattr(config, "asr_engine", "qwen") == "whisper":
        return _transcribe_whisper(wav_path, source_lang, config)
    return _transcribe_qwen(wav_path, source_lang, config)


def _transcribe_qwen(wav_path: Path, source_lang: str, config) -> AsrResult:
    model = _load_qwen_model(config.asr_model, config.forced_aligner_model)
    results = model.transcribe(
        audio=str(wav_path),
        language=language_name(source_lang),
        return_time_stamps=True,
    )
    r = results[0]
    words = _coerce_words(getattr(r, "time_stamps", None))
    text = getattr(r, "text", "") or " ".join(w.w for w in words)
    return AsrResult(language=getattr(r, "language", None), text=text, words=words)


def _transcribe_whisper(wav_path: Path, source_lang: str, config) -> AsrResult:
    pipe = _load_whisper_model(config.whisper_model)
    generate_kwargs = {"task": "transcribe"}
    name = language_name(source_lang)
    if name is not None:
        generate_kwargs["language"] = name.lower()
    result = pipe(
        str(wav_path),
        return_timestamps="word",
        chunk_length_s=30,
        generate_kwargs=generate_kwargs,
    )
    words = _coerce_whisper_chunks(result.get("chunks") if isinstance(result, dict) else None)
    text = (result.get("text") if isinstance(result, dict) else "") or " ".join(w.w for w in words)
    return AsrResult(language=name, text=str(text).strip(), words=words)


def _coerce_whisper_chunks(chunks) -> List[AsrWord]:
    words: List[AsrWord] = []
    for chunk in chunks or []:
        text = chunk.get("text") if isinstance(chunk, dict) else None
        ts = chunk.get("timestamp") if isinstance(chunk, dict) else None
        if text is None or not ts:
            continue
        start, end = ts[0], ts[1]
        if start is None:
            continue
        token = str(text).strip()
        if not token:
            continue
        # Whisper occasionally omits a closing timestamp on the final word.
        if end is None:
            end = start
        words.append(AsrWord(w=token, start=float(start), end=float(end)))
    return words


def _mock_transcribe(wav_path: Path, source_lang: str) -> AsrResult:
    """Deterministic fake transcription for development without GPU/models."""
    sample = (
        "Hej och välkommen till en långsam svensk podd . "
        "Idag ska vi prata om vädret och vardagen ."
    )
    tokens = sample.split()
    words: List[AsrWord] = []
    t = 0.5
    for tok in tokens:
        dur = 0.25 + 0.05 * len(tok)
        words.append(AsrWord(w=tok, start=round(t, 3), end=round(t + dur, 3)))
        t += dur + 0.05
    return AsrResult(language=source_lang, text=" ".join(tokens), words=words)
