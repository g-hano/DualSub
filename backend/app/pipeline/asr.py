"""Speech recognition with selectable engines:

  - Qwen3-ASR plus word-level timestamps via the Qwen3-ForcedAligner companion.
  - Whisper (via the transformers ASR pipeline) with built-in word timestamps.
  - Nemotron 3.5 ASR (via transformers AutoModelForRNNT) with token timestamps.

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

from ..config import language_name, nemotron_locale, settings
from ..logging_config import suppress_hf_progress_bars
from ..model_paths import resolve_hf_model_path

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
_nemotron = None
_model_lock = threading.Lock()


def _torch_dtype():
    import torch

    return {
        "bfloat16": torch.bfloat16,
        "float16": torch.float16,
        "float32": torch.float32,
    }.get(settings.torch_dtype, torch.bfloat16)


def _load_qwen_model(asr_model: str, aligner_model: str):
    """Load and cache the Qwen3ASRModel with the forced aligner attached.

    ``max_inference_batch_size=1`` because each job transcribes a single file.
    Batching multiple chunks in one forward pass is handled internally by
    qwen-asr when long audio is split for the forced aligner (180 s chunks).
    """
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
            resolve_hf_model_path(asr_model),
            dtype=dtype,
            device_map=settings.device,
            max_inference_batch_size=1,
            max_new_tokens=4096,
            forced_aligner=resolve_hf_model_path(aligner_model),
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
            model=resolve_hf_model_path(whisper_model),
            dtype=_torch_dtype(),
            device=device,
        )
        return _whisper


def _load_nemotron_model(nemotron_model: str):
    """Load and cache Nemotron ASR model + processor."""
    global _nemotron
    if _nemotron is not None:
        return _nemotron
    with _model_lock:
        if _nemotron is not None:
            return _nemotron
        from transformers import AutoModelForRNNT, AutoProcessor

        suppress_hf_progress_bars()
        nemotron_path = resolve_hf_model_path(nemotron_model)
        processor = AutoProcessor.from_pretrained(nemotron_path)
        model = AutoModelForRNNT.from_pretrained(
            nemotron_path,
            dtype=_torch_dtype(),
            device_map="auto",
        )
        _nemotron = (processor, model)
        return _nemotron


def unload() -> None:
    """Release cached ASR models from GPU/CPU memory."""
    global _model, _whisper, _nemotron
    with _model_lock:
        had_model = _model is not None or _whisper is not None or _nemotron is not None
        _model = None
        _whisper = None
        _nemotron = None
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


def _iter_timestamp_items(time_stamps):
    """Yield aligner items from ForcedAlignResult or plain iterables."""
    if time_stamps is None:
        yield from ()
        return
    items = getattr(time_stamps, "items", None)
    if items is not None:
        for item in items:
            yield item
        return
    if isinstance(time_stamps, dict) and "items" in time_stamps:
        for item in time_stamps["items"]:
            yield item
        return
    if hasattr(time_stamps, "__iter__") and not isinstance(time_stamps, (str, bytes)):
        for item in time_stamps:
            yield item


def _fix_word_timestamps(words: List[AsrWord]) -> List[AsrWord]:
    """Clamp negatives and log non-monotonic jumps."""
    fixed: List[AsrWord] = []
    prev_end = 0.0
    for w in words:
        start = max(0.0, float(w.start))
        end = max(start, float(w.end))
        if fixed and start < prev_end - 0.1:
            logger.warning(
                "Non-monotonic ASR timestamp for %r: %.3fs (previous end %.3fs)",
                w.w,
                start,
                prev_end,
            )
        fixed.append(AsrWord(w=w.w, start=round(start, 3), end=round(end, 3)))
        prev_end = end
    return fixed


def _coerce_words(time_stamps) -> List[AsrWord]:
    words: List[AsrWord] = []
    for ts in _iter_timestamp_items(time_stamps):
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
    return _fix_word_timestamps(words)


def _qwen_max_new_tokens(duration_sec: float) -> int:
    """Scale token budget with audio length so long files are not truncated."""
    return max(4096, min(16384, int(duration_sec * 8)))


def _log_timestamp_diagnostics(words: List[AsrWord], wav_path: Path) -> None:
    duration = _audio_duration(wav_path)
    logger.info("ASR diagnostics: %d words, audio %.2fs", len(words), duration)
    if not words:
        return
    logger.info(
        "ASR timestamp range: %.3fs – %.3fs (last word ends %.3fs)",
        words[0].start,
        words[-1].end,
        words[-1].end,
    )
    if duration > 0 and words[-1].end < duration * 0.5:
        logger.warning(
            "ASR last timestamp (%.2fs) is far below audio duration (%.2fs) — "
            "transcript may have been truncated",
            words[-1].end,
            duration,
        )
    window = [w for w in words if 25.0 <= w.start <= 35.0]
    if window:
        sample = ", ".join(f"{w.w}@{w.start:.2f}s" for w in window[:10])
        logger.info("ASR words at 25–35s: %s", sample)
    boundary = [w for w in words if 29.0 <= w.start <= 31.0]
    for w in boundary:
        logger.info("ASR near 30s boundary: %r @ %.3fs", w.w, w.start)


def transcribe(wav_path: Path, source_lang: str, config) -> AsrResult:
    """Transcribe a WAV file, returning text and word-level timestamps."""
    if settings.mock_models:
        return _mock_transcribe(wav_path, source_lang)

    engine = getattr(config, "asr_engine", "qwen")
    if engine == "whisper":
        return _transcribe_whisper(wav_path, source_lang, config)
    if engine == "nemotron":
        return _transcribe_nemotron(wav_path, source_lang, config)
    return _transcribe_qwen(wav_path, source_lang, config)


def _transcribe_qwen(wav_path: Path, source_lang: str, config) -> AsrResult:
    model = _load_qwen_model(config.asr_model, config.forced_aligner_model)
    duration = _audio_duration(wav_path)
    model.max_new_tokens = _qwen_max_new_tokens(duration)
    logger.info("Qwen ASR max_new_tokens=%d for %.1fs audio", model.max_new_tokens, duration)
    results = model.transcribe(
        audio=str(wav_path),
        language=language_name(source_lang),
        return_time_stamps=True,
    )
    r = results[0]
    words = _coerce_words(getattr(r, "time_stamps", None))
    _log_timestamp_diagnostics(words, wav_path)
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
        if end is None:
            end = start
        words.append(AsrWord(w=token, start=float(start), end=float(end)))
    return words


def _tokens_to_words(token_timestamps: list[dict]) -> List[AsrWord]:
    """Merge Nemotron token-level timestamps into word-level AsrWords."""
    words: List[AsrWord] = []
    current_tokens: list[str] = []
    word_start: float | None = None
    word_end: float | None = None

    def flush() -> None:
        nonlocal current_tokens, word_start, word_end
        if not current_tokens or word_start is None or word_end is None:
            current_tokens = []
            word_start = None
            word_end = None
            return
        text = "".join(current_tokens).strip()
        if text:
            words.append(AsrWord(w=text, start=round(word_start, 3), end=round(word_end, 3)))
        current_tokens = []
        word_start = None
        word_end = None

    for entry in token_timestamps:
        token = str(entry.get("token", ""))
        start = float(entry.get("start", 0))
        end = float(entry.get("end", start))
        if not token:
            continue
        if token.isspace():
            flush()
            continue
        if word_start is None:
            word_start = start
        word_end = end
        current_tokens.append(token)
        if token.endswith((" ", ".", "!", "?", ",", ";", ":")):
            flush()
    flush()
    return words


def _approx_words_from_text(text: str, duration: float) -> List[AsrWord]:
    """Fallback: distribute words evenly across audio duration."""
    tokens = [t for t in text.split() if t]
    if not tokens or duration <= 0:
        return []
    span = max(duration, 0.001)
    step = span / len(tokens)
    words: List[AsrWord] = []
    t = 0.0
    for tok in tokens:
        words.append(AsrWord(w=tok, start=round(t, 3), end=round(t + step, 3)))
        t += step
    if words:
        words[-1].end = round(duration, 3)
    return words


def _audio_duration(wav_path: Path) -> float:
    try:
        import soundfile as sf

        info = sf.info(str(wav_path))
        return float(info.duration)
    except Exception:  # noqa: BLE001
        return 0.0


def _transcribe_nemotron(wav_path: Path, source_lang: str, config) -> AsrResult:
    from transformers.audio_utils import load_audio

    processor, model = _load_nemotron_model(config.nemotron_model)
    locale = nemotron_locale(source_lang)

    sampling_rate = processor.feature_extractor.sampling_rate
    audio = load_audio(str(wav_path), sampling_rate=sampling_rate)

    proc_kwargs: dict = {
        "sampling_rate": sampling_rate,
    }
    if locale and locale != "auto":
        proc_kwargs["language"] = locale
    elif locale == "auto":
        proc_kwargs["language"] = "auto"

    inputs = processor(audio, **proc_kwargs)
    inputs = inputs.to(model.device, dtype=model.dtype)

    output = model.generate(**inputs, return_dict_in_generate=True)
    sequences = output.sequences

    text = ""
    words: List[AsrWord] = []
    durations = getattr(output, "durations", None)

    if durations is not None:
        decoded = processor.decode(sequences, durations=durations, skip_special_tokens=True)
        if isinstance(decoded, tuple):
            text, proc_timestamps = decoded
            if proc_timestamps and len(proc_timestamps) > 0:
                words = _tokens_to_words(proc_timestamps[0])
        else:
            text = decoded
    else:
        text = processor.decode(sequences, skip_special_tokens=True)

    text = str(text).strip()
    if not words and text:
        words = _approx_words_from_text(text, _audio_duration(wav_path))

    return AsrResult(language=locale if locale != "auto" else None, text=text, words=words)


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
