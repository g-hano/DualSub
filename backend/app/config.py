"""Configuration models and global settings for the PolyVoice pipeline."""
from __future__ import annotations

from pathlib import Path
from typing import Literal, Optional

from pydantic import AliasChoices, BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


# Map ISO-639-1 codes to the full language names Qwen3-ASR expects.
LANGUAGE_NAMES: dict[str, str] = {
    "sv": "Swedish",
    "en": "English",
    "de": "German",
    "fr": "French",
    "es": "Spanish",
    "it": "Italian",
    "nl": "Dutch",
    "da": "Danish",
    "no": "Norwegian",
    "fi": "Finnish",
    "pt": "Portuguese",
    "pl": "Polish",
    "ru": "Russian",
    "tr": "Turkish",
    "ar": "Arabic",
    "zh": "Chinese",
    "ja": "Japanese",
    "ko": "Korean",
    "cs": "Czech",
    "uk": "Ukrainian",
    "vi": "Vietnamese",
    "hi": "Hindi",
    "bg": "Bulgarian",
    "hr": "Croatian",
    "sk": "Slovak",
    "hu": "Hungarian",
    "ro": "Romanian",
    "et": "Estonian",
    "he": "Hebrew",
    "th": "Thai",
    "el": "Greek",
    "lt": "Lithuanian",
    "lv": "Latvian",
    "sl": "Slovenian",
    "nb": "Norwegian Bokmål",
    "nn": "Norwegian Nynorsk",
}


def language_name(code: str) -> Optional[str]:
    """Return the full language name for an ISO code, or None for auto-detect."""
    if not code or code.lower() in ("auto", ""):
        return None
    return LANGUAGE_NAMES.get(code.lower(), code)


# Qwen3 ASR / forced-aligner variants exposed in the UI and download manager.
ASR_MODELS: list[dict[str, str]] = [
    {"repo_id": "Qwen/Qwen3-ASR-1.7B", "label": "Qwen3 ASR 1.7B"},
    {"repo_id": "Qwen/Qwen3-ASR-0.6B", "label": "Qwen3 ASR 0.6B"},
    {"repo_id": "Qwen/Qwen3-ASR-1.7B-hf", "label": "Qwen3 ASR 1.7B (HF weights)"},
    {"repo_id": "Qwen/Qwen3-ASR-0.6B-hf", "label": "Qwen3 ASR 0.6B (HF weights)"},
]

FORCED_ALIGNER_MODELS: list[dict[str, str]] = [
    {"repo_id": "Qwen/Qwen3-ForcedAligner-0.6B", "label": "Qwen3 Forced Aligner 0.6B"},
    {"repo_id": "Qwen/Qwen3-ForcedAligner-0.6B-hf", "label": "Qwen3 Forced Aligner 0.6B (HF weights)"},
]

WHISPER_MODELS: list[dict[str, str]] = [
    {"repo_id": "openai/whisper-small", "label": "Whisper Small"},
    {"repo_id": "openai/whisper-medium", "label": "Whisper Medium"},
    {"repo_id": "openai/whisper-large-v3", "label": "Whisper Large v3"},
    {"repo_id": "openai/whisper-large-v3-turbo", "label": "Whisper Large v3 Turbo"},
]

NEMOTRON_MODELS: list[dict[str, str]] = [
    {
        "repo_id": "nvidia/nemotron-3.5-asr-streaming-0.6b",
        "label": "Nemotron 3.5 ASR Streaming 0.6B",
    },
]

