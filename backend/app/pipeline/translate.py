"""Pluggable translation backends.

Default: Helsinki-NLP opus-mt models (one model per direction).
Optional: Hunyuan (tencent/Hy-MT2-1.8B) and TranslateGemma (google/translategemma-4b-it).

All backends are cached per direction and loaded lazily.
"""
from __future__ import annotations

import threading
from abc import ABC, abstractmethod
from typing import Dict, List

from ..config import language_name, settings

# TranslateGemma uses regional codes for some languages (e.g. de-DE, en-US).
TRANSLATEGEMMA_LANG_CODES: dict[str, str] = {
    "en": "en-US",
    "de": "de-DE",
    "pt": "pt-BR",
    "zh": "zh-CN",
    "ja": "ja-JP",
    "ko": "ko-KR",
    "fr": "fr-FR",
    "es": "es-ES",
    "it": "it-IT",
    "nl": "nl-NL",
    "pl": "pl-PL",
    "ru": "ru-RU",
    "tr": "tr-TR",
    "ar": "ar-SA",
    "sv": "sv",
    "da": "da",
    "no": "no",
    "fi": "fi",
    "cs": "cs",
}


def translategemma_lang_code(iso: str) -> str:
    code = iso.lower()
    return TRANSLATEGEMMA_LANG_CODES.get(code, code)


class Translator(ABC):
    @abstractmethod
    def translate(self, texts: List[str], src: str, tgt: str) -> List[str]:
        """Translate a batch of strings from src to tgt (ISO codes)."""


class MockTranslator(Translator):
    def translate(self, texts: List[str], src: str, tgt: str) -> List[str]:
        return [f"[{src}->{tgt}] {t}" for t in texts]


class HelsinkiTranslator(Translator):
    """Uses Helsinki-NLP/opus-mt-{src}-{tgt} via transformers pipelines."""

    def __init__(self) -> None:
        self._pipes: Dict[str, object] = {}
        self._lock = threading.Lock()

    def _pipe(self, src: str, tgt: str):
        key = f"{src}-{tgt}"
        if key in self._pipes:
            return self._pipes[key]
        with self._lock:
            if key in self._pipes:
                return self._pipes[key]
            from transformers import pipeline

            model = f"Helsinki-NLP/opus-mt-{src}-{tgt}"
            device = 0 if settings.device.startswith("cuda") else -1
            self._pipes[key] = pipeline("translation", model=model, device=device)
            return self._pipes[key]

    def translate(self, texts: List[str], src: str, tgt: str) -> List[str]:
        if not texts:
            return []
        pipe = self._pipe(src, tgt)
        outputs = pipe(texts, batch_size=16, truncation=True)
        return [o["translation_text"] for o in outputs]


class TranslateGemmaTranslator(Translator):
    """Uses google/translategemma-4b-it via the image-text-to-text pipeline."""

    MODEL = "google/translategemma-4b-it"

    def __init__(self) -> None:
        self._pipe = None
        self._lock = threading.Lock()

    def _ensure(self) -> None:
        if self._pipe is not None:
            return
        with self._lock:
            if self._pipe is not None:
                return
            import torch
            from transformers import pipeline

            device = "cuda" if settings.device.startswith("cuda") else "cpu"
            dtype = getattr(torch, settings.torch_dtype, torch.bfloat16)
            self._pipe = pipeline(
                "image-text-to-text",
                model=self.MODEL,
                device=device,
                dtype=dtype,
            )

    def _build_messages(self, text: str, src: str, tgt: str) -> list:
        return [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "source_lang_code": translategemma_lang_code(src),
                        "target_lang_code": translategemma_lang_code(tgt),
                        "text": text,
                    }
                ],
            }
        ]

    def translate(self, texts: List[str], src: str, tgt: str) -> List[str]:
        if not texts:
            return []
        self._ensure()
        results: List[str] = []
        for text in texts:
            output = self._pipe(text=self._build_messages(text, src, tgt), max_new_tokens=512)
            content = output[0]["generated_text"][-1]["content"]
            results.append(str(content).strip())
        return results


class _CausalLMTranslator(Translator):
    """Shared logic for instruction-tuned causal-LM translators."""

    model_path: str = ""

    def __init__(self) -> None:
        self._model = None
        self._tokenizer = None
        self._lock = threading.Lock()

    def _ensure(self):
        if self._model is not None:
            return
        with self._lock:
            if self._model is not None:
                return
            import torch
            from transformers import AutoModelForCausalLM, AutoTokenizer

            dtype = getattr(torch, settings.torch_dtype, torch.bfloat16)
            self._tokenizer = AutoTokenizer.from_pretrained(
                self.model_path, trust_remote_code=True
            )
            self._model = AutoModelForCausalLM.from_pretrained(
                self.model_path,
                dtype=dtype,
                device_map="auto",
                trust_remote_code=True,
            ).eval()

    def _prompt(self, text: str, src: str, tgt: str) -> str:
        return (
            f"Translate the following text from {language_name(src)} to "
            f"{language_name(tgt)}. Output only the translation, no explanations:\n\n{text}"
        )

    def translate(self, texts: List[str], src: str, tgt: str) -> List[str]:
        if not texts:
            return []
        import torch

        self._ensure()
        results: List[str] = []
        for text in texts:
            messages = [{"role": "user", "content": self._prompt(text, src, tgt)}]
            inputs = self._tokenizer.apply_chat_template(
                messages, add_generation_prompt=True, return_tensors="pt"
            ).to(self._model.device)
            with torch.no_grad():
                out = self._model.generate(inputs, max_new_tokens=512)
            decoded = self._tokenizer.decode(
                out[0][inputs.shape[-1] :], skip_special_tokens=True
            )
            results.append(decoded.strip())
        return results


class HunyuanTranslator(_CausalLMTranslator):
    model_path = "tencent/Hy-MT2-1.8B"


_INSTANCES: Dict[str, Translator] = {}
_INSTANCES_LOCK = threading.Lock()


def get_translator(backend: str) -> Translator:
    if settings.mock_models:
        return MockTranslator()
    with _INSTANCES_LOCK:
        if backend not in _INSTANCES:
            if backend == "helsinki":
                _INSTANCES[backend] = HelsinkiTranslator()
            elif backend == "hunyuan":
                _INSTANCES[backend] = HunyuanTranslator()
            elif backend == "translategemma":
                _INSTANCES[backend] = TranslateGemmaTranslator()
            else:
                raise ValueError(f"Unknown translator backend: {backend}")
        return _INSTANCES[backend]
