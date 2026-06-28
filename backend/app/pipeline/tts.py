"""Pluggable TTS engines for dubbing."""
from __future__ import annotations

import gc
import logging
import threading
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

import numpy as np

from ..config import (
    KOKORO_LANG_CODES,
    OMNIVOICE_MODEL,
    VOXCPM_MODEL,
    is_qwen_voice_clone_model,
    qwen_tts_language,
    settings,
)
from ..logging_config import suppress_hf_progress_bars
from ..model_paths import resolve_hf_model_path
from .voice_ref import VoiceReference

logger = logging.getLogger(__name__)

TARGET_SR = 24000


@dataclass
class VoiceConfig:
    backend: str
    model: str
    voice_mode: str
    voice_id: str
    voice_design_instruct: str
    voice_instruct: str
    ref: Optional[VoiceReference]
    higgs_server_url: str
    target_lang: str
    voice_clone_x_vector_only: bool = False


class TtsEngine(ABC):
    @abstractmethod
    def synthesize(self, text: str, voice: VoiceConfig) -> tuple[np.ndarray, int]: ...

    @abstractmethod
    def synthesize_batch(
        self, texts: List[str], voice: VoiceConfig
    ) -> List[tuple[np.ndarray, int]]: ...

    @abstractmethod
    def unload(self) -> None: ...


def _to_mono_f32(audio: np.ndarray) -> np.ndarray:
    if audio.ndim > 1:
        audio = audio.mean(axis=-1)
    return np.asarray(audio, dtype=np.float32)