# Nemotron locale tiers (40 language-locales).
NEMOTRON_LOCALES: list[dict[str, str]] = [
    # Transcription-ready (19 locales)
    {"locale": "en-US", "label": "English (US)", "tier": "ready"},
    {"locale": "en-GB", "label": "English (UK)", "tier": "ready"},
    {"locale": "es-US", "label": "Spanish (US)", "tier": "ready"},
    {"locale": "es-ES", "label": "Spanish (Spain)", "tier": "ready"},
    {"locale": "fr-FR", "label": "French (France)", "tier": "ready"},
    {"locale": "fr-CA", "label": "French (Canada)", "tier": "ready"},
    {"locale": "it-IT", "label": "Italian", "tier": "ready"},
    {"locale": "pt-BR", "label": "Portuguese (Brazil)", "tier": "ready"},
    {"locale": "pt-PT", "label": "Portuguese (Portugal)", "tier": "ready"},
    {"locale": "nl-NL", "label": "Dutch", "tier": "ready"},
    {"locale": "de-DE", "label": "German", "tier": "ready"},
    {"locale": "tr-TR", "label": "Turkish", "tier": "ready"},
    {"locale": "ru-RU", "label": "Russian", "tier": "ready"},
    {"locale": "ar-AR", "label": "Arabic", "tier": "ready"},
    {"locale": "hi-IN", "label": "Hindi", "tier": "ready"},
    {"locale": "ja-JP", "label": "Japanese", "tier": "ready"},
    {"locale": "ko-KR", "label": "Korean", "tier": "ready"},
    {"locale": "vi-VN", "label": "Vietnamese", "tier": "ready"},
    {"locale": "uk-UA", "label": "Ukrainian", "tier": "ready"},
    # Broad-coverage (13 locales)
    {"locale": "pl-PL", "label": "Polish", "tier": "broad"},
    {"locale": "sv-SE", "label": "Swedish", "tier": "broad"},
    {"locale": "cs-CZ", "label": "Czech", "tier": "broad"},
    {"locale": "nb-NO", "label": "Norwegian Bokmål", "tier": "broad"},
    {"locale": "da-DK", "label": "Danish", "tier": "broad"},
    {"locale": "bg-BG", "label": "Bulgarian", "tier": "broad"},
    {"locale": "fi-FI", "label": "Finnish", "tier": "broad"},
    {"locale": "hr-HR", "label": "Croatian", "tier": "broad"},
    {"locale": "sk-SK", "label": "Slovak", "tier": "broad"},
    {"locale": "zh-CN", "label": "Mandarin Chinese", "tier": "broad"},
    {"locale": "hu-HU", "label": "Hungarian", "tier": "broad"},
    {"locale": "ro-RO", "label": "Romanian", "tier": "broad"},
    {"locale": "et-EE", "label": "Estonian", "tier": "broad"},
    # Adaptation-ready (8 locales)
    {"locale": "el-GR", "label": "Greek", "tier": "adaptation"},
    {"locale": "lt-LT", "label": "Lithuanian", "tier": "adaptation"},
    {"locale": "lv-LV", "label": "Latvian", "tier": "adaptation"},
    {"locale": "mt-MT", "label": "Maltese", "tier": "adaptation"},
    {"locale": "sl-SI", "label": "Slovenian", "tier": "adaptation"},
    {"locale": "he-IL", "label": "Hebrew", "tier": "adaptation"},
    {"locale": "th-TH", "label": "Thai", "tier": "adaptation"},
    {"locale": "nn-NO", "label": "Norwegian Nynorsk", "tier": "adaptation"},
]

ISO_TO_NEMOTRON_LOCALE: dict[str, str] = {
    "en": "en-US",
    "es": "es-ES",
    "fr": "fr-FR",
    "it": "it-IT",
    "pt": "pt-PT",
    "nl": "nl-NL",
    "de": "de-DE",
    "tr": "tr-TR",
    "ru": "ru-RU",
    "ar": "ar-AR",
    "hi": "hi-IN",
    "ja": "ja-JP",
    "ko": "ko-KR",
    "vi": "vi-VN",
    "uk": "uk-UA",
    "pl": "pl-PL",
    "sv": "sv-SE",
    "cs": "cs-CZ",
    "no": "nb-NO",
    "nb": "nb-NO",
    "da": "da-DK",
    "bg": "bg-BG",
    "fi": "fi-FI",
    "hr": "hr-HR",
    "sk": "sk-SK",
    "zh": "zh-CN",
    "hu": "hu-HU",
    "ro": "ro-RO",
    "et": "et-EE",
    "el": "el-GR",
    "lt": "lt-LT",
    "lv": "lv-LV",
    "sl": "sl-SI",
    "he": "he-IL",
    "th": "th-TH",
    "nn": "nn-NO",
}


