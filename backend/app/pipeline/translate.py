"""Pluggable translation backends.

Default: Helsinki-NLP opus-mt models (one model per direction).
Optional: Hunyuan, TranslateGemma, and NLLB-200.

All backends are cached per direction and loaded lazily.
"""
from __future__ import annotations

import threading
from abc import ABC, abstractmethod
from typing import Dict, List

from ..config import language_name, settings
from ..logging_config import suppress_hf_progress_bars
from ..model_paths import resolve_hf_model_path

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


# NLLB-200 FLORES-200 language codes.
NLLB_LANG_CODES: dict[str, str] = {
    "en": "eng_Latn",
    "de": "deu_Latn",
    "fr": "fra_Latn",
    "es": "spa_Latn",
    "it": "ita_Latn",
    "nl": "nld_Latn",
    "pt": "por_Latn",
    "pl": "pol_Latn",
    "ru": "rus_Cyrl",
    "tr": "tur_Latn",
    "ar": "arb_Arab",
    "zh": "zho_Hans",
    "ja": "jpn_Jpan",
    "ko": "kor_Hang",
    "sv": "swe_Latn",
    "da": "dan_Latn",
    "no": "nob_Latn",
    "nb": "nob_Latn",
    "nn": "nno_Latn",
    "fi": "fin_Latn",
    "cs": "ces_Latn",
    "uk": "ukr_Cyrl",
    "vi": "vie_Latn",
    "hi": "hin_Deva",
    "bg": "bul_Cyrl",
    "hr": "hrv_Latn",
    "sk": "slk_Latn",
    "hu": "hun_Latn",
    "ro": "ron_Latn",
    "et": "est_Latn",
    "he": "heb_Hebr",
    "th": "tha_Thai",
    "el": "ell_Grek",
    "lt": "lit_Latn",
    "lv": "lvs_Latn",
    "sl": "slv_Latn",
}


def nllb_lang_code(iso: str) -> str:
    return NLLB_LANG_CODES.get(iso.lower(), iso)


def _chunks(items: List[str], size: int):
    size = max(1, size)
    for i in range(0, len(items), size):
        yield items[i : i + size]


class Translator(ABC):
    @abstractmethod
    def translate(self, texts: List[str], src: str, tgt: str, batch_size: int = 16) -> List[str]:
        """Translate a batch of strings from src to tgt (ISO codes)."""


class MockTranslator(Translator):
    def translate(self, texts: List[str], src: str, tgt: str, batch_size: int = 16) -> List[str]:
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

            suppress_hf_progress_bars()
            from ..helsinki_models import resolve_helsinki_repo

            model = resolve_helsinki_repo(src, tgt)
            device = 0 if settings.device.startswith("cuda") else -1
            self._pipes[key] = pipeline("translation", model=model, device=device)
            return self._pipes[key]

    def translate(self, texts: List[str], src: str, tgt: str, batch_size: int = 16) -> List[str]:
        if not texts:
            return []
        pipe = self._pipe(src, tgt)
        outputs = pipe(texts, batch_size=max(1, batch_size), truncation=True)
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

    def translate(self, texts: List[str], src: str, tgt: str, batch_size: int = 16) -> List[str]:
        if not texts:
            return []
        self._ensure()
        results: List[str] = []
        for chunk in _chunks(texts, batch_size):
            messages = [self._build_messages(text, src, tgt) for text in chunk]
            outputs = self._pipe(text=messages, max_new_tokens=512, batch_size=len(messages))
            for output in outputs:
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

            suppress_hf_progress_bars()
            dtype = getattr(torch, settings.torch_dtype, torch.bfloat16)
            model_path = resolve_hf_model_path(self.model_path)
            self._tokenizer = AutoTokenizer.from_pretrained(
                model_path, trust_remote_code=True
            )
            # Decoder-only models require left padding for correct batched generation.
            self._tokenizer.padding_side = "left"
            if self._tokenizer.pad_token_id is None:
                self._tokenizer.pad_token = self._tokenizer.eos_token
            self._model = AutoModelForCausalLM.from_pretrained(
                model_path,
                dtype=dtype,
                device_map="auto",
                trust_remote_code=True,
            ).eval()

    def _prompt(self, text: str, src: str, tgt: str) -> str:
        return (
            f"Translate the following text from {language_name(src)} to "
            f"{language_name(tgt)}. Output only the translation, no explanations:\n\n{text}"
        )

    def translate(self, texts: List[str], src: str, tgt: str, batch_size: int = 16) -> List[str]:
        if not texts:
            return []
        import torch

        self._ensure()
        results: List[str] = []
        for chunk in _chunks(texts, batch_size):
            prompts = [
                self._tokenizer.apply_chat_template(
                    [{"role": "user", "content": self._prompt(text, src, tgt)}],
                    add_generation_prompt=True,
                    tokenize=False,
                )
                for text in chunk
            ]
            inputs = self._tokenizer(
                prompts, return_tensors="pt", padding=True, add_special_tokens=False
            ).to(self._model.device)
            inputs.pop("token_type_ids", None)
            with torch.no_grad():
                out = self._model.generate(**inputs, max_new_tokens=512)
            gen = out[:, inputs["input_ids"].shape[-1] :]
            decoded = self._tokenizer.batch_decode(gen, skip_special_tokens=True)
            results.extend(d.strip() for d in decoded)
        return results


