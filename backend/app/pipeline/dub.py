"""Synthesize dubbed speech aligned to subtitle cue timestamps."""
from __future__ import annotations

import logging
from pathlib import Path
from typing import List

import numpy as np
import soundfile as sf

from ..config import PipelineConfig
from ..models import Cue
from .tts import TARGET_SR, TtsEngine, build_voice_config, get_tts_engine
from .voice_ref import VoiceReference

logger = logging.getLogger(__name__)

MAX_STRETCH = 1.4
CROSSFADE_SEC = 0.05


def _resample(audio: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
    if orig_sr == target_sr or len(audio) == 0:
        return audio
    try:
        import librosa

        return librosa.resample(audio, orig_sr=orig_sr, target_sr=target_sr)
    except Exception:
        ratio = target_sr / orig_sr
        n = max(1, int(len(audio) * ratio))
        x_old = np.linspace(0, 1, len(audio))
        x_new = np.linspace(0, 1, n)
        return np.interp(x_new, x_old, audio).astype(np.float32)


def _fit_duration(audio: np.ndarray, sr: int, target_sec: float) -> np.ndarray:
    """Time-stretch or truncate audio to fit within target_sec (only when too long)."""
    if target_sec <= 0:
        return np.zeros(0, dtype=np.float32)
    target_samples = max(1, int(target_sec * sr))
    if len(audio) == 0:
        return np.zeros(target_samples, dtype=np.float32)
    if len(audio) <= target_samples:
        return audio.astype(np.float32)
    ratio = (len(audio) / sr) / target_sec
    if ratio <= MAX_STRETCH:
        try:
            import librosa

            stretched = librosa.effects.time_stretch(audio, rate=ratio)
            if len(stretched) > target_samples:
                return stretched[:target_samples].astype(np.float32)
            return stretched.astype(np.float32)
        except Exception:
            pass
    return audio[:target_samples].astype(np.float32)


def _split_audio_by_weights(audio: np.ndarray, weights: List[int]) -> List[np.ndarray]:
    """Split a single waveform proportionally by character weights."""
    if not weights:
        return []
    total = sum(max(w, 1) for w in weights)
    n = len(audio)
    parts: List[np.ndarray] = []
    pos = 0
    for i, w in enumerate(weights):
        weight = max(w, 1)
        if i == len(weights) - 1:
            parts.append(audio[pos:].astype(np.float32))
            break
        chunk_len = int(n * weight / total)
        parts.append(audio[pos : pos + chunk_len].astype(np.float32))
        pos += chunk_len
    return parts


def _place_on_timeline(
    timeline: np.ndarray,
    audio: np.ndarray,
    start_sample: int,
    *,
    crossfade_samples: int,
) -> None:
    """Add audio at start_sample with optional crossfade at the leading edge."""
    if len(audio) == 0:
        return
    end_sample = start_sample + len(audio)
    if end_sample > len(timeline):
        return

    fade = min(crossfade_samples, len(audio), start_sample)
    if fade > 1:
        ramp = np.linspace(0.0, 1.0, fade, dtype=np.float32)
        faded = audio.copy()
        faded[:fade] *= ramp
        existing = timeline[start_sample : start_sample + fade]
        timeline[start_sample : start_sample + fade] = existing + faded[:fade]
        timeline[start_sample + fade : end_sample] += faded[fade:]
    else:
        timeline[start_sample:end_sample] += audio


def synthesize_timeline(
    cues: List[Cue],
    cfg: PipelineConfig,
    ref: VoiceReference | None,
    out_path: Path,
    engine: TtsEngine | None = None,
    media_duration: float | None = None,
) -> Path:
    """Generate a mono WAV with dubbed speech placed at cue timestamps."""
    if not cues:
        raise ValueError("No cues to dub.")

    voice = build_voice_config(cfg, ref)
    tts = engine or get_tts_engine(cfg.tts_backend, cfg.tts_model)

    total_end = max(c.end for c in cues) + 0.5
    if media_duration is not None:
        total_end = max(total_end, media_duration)
    timeline = np.zeros(int(total_end * TARGET_SR) + TARGET_SR, dtype=np.float32)

    active_cues = [c for c in cues if c.target.text.strip()]
    if not active_cues:
        raise ValueError("No translated text available for dubbing.")

    is_voice_design = cfg.tts_backend == "qwen" and "VoiceDesign" in cfg.tts_model
    use_batch = cfg.tts_backend == "qwen" and "CustomVoice" in cfg.tts_model
    crossfade_samples = int(CROSSFADE_SEC * TARGET_SR)

    synthesized: list[tuple[np.ndarray, int]] = []

    if is_voice_design:
        texts = [c.target.text.strip() for c in active_cues]
        combined = " ".join(texts)
        full_wav, sr = tts.synthesize(combined, voice)
        weights = [max(len(t), 1) for t in texts]
        parts = _split_audio_by_weights(full_wav, weights)
        synthesized = [(p, sr) for p in parts]
        logger.info("VoiceDesign unified synthesis: %d cues from single generation", len(texts))
    elif use_batch:
        texts = [c.target.text.strip() for c in active_cues]
        batch_size = 8
        for i in range(0, len(texts), batch_size):
            chunk = texts[i : i + batch_size]
            synthesized.extend(tts.synthesize_batch(chunk, voice))
    else:
        for cue in active_cues:
            text = cue.target.text.strip()
            synthesized.append(tts.synthesize(text, voice))

    for cue, (wav, sr) in zip(active_cues, synthesized):
        wav = _resample(wav, sr, TARGET_SR)
        cue_duration = max(cue.end - cue.start, 0.01)
        natural_sec = len(wav) / TARGET_SR
        if natural_sec > cue_duration:
            fitted = _fit_duration(wav, TARGET_SR, cue_duration)
        else:
            fitted = wav
        start_sample = int(cue.start * TARGET_SR)
        _place_on_timeline(
            timeline,
            fitted,
            start_sample,
            crossfade_samples=crossfade_samples,
        )

    peak = np.max(np.abs(timeline))
    if peak > 1e-6:
        timeline = timeline / peak * 0.95

    out_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(out_path), timeline, TARGET_SR)
    logger.info("Wrote dubbed vocals timeline to %s (%.1fs)", out_path, len(timeline) / TARGET_SR)
    return out_path