def nemotron_locale(source_lang: str) -> str:
    """Map ISO spoken language to Nemotron locale (e.g. sv → sv-SE)."""
    if not source_lang or source_lang.lower() == "auto":
        return "auto"
    return ISO_TO_NEMOTRON_LOCALE.get(source_lang.lower(), source_lang)


def nemotron_tier(source_lang: str) -> str | None:
    """Return Nemotron support tier for a spoken ISO code, if known."""
    locale = nemotron_locale(source_lang)
    for entry in NEMOTRON_LOCALES:
        if entry["locale"] == locale:
            return entry["tier"]
    return None


HUNYUAN_MODELS: list[dict[str, str]] = [
    {"repo_id": "tencent/HY-MT1.5-1.8B", "label": "HY-MT1.5-1.8B (fast, recommended)"},
    {"repo_id": "tencent/HY-MT1.5-1.8B-FP8", "label": "HY-MT1.5-1.8B FP8"},
    {"repo_id": "tencent/HY-MT1.5-1.8B-GPTQ-Int4", "label": "HY-MT1.5-1.8B GPTQ Int4"},
    {"repo_id": "tencent/HY-MT1.5-7B", "label": "HY-MT1.5-7B"},
    {"repo_id": "tencent/HY-MT1.5-7B-FP8", "label": "HY-MT1.5-7B FP8"},
    {"repo_id": "tencent/HY-MT1.5-7B-GPTQ-Int4", "label": "HY-MT1.5-7B GPTQ Int4"},
    {"repo_id": "tencent/Hy-MT2-1.8B", "label": "Hy-MT2-1.8B (recommended Hy-MT2)"},
    {"repo_id": "tencent/Hy-MT2-1.8B-FP8", "label": "Hy-MT2-1.8B FP8"},
    {"repo_id": "tencent/Hy-MT2-7B", "label": "Hy-MT2-7B"},
    {"repo_id": "tencent/Hy-MT2-7B-FP8", "label": "Hy-MT2-7B FP8"},
]

NLLB_MODELS: list[dict[str, str]] = [
    {
        "repo_id": "facebook/nllb-200-distilled-600M",
        "label": "NLLB 600M Distilled (fast, recommended)",
    },
    {"repo_id": "facebook/nllb-200-1.3B", "label": "NLLB 1.3B"},
    {"repo_id": "facebook/nllb-200-distilled-1.3B", "label": "NLLB 1.3B Distilled"},
    {"repo_id": "facebook/nllb-200-3.3B", "label": "NLLB 3.3B (best quality, heavy VRAM)"},
]

# Qwen3-TTS (shared tokenizer + synthesis models).
QWEN_TTS_TOKENIZER = "Qwen/Qwen3-TTS-Tokenizer-12Hz"

QWEN_TTS_MODELS: list[dict[str, str]] = [
    {
        "repo_id": "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
        "label": "Qwen3 TTS 1.7B CustomVoice",
        "kind": "custom_voice",
    },
    {
        "repo_id": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
        "label": "Qwen3 TTS 0.6B CustomVoice",
        "kind": "custom_voice",
    },
    {
        "repo_id": "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign",
        "label": "Qwen3 TTS 1.7B VoiceDesign",
        "kind": "voice_design",
    },
    {
        "repo_id": "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
        "label": "Qwen3 TTS 1.7B Base (voice clone)",
        "kind": "voice_clone",
    },
    {
        "repo_id": "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
        "label": "Qwen3 TTS 0.6B Base (voice clone)",
        "kind": "voice_clone",
    },
]