class HunyuanTranslator(Translator):
    """Tencent Hunyuan MT models (HY-MT1.5 / Hy-MT2)."""

    def __init__(self, model_path: str = "tencent/HY-MT1.5-1.8B") -> None:
        if "GGUF" in model_path.upper():
            raise ValueError(
                f"{model_path} is a GGUF checkpoint for llama.cpp and cannot be loaded "
                "with transformers. Choose a safetensors model (e.g. Hy-MT2-1.8B or Hy-MT2-7B)."
            )
        self.model_path = resolve_hf_model_path(model_path)
        self._model = None
        self._tokenizer = None
        self._lock = threading.Lock()

    def _ensure(self) -> None:
        if self._model is not None:
            return
        with self._lock:
            if self._model is not None:
                return
            import torch
            from transformers import AutoModelForCausalLM, AutoTokenizer

            suppress_hf_progress_bars()
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
        tgt_name = language_name(tgt) or tgt
        src_l, tgt_l = src.lower(), tgt.lower()
        if "zh" in src_l or "zh" in tgt_l:
            return (
                f"将以下文本翻译为{tgt_name}，注意只需要输出翻译后的结果，不要额外解释：\n\n{text}"
            )
        return (
            f"Translate the following text into {tgt_name}. "
            f"Note that you should only output the translated result without any "
            f"additional explanation:\n\n{text}"
        )

    def _is_hy_mt2(self) -> bool:
        return "Hy-MT2" in self.model_path

    def _add_generation_prompt(self) -> bool:
        # HY-MT1.5: no generation prompt; Hy-MT2: add_generation_prompt=True
        return self._is_hy_mt2()

    def _gen_kwargs(self) -> dict:
        if self._is_hy_mt2() or "HY-MT1.5" in self.model_path or "Hy-MT1.5" in self.model_path:
            return {
                "max_new_tokens": 512,
                "do_sample": True,
                "top_k": 20,
                "top_p": 0.6,
                "repetition_penalty": 1.05,
                "temperature": 0.7,
            }
        return {"max_new_tokens": 512}

    def _encode_messages(self, messages: list[dict[str, str]]) -> tuple[dict, int]:
        import torch

        encoded = self._tokenizer.apply_chat_template(
            messages,
            tokenize=True,
            add_generation_prompt=self._add_generation_prompt(),
            return_tensors="pt",
        )
        if isinstance(encoded, torch.Tensor):
            inputs = {"input_ids": encoded.to(self._model.device)}
        else:
            inputs = {k: v.to(self._model.device) for k, v in encoded.items()}
            inputs.pop("token_type_ids", None)
        input_len = inputs["input_ids"].shape[-1]
        return inputs, input_len

    def translate(self, texts: List[str], src: str, tgt: str, batch_size: int = 16) -> List[str]:
        if not texts:
            return []
        import torch

        self._ensure()
        gen_kwargs = self._gen_kwargs()
        results: List[str] = []
        for chunk in _chunks(texts, batch_size):
            for text in chunk:
                messages = [{"role": "user", "content": self._prompt(text, src, tgt)}]
                inputs, input_len = self._encode_messages(messages)
                with torch.no_grad():
                    out = self._model.generate(**inputs, **gen_kwargs)
                gen = out[:, input_len:]
                decoded = self._tokenizer.batch_decode(gen, skip_special_tokens=True)
                results.append(decoded[0].strip())
        return results


