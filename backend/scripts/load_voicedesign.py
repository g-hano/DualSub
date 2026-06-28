"""Load Qwen3 VoiceDesign like the app does — shows HF download progress live."""
from __future__ import annotations

import os
import sys

# Ensure progress bars are visible (app disables them at runtime).
os.environ.pop("HF_HUB_DISABLE_PROGRESS_BARS", None)
os.environ.setdefault("TRANSFORMERS_VERBOSITY", "info")

import torch
from qwen_tts import Qwen3TTSModel

from app.model_paths import BACKEND_DIR, configure_hf_cache, resolve_hf_model_path

REPO = "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"


def main() -> None:
    configure_hf_cache()
    load_path = resolve_hf_model_path(REPO)
    hf_home = os.environ.get("HF_HOME") or os.path.expanduser("~/.cache/huggingface")
    print(f"Repo id: {REPO}")
    print(f"Resolved load path: {load_path}")
    print(f"Backend models dir: {BACKEND_DIR}")
    print(f"HF cache home: {hf_home}")
    print("--- from_pretrained ---", flush=True)

    kwargs: dict = {"device_map": "cuda:0", "dtype": torch.bfloat16}
    try:
        model = Qwen3TTSModel.from_pretrained(load_path, attn_implementation="flash_attention_2", **kwargs)
    except Exception as exc:
        print(f"flash_attention_2 failed ({exc}), retrying without it", flush=True)
        model = Qwen3TTSModel.from_pretrained(load_path, **kwargs)

    print("Model loaded successfully.", flush=True)
    print("Running quick generate_voice_design test...", flush=True)
    wavs, sr = model.generate_voice_design(
        text="Hello, this is a download test.",
        language="English",
        instruct="A calm male narrator voice.",
    )
    print(f"Done. audio samples={len(wavs[0])}, sr={sr}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