QWEN_TTS_SPEAKERS: list[dict[str, str]] = [
    {"id": "Vivian", "label": "Vivian (Chinese, bright female)"},
    {"id": "Serena", "label": "Serena (Chinese, warm female)"},
    {"id": "Uncle_Fu", "label": "Uncle Fu (Chinese, mellow male)"},
    {"id": "Dylan", "label": "Dylan (Beijing dialect male)"},
    {"id": "Eric", "label": "Eric (Sichuan dialect male)"},
    {"id": "Ryan", "label": "Ryan (English, dynamic male)"},
    {"id": "Aiden", "label": "Aiden (English, sunny male)"},
    {"id": "Ono_Anna", "label": "Ono Anna (Japanese, playful female)"},
    {"id": "Sohee", "label": "Sohee (Korean, warm female)"},
]

# ISO target lang → Kokoro pipeline lang_code (misaki).
KOKORO_LANG_CODES: dict[str, str] = {
    "en": "a",
    "ja": "j",
    "zh": "z",
    "es": "e",
    "fr": "f",
    "hi": "h",
    "it": "i",
    "pt": "p",
}

KOKORO_VOICES: list[dict[str, str]] = [
    {"id": "af_heart", "label": "af_heart (American English, female)"},
    {"id": "af_bella", "label": "af_bella (American English, female)"},
    {"id": "af_nicole", "label": "af_nicole (American English, female)"},
    {"id": "af_sarah", "label": "af_sarah (American English, female)"},
    {"id": "am_michael", "label": "am_michael (American English, male)"},
    {"id": "am_fenrir", "label": "am_fenrir (American English, male)"},
    {"id": "bf_emma", "label": "bf_emma (British English, female)"},
    {"id": "bm_george", "label": "bm_george (British English, male)"},
    {"id": "jf_alpha", "label": "jf_alpha (Japanese, female)"},
    {"id": "jm_kumo", "label": "jm_kumo (Japanese, male)"},
    {"id": "zf_xiaoxiao", "label": "zf_xiaoxiao (Mandarin, female)"},
    {"id": "zm_yunxi", "label": "zm_yunxi (Mandarin, male)"},
    {"id": "ef_dora", "label": "ef_dora (Spanish, female)"},
    {"id": "em_alex", "label": "em_alex (Spanish, male)"},
    {"id": "ff_siwis", "label": "ff_siwis (French, female)"},
    {"id": "if_sara", "label": "if_sara (Italian, female)"},
    {"id": "pf_dora", "label": "pf_dora (Portuguese, female)"},
]

VOXCPM_MODEL = "openbmb/VoxCPM2"
OMNIVOICE_MODEL = "k2-fsa/OmniVoice"

# Qwen3-TTS supported synthesis languages (full names for the API).
QWEN_TTS_LANGUAGE_NAMES: dict[str, str] = {
    "zh": "Chinese",
    "en": "English",
    "ja": "Japanese",
    "ko": "Korean",
    "de": "German",
    "fr": "French",
    "ru": "Russian",
    "pt": "Portuguese",
    "es": "Spanish",
    "it": "Italian",
}


def qwen_tts_language(iso: str) -> str:
    """Map ISO code to Qwen3-TTS language name."""
    if not iso:
        return "Auto"
    return QWEN_TTS_LANGUAGE_NAMES.get(iso.lower(), language_name(iso) or iso)


def is_qwen_voice_clone_model(model_id: str) -> bool:
    """True for Qwen3-TTS Base models that use generate_voice_clone."""
    return "-Base" in model_id


SUBTITLE_FONT_FAMILIES: list[str] = [
    "Arial",
    "Verdana",
    "Tahoma",
    "Georgia",
    "Times New Roman",
    "Courier New",
    "Segoe UI",
    "Trebuchet MS",
]


class TrackStyle(BaseModel):
    font_family: str = "Arial"
    font_size: int = Field(14, ge=12, le=48)
    color: str = "#FFFFFF"
    bold: bool = True
    italic: bool = False
    karaoke_active_color: str = "#FFD24A"
    karaoke_done_color: str = "#B9C6FF"
    background_opacity: float = Field(0.25, ge=0.0, le=1.0)


