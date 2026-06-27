# KaraokeSub Studio

**Local dual-subtitle pipeline for video and audio.** Transcribe speech with Qwen3-ASR, translate with Helsinki-NLP (or optional LLM backends), optionally refine translations via LM Studio, and play the result in a web player with **two subtitle tracks** and **live word-by-word karaoke highlighting**. Export a burned-in MP4 when you are done.

Everything runs on your machine — no cloud API keys required for the core workflow.

---

## Features

| Capability | Details |
|---|---|
| **Input** | YouTube URL (`yt-dlp`) or local video/audio upload |
| **Transcription** | Qwen3-ASR with selectable model size (0.6B / 1.7B, standard or HF weights) |
| **Word timestamps** | Qwen3 Forced Aligner for karaoke-style highlighting on the source line |
| **Translation** | Helsinki `opus-mt` (default), Hunyuan Hy-MT2, or TranslateGemma 4B |
| **Quality control** | Optional back-translation + LM Studio review in batches |
| **Player** | Dual subtitles, clickable transcript, per-word highlight sync |
| **Export** | Burn subtitles into MP4 via ffmpeg |
| **Model manager** | In-app Hugging Face download UI with live progress |

Supported language pairs depend on the ASR model and available Helsinki direction models (e.g. Swedish ↔ English, and many others).

---

## Architecture

```
YouTube URL / file upload
        │
        ▼
  yt-dlp + ffmpeg ──► 16 kHz mono WAV
        │
        ▼
  Qwen3-ASR + Forced Aligner ──► text + word-level timestamps
        │
        ▼
  Cue segmentation
        │
        ▼
  Translation backend (Helsinki / Hunyuan / TranslateGemma)
        │
        ▼
  Optional QC (back-translate + LM Studio, batched)
        │
        ▼
  cues.json + subtitles.ass ──► web player / ffmpeg burn-in export
```

The spoken language receives real word timings. Translated-line timings are approximated by distributing each cue's duration across its words by character length.

---

## Requirements

| Component | Version / notes |
|---|---|
| **Python** | 3.10+ |
| **[uv](https://docs.astral.sh/uv/)** | Recommended package manager for the backend |
| **Node.js** | 18+ (frontend) |
| **ffmpeg** | Must be on `PATH` (audio extract + export) |
| **[Deno](https://docs.deno.com/runtime/getting_started/installation/)** | Required for YouTube downloads via yt-dlp |
| **GPU** | NVIDIA CUDA strongly recommended (ASR + translation models are heavy) |
| **LM Studio** | Optional — local LLM server for translation quality control |

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/karaokesub-studio.git
cd karaokesub-studio
```

### 2. Backend

```bash
cd backend

# Create virtualenv and install dependencies (PyTorch CUDA 11.8 via pyproject.toml)
uv sync

# Start the API server
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Alternative without uv:

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

The API listens on **http://localhost:8000**.

### 3. Frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**. The Vite dev server proxies `/api` (including WebSockets) to the backend on port 8000.

### 4. Download models

Before your first job:

1. Open the app and click **Models** (or call `GET /api/models`).
2. Download the ASR and forced-aligner models you plan to use.
3. Download the Helsinki pair(s) for your language direction (e.g. `opus-mt-sv-en`).

Default job configuration expects:

- `Qwen/Qwen3-ASR-1.7B`
- `Qwen/Qwen3-ForcedAligner-0.6B`
- `Helsinki-NLP/opus-mt-{src}-{tgt}`

Models are cached by Hugging Face Hub after the first download.

---

## Usage

1. Paste a **YouTube URL** or **upload** a video/audio file.
2. Select **spoken language** and **translation language**.
3. Choose **ASR model** and **forced aligner** (use matching `-hf` variants together if applicable).
4. Pick a **translation engine**; optionally enable **quality control** and set your LM Studio model name.
5. Click **Generate dual subtitles** and watch progress in real time.
6. Play the video with dual subtitles and karaoke highlighting, or **Export burned-in video**.

---

## Configuration

Environment variables (optional, prefix `SUBTITLE_`):

| Variable | Default | Description |
|---|---|---|
| `SUBTITLE_DEVICE` | `cuda:0` | Torch device for inference |
| `SUBTITLE_TORCH_DTYPE` | `bfloat16` | Model dtype |
| `SUBTITLE_MOCK_MODELS` | unset | Set to `1` to run the UI pipeline with mock ASR/translation (no GPU) |

Job-level options (form / `POST /api/jobs`):

- `asr_model`, `forced_aligner_model`
- `translator_backend`: `helsinki` | `hunyuan` | `translategemma`
- `qc_enabled`, `lmstudio_url`, `lmstudio_model`

For QC, LM Studio's native chat API is used (`POST /api/v1/chat`). A small model such as `liquid/lfm2.5-1.2b` is a reliable choice.

---

## Project structure

```
karaokesub-studio/
├── backend/
│   ├── app/              # FastAPI app, pipeline, job manager
│   ├── pyproject.toml
│   └── requirements.txt
├── frontend/             # React + Vite + Tailwind UI
└── README.md
```

---

## Development

**Backend lint / smoke test (mock models, no GPU):**

```bash
cd backend
SUBTITLE_MOCK_MODELS=1 uv run uvicorn app.main:app --reload
```

**Frontend production build:**

```bash
cd frontend
npm run build
npm run preview
```

---

## Acknowledgements

- [Qwen3-ASR](https://github.com/QwenLM/Qwen3-ASR) — speech recognition and forced alignment
- [Helsinki-NLP opus-mt](https://huggingface.co/Helsinki-NLP) — fast neural machine translation
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — media ingestion
- [LM Studio](https://lmstudio.ai/) — optional local LLM quality control

---

## License

MIT — see [LICENSE](LICENSE).