def _mock_audio(text: str, sr: int = TARGET_SR) -> np.ndarray:
    dur = max(0.4, min(len(text.split()) * 0.18, 6.0))
    n = int(sr * dur)
    t = np.linspace(0, dur, n, endpoint=False)
    return (0.08 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


class MockTtsEngine(TtsEngine):
    def synthesize(self, text: str, voice: VoiceConfig) -> tuple[np.ndarray, int]:
        return _mock_audio(text), TARGET_SR

    def synthesize_batch(
        self, texts: List[str], voice: VoiceConfig
    ) -> List[tuple[np.ndarray, int]]:
        return [self.synthesize(t, voice) for t in texts]

    def unload(self) -> None:
        pass


class KokoroEngine(TtsEngine):
    def __init__(self) -> None:
        self._pipeline = None
        self._lang_code = "a"
        self._lock = threading.Lock()

    def _ensure(self, lang_code: str) -> None:
        with self._lock:
            if self._pipeline is not None and self._lang_code == lang_code:
                return
            from kokoro import KPipeline

            suppress_hf_progress_bars()
            self._pipeline = KPipeline(lang_code=lang_code)
            self._lang_code = lang_code

    def synthesize(self, text: str, voice: VoiceConfig) -> tuple[np.ndarray, int]:
        lang_code = KOKORO_LANG_CODES.get(voice.target_lang.lower(), "a")
        self._ensure(lang_code)
        voice_id = voice.voice_id or "af_heart"
        chunks: List[np.ndarray] = []
        assert self._pipeline is not None
        for _gs, _ps, audio in self._pipeline(text, voice=voice_id):
            chunks.append(_to_mono_f32(np.asarray(audio)))
        if not chunks:
            return np.zeros(0, dtype=np.float32), TARGET_SR
        return np.concatenate(chunks), TARGET_SR

    def synthesize_batch(
        self, texts: List[str], voice: VoiceConfig
    ) -> List[tuple[np.ndarray, int]]:
        return [self.synthesize(t, voice) for t in texts]

    def unload(self) -> None:
        with self._lock:
            self._pipeline = None
        _free_gpu()


class QwenEngine(TtsEngine):
    def __init__(self, model_id: str) -> None:
        self._model_id = model_id
        self._load_path = resolve_hf_model_path(model_id)
        self._model = None
        self._lock = threading.Lock()
        self._is_design = "VoiceDesign" in model_id
        self._is_clone = is_qwen_voice_clone_model(model_id)

    def _ensure(self) -> None:
        with self._lock:
            if self._model is not None:
                return
            import torch
            from qwen_tts import Qwen3TTSModel

            suppress_hf_progress_bars()
            dtype = getattr(torch, settings.torch_dtype, torch.bfloat16)
            kwargs: dict = {
                "device_map": settings.device,
                "dtype": dtype,
            }
            try:
                kwargs["attn_implementation"] = "flash_attention_2"
                self._model = Qwen3TTSModel.from_pretrained(self._load_path, **kwargs)
            except Exception:
                kwargs.pop("attn_implementation", None)
                self._model = Qwen3TTSModel.from_pretrained(self._load_path, **kwargs)

    def _clone_kwargs(self, voice: VoiceConfig) -> dict:
        if voice.ref is None:
            raise ValueError("Qwen voice clone requires reference audio.")
        kwargs: dict = {"ref_audio": str(voice.ref.audio_path)}
        if voice.voice_clone_x_vector_only:
            kwargs["x_vector_only_mode"] = True
        elif voice.ref.text:
            kwargs["ref_text"] = voice.ref.text
        else:
            raise ValueError(
                "Reference transcript (ref_text) is required for Qwen voice clone "
                "unless x_vector_only mode is enabled."
            )
        return kwargs

    def synthesize(self, text: str, voice: VoiceConfig) -> tuple[np.ndarray, int]:
        self._ensure()
        lang = qwen_tts_language(voice.target_lang)
        assert self._model is not None
        if self._is_clone:
            wavs, sr = self._model.generate_voice_clone(
                text=text,
                language=lang,
                **self._clone_kwargs(voice),
            )
        elif self._is_design:
            instruct = voice.voice_design_instruct.strip()
            if not instruct:
                raise ValueError("Voice design instruct is required for Qwen VoiceDesign.")
            wavs, sr = self._model.generate_voice_design(
                text=text, language=lang, instruct=instruct
            )
        else:
            speaker = voice.voice_id or "Ryan"
            instruct = voice.voice_instruct.strip() or None
            wavs, sr = self._model.generate_custom_voice(
                text=text,
                language=lang,
                speaker=speaker,
                instruct=instruct,
            )
        return _to_mono_f32(np.asarray(wavs[0])), int(sr)

    def synthesize_batch(
        self, texts: List[str], voice: VoiceConfig
    ) -> List[tuple[np.ndarray, int]]:
        if not texts:
            return []
        if self._is_clone:
            return [self.synthesize(t, voice) for t in texts]
        self._ensure()
        lang = qwen_tts_language(voice.target_lang)
        assert self._model is not None
        if self._is_design:
            instruct = voice.voice_design_instruct.strip()
            if not instruct:
                raise ValueError("Voice design instruct is required for Qwen VoiceDesign.")
            wavs, sr = self._model.generate_voice_design(
                text=texts,
                language=[lang] * len(texts),
                instruct=[instruct] * len(texts),
            )
        else:
            speaker = voice.voice_id or "Ryan"
            instruct = voice.voice_instruct.strip() or None
            wavs, sr = self._model.generate_custom_voice(
                text=texts,
                language=[lang] * len(texts),
                speaker=[speaker] * len(texts),
                instruct=[instruct or ""] * len(texts),
            )
        return [(_to_mono_f32(np.asarray(w)), int(sr)) for w in wavs]

    def unload(self) -> None:
        with self._lock:
            self._model = None
        _free_gpu()


class VoxCPMEngine(TtsEngine):
    def __init__(self) -> None:
        self._model = None
        self._lock = threading.Lock()

    def _ensure(self) -> None:
        with self._lock:
            if self._model is not None:
                return
            from voxcpm import VoxCPM

            suppress_hf_progress_bars()
            self._model = VoxCPM.from_pretrained(
                resolve_hf_model_path(VOXCPM_MODEL), load_denoiser=False
            )

    def synthesize(self, text: str, voice: VoiceConfig) -> tuple[np.ndarray, int]:
        self._ensure()
        assert self._model is not None
        sr = int(self._model.tts_model.sample_rate)
        kwargs: dict = {"text": text, "cfg_value": 2.0, "inference_timesteps": 10}
        if voice.voice_mode == "preset" and voice.voice_design_instruct.strip():
            kwargs["text"] = f"({voice.voice_design_instruct.strip()}){text}"
        elif voice.ref is not None:
            ref = voice.ref
            kwargs["reference_wav_path"] = str(ref.audio_path)
            if ref.text:
                kwargs["prompt_wav_path"] = str(ref.audio_path)
                kwargs["prompt_text"] = ref.text
        wav = self._model.generate(**kwargs)
        return _to_mono_f32(np.asarray(wav)), sr

    def synthesize_batch(
        self, texts: List[str], voice: VoiceConfig
    ) -> List[tuple[np.ndarray, int]]:
        return [self.synthesize(t, voice) for t in texts]

    def unload(self) -> None:
        with self._lock:
            self._model = None
        _free_gpu()


class OmniVoiceEngine(TtsEngine):
    def __init__(self) -> None:
        self._model = None
        self._lock = threading.Lock()

    def _ensure(self) -> None:
        with self._lock:
            if self._model is not None:
                return
            import torch
            from omnivoice import OmniVoice

            suppress_hf_progress_bars()
            dtype = torch.float16
            self._model = OmniVoice.from_pretrained(
                resolve_hf_model_path(OMNIVOICE_MODEL),
                device_map=settings.device,
                dtype=dtype,
            )

    def synthesize(self, text: str, voice: VoiceConfig) -> tuple[np.ndarray, int]:
        if voice.ref is None:
            raise ValueError("OmniVoice requires a reference audio clip.")
        self._ensure()
        assert self._model is not None
        audio = self._model.generate(
            text=text,
            ref_audio=str(voice.ref.audio_path),
            ref_text=voice.ref.text,
        )
        arr = _to_mono_f32(np.asarray(audio[0] if isinstance(audio, list) else audio))
        return arr, TARGET_SR

    def synthesize_batch(
        self, texts: List[str], voice: VoiceConfig
    ) -> List[tuple[np.ndarray, int]]:
        return [self.synthesize(t, voice) for t in texts]

    def unload(self) -> None:
        with self._lock:
            self._model = None
        _free_gpu()


class HiggsEngine(TtsEngine):
    def synthesize(self, text: str, voice: VoiceConfig) -> tuple[np.ndarray, int]:
        import httpx

        base = voice.higgs_server_url.rstrip("/")
        payload: dict = {"input": text}
        if voice.ref is not None:
            payload["references"] = [
                {
                    "audio_path": str(voice.ref.audio_path),
                    "text": voice.ref.text,
                }
            ]
        with httpx.Client(timeout=300.0) as client:
            resp = client.post(f"{base}/v1/audio/speech", json=payload)
            resp.raise_for_status()
        import io
        import soundfile as sf

        data, sr = sf.read(io.BytesIO(resp.content), dtype="float32")
        return _to_mono_f32(data), int(sr)

    def synthesize_batch(
        self, texts: List[str], voice: VoiceConfig
    ) -> List[tuple[np.ndarray, int]]:
        return [self.synthesize(t, voice) for t in texts]

    def unload(self) -> None:
        pass


def _free_gpu() -> None:
    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


_ENGINE: Optional[TtsEngine] = None
_ENGINE_KEY: Optional[str] = None
_ENGINE_LOCK = threading.Lock()


def get_tts_engine(backend: str, model: str) -> TtsEngine:
    if settings.mock_models:
        return MockTtsEngine()
    key = f"{backend}:{model}"
    with _ENGINE_LOCK:
        global _ENGINE, _ENGINE_KEY
        if _ENGINE is not None and _ENGINE_KEY == key:
            return _ENGINE
        if _ENGINE is not None:
            _ENGINE.unload()
        if backend == "kokoro":
            _ENGINE = KokoroEngine()
        elif backend == "qwen":
            _ENGINE = QwenEngine(model)
        elif backend == "voxcpm":
            _ENGINE = VoxCPMEngine()
        elif backend == "omnivoice":
            _ENGINE = OmniVoiceEngine()
        elif backend == "higgs":
            _ENGINE = HiggsEngine()
        else:
            raise ValueError(f"Unknown TTS backend: {backend}")
        _ENGINE_KEY = key
        return _ENGINE


def unload_tts() -> None:
    global _ENGINE, _ENGINE_KEY
    with _ENGINE_LOCK:
        if _ENGINE is not None:
            _ENGINE.unload()
            _ENGINE = None
            _ENGINE_KEY = None


def build_voice_config(cfg, ref: Optional[VoiceReference]) -> VoiceConfig:
    return VoiceConfig(
        backend=cfg.tts_backend,
        model=cfg.tts_model,
        voice_mode=cfg.voice_mode,
        voice_id=cfg.voice_id,
        voice_design_instruct=cfg.voice_design_instruct,
        voice_instruct=cfg.voice_instruct,
        ref=ref,
        higgs_server_url=cfg.higgs_server_url,
        target_lang=cfg.target_lang,
        voice_clone_x_vector_only=cfg.voice_clone_x_vector_only,
    )