class SubtitleStyleConfig(BaseModel):
    source: TrackStyle = Field(default_factory=lambda: TrackStyle(
        color="#FFFFFF", bold=True, italic=False, background_opacity=0.25
    ))
    target: TrackStyle = Field(default_factory=lambda: TrackStyle(
        color="#A7F3D0", bold=False, italic=True, background_opacity=0.25
    ))


class PipelineConfig(BaseModel):
    """Per-job configuration controlling the transcription/translation pipeline."""

    source_lang: str = Field("sv", description="ISO code of the spoken language")
    target_lang: str = Field("en", description="ISO code of the translation language")

    asr_engine: Literal["qwen", "whisper", "nemotron"] = "qwen"
    asr_model: str = "Qwen/Qwen3-ASR-1.7B"
    forced_aligner_model: str = "Qwen/Qwen3-ForcedAligner-0.6B"
    whisper_model: str = "openai/whisper-large-v3"
    nemotron_model: str = "nvidia/nemotron-3.5-asr-streaming-0.6b"

    translator_backend: Literal["helsinki", "hunyuan", "translategemma", "nllb"] = "helsinki"
    nllb_model: str = "facebook/nllb-200-distilled-600M"
    hunyuan_model: str = "tencent/HY-MT1.5-1.8B"
    translate_batch_size: int = Field(16, ge=1, le=128, description="Cues per translation batch")

    qc_enabled: bool = False
    llm_provider: Literal["lmstudio", "ollama", "llamacpp"] = "lmstudio"
    llm_base_url: str = "http://localhost:1234/v1"
    llm_model: str = "local-model"
    lmstudio_url: str = "http://localhost:1234/v1"
    lmstudio_model: str = "local-model"
    qc_batch_size: int = Field(8, ge=1, le=32, description="Subtitle cues per LLM QC request")

    subtitle_style: SubtitleStyleConfig = Field(default_factory=SubtitleStyleConfig)

    # Segmentation tuning.
    max_cue_chars: int = 84
    max_cue_duration: float = 6.0
    pause_gap: float = 1.2
    merge_gap: float = 1.5
    min_cue_duration: float = 1.0
    audio_offset_sec: float = 0.0

    # Dubbing / TTS
    job_mode: Literal["subtitle", "dub"] = "subtitle"
    tts_backend: Literal["kokoro", "qwen", "voxcpm", "omnivoice", "higgs"] = "qwen"
    tts_model: str = "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"
    voice_mode: Literal["clone_video", "clone_upload", "preset"] = "clone_video"
    voice_id: str = "Ryan"
    voice_design_instruct: str = ""
    voice_instruct: str = ""
    ref_text: str = ""
    voice_clone_x_vector_only: bool = False
    higgs_server_url: str = "http://localhost:8000"
    keep_background: bool = True
    background_mix_level: float = Field(0.85, ge=0.0, le=1.0)
    background_fallback_level: float = Field(0.3, ge=0.0, le=1.0)

    def helsinki_model(self, src: str, tgt: str) -> str:
        from .helsinki_models import resolve_helsinki_repo

        return resolve_helsinki_repo(src, tgt)


class Settings(BaseSettings):
    """Process-wide settings (paths, server)."""

    model_config = SettingsConfigDict(env_prefix="SUBTITLE_", env_file=".env", extra="ignore")

    data_dir: Path = Path(__file__).resolve().parent.parent / "data"
    device: str = "cuda:0"
    torch_dtype: str = "bfloat16"
    mock_models: bool = False
    hf_token: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("HF_TOKEN", "SUBTITLE_HF_TOKEN", "hf_token"),
    )
    hf_home: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("HF_HOME", "SUBTITLE_HF_HOME", "hf_home"),
    )

    @property
    def jobs_dir(self) -> Path:
        return self.data_dir / "jobs"

    def ensure_dirs(self) -> None:
        self.jobs_dir.mkdir(parents=True, exist_ok=True)


settings = Settings()
settings.ensure_dirs()