class NllbTranslator(Translator):
    """Uses facebook/nllb-200 models via AutoModelForSeq2SeqLM."""

    def __init__(self, model_path: str) -> None:
        self.model_path = resolve_hf_model_path(model_path)
        self._model = None
        self._tokenizer = None
        self._lock = threading.Lock()

    def _ensure(self) -> None:
        if self._model is not None:
            return
        with self._lock:
            if self._model is not None:
                return
            import torch
            from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

            suppress_hf_progress_bars()
            dtype = getattr(torch, settings.torch_dtype, torch.bfloat16)
            self._tokenizer = AutoTokenizer.from_pretrained(self.model_path)
            self._model = AutoModelForSeq2SeqLM.from_pretrained(
                self.model_path,
                dtype=dtype,
                device_map="auto",
            ).eval()

    def translate(self, texts: List[str], src: str, tgt: str, batch_size: int = 16) -> List[str]:
        if not texts:
            return []
        import torch

        self._ensure()
        src_code = nllb_lang_code(src)
        tgt_code = nllb_lang_code(tgt)
        tgt_token_id = self._tokenizer.convert_tokens_to_ids(tgt_code)
        if tgt_token_id is None or tgt_token_id == self._tokenizer.unk_token_id:
            lang_map = getattr(self._tokenizer, "lang_code_to_id", None)
            if lang_map and tgt_code in lang_map:
                tgt_token_id = lang_map[tgt_code]
        if tgt_token_id is None:
            raise ValueError(f"NLLB does not support target language: {tgt}")

        results: List[str] = []
        for chunk in _chunks(texts, batch_size):
            self._tokenizer.src_lang = src_code
            inputs = self._tokenizer(
                chunk, return_tensors="pt", padding=True, truncation=True, max_length=512
            ).to(self._model.device)
            with torch.no_grad():
                out = self._model.generate(
                    **inputs,
                    forced_bos_token_id=tgt_token_id,
                    max_length=512,
                )
            decoded = self._tokenizer.batch_decode(out, skip_special_tokens=True)
            results.extend(d.strip() for d in decoded)
        return results


_INSTANCES: Dict[str, Translator] = {}
_INSTANCES_LOCK = threading.Lock()


def get_translator(
    backend: str,
    nllb_model: str = "facebook/nllb-200-distilled-600M",
    hunyuan_model: str = "tencent/HY-MT1.5-1.8B",
) -> Translator:
    if settings.mock_models:
        return MockTranslator()
    if backend == "nllb":
        cache_key = f"nllb:{nllb_model}"
    elif backend == "hunyuan":
        cache_key = f"hunyuan:{hunyuan_model}"
    else:
        cache_key = backend
    with _INSTANCES_LOCK:
        if cache_key not in _INSTANCES:
            if backend == "helsinki":
                _INSTANCES[cache_key] = HelsinkiTranslator()
            elif backend == "hunyuan":
                _INSTANCES[cache_key] = HunyuanTranslator(hunyuan_model)
            elif backend == "translategemma":
                _INSTANCES[cache_key] = TranslateGemmaTranslator()
            elif backend == "nllb":
                _INSTANCES[cache_key] = NllbTranslator(nllb_model)
            else:
                raise ValueError(f"Unknown translator backend: {backend}")
        return _INSTANCES[cache_key]


def unload() -> None:
    """Release cached translator models from GPU memory."""
    import gc

    with _INSTANCES_LOCK:
        for inst in _INSTANCES.values():
            model = getattr(inst, "_model", None)
            if model is not None:
                del inst._model
                inst._model = None
            tok = getattr(inst, "_tokenizer", None)
            if tok is not None:
                del inst._tokenizer
                inst._tokenizer = None
        _INSTANCES.clear()
    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass
