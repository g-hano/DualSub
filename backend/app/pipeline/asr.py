"""Speech recognition with Qwen3-ASR plus word-level timestamps via the
Qwen3-ForcedAligner companion model.

The model is loaded lazily and cached process-wide because it is large.
"""
from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

from ..config import language_name, settings


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
_model_lock = threading.Lock()


def _torch_dtype():
    import torch

    return {
        "bfloat16": torch.bfloat16,
        "float16": torch.float16,
        "float32": torch.float32,
    }.get(settings.torch_dtype, torch.bfloat16)


def _load_model(asr_model: str, aligner_model: str):
    """Load and cache the Qwen3ASRModel with the forced aligner attached."""
    global _model
    if _model is not None:
        return _model
    with _model_lock:
        if _model is not None:
            return _model
        from qwen_asr import Qwen3ASRModel  # type: ignore

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

    model = _load_model(config.asr_model, config.forced_aligner_model)
    results = model.transcribe(
        audio=str(wav_path),
        language=language_name(source_lang),
        return_time_stamps=True,
    )
    r = results[0]
    words = _coerce_words(getattr(r, "time_stamps", None))
    text = getattr(r, "text", "") or " ".join(w.w for w in words)
    return AsrResult(language=getattr(r, "language", None), text=text, words=words)


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
