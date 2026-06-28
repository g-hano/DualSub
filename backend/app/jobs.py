"""In-process job manager that runs the pipeline in a background thread and
broadcasts progress over asyncio queues (consumed by the WebSocket route)."""
from __future__ import annotations

import asyncio
import json
import logging
import shutil
import threading
import traceback
import uuid
from pathlib import Path
from typing import Dict, List, Optional

from .config import PipelineConfig, is_qwen_voice_clone_model, settings
from .models import Cue, Job, JobStatus
from .pipeline import asr, dub, ingest, punctuation, qc, segment, subtitles, translate
from .pipeline import audio_mix, voice_ref
from .pipeline.tts import unload_tts

logger = logging.getLogger(__name__)

CLONE_BACKENDS = frozenset({"voxcpm", "omnivoice", "higgs"})


class JobManager:
    def __init__(self) -> None:
        self._jobs: Dict[str, Job] = {}
        self._subscribers: Dict[str, List[asyncio.Queue]] = {}
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._lock = threading.Lock()

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    # ---- job lifecycle -------------------------------------------------
    def create_job(
        self,
        config: PipelineConfig,
        source_url: Optional[str] = None,
        media_filename: Optional[str] = None,
    ) -> Job:
        job_id = uuid.uuid4().hex[:12]
        job = Job(
            id=job_id,
            config=config,
            source_url=source_url,
            media_filename=media_filename,
        )
        with self._lock:
            self._jobs[job_id] = job
            self._subscribers[job_id] = []
        self.job_dir(job_id).mkdir(parents=True, exist_ok=True)
        return job

    def get_job(self, job_id: str) -> Optional[Job]:
        return self._jobs.get(job_id)

    def job_dir(self, job_id: str) -> Path:
        return settings.jobs_dir / job_id

    # ---- progress broadcasting ----------------------------------------
    def subscribe(self, job_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self._subscribers.setdefault(job_id, []).append(q)
        return q

    def unsubscribe(self, job_id: str, q: asyncio.Queue) -> None:
        subs = self._subscribers.get(job_id, [])
        if q in subs:
            subs.remove(q)

    def _emit(self, job: Job) -> None:
        payload = {
            "job_id": job.id,
            "status": job.status.value,
            "progress": round(job.progress, 3),
            "message": job.message,
        }
        loop = self._loop
        for q in list(self._subscribers.get(job.id, [])):
            if loop is not None:
                loop.call_soon_threadsafe(q.put_nowait, payload)

    def _update(self, job: Job, status: JobStatus, progress: float, message: str = "") -> None:
        job.status = status
        job.progress = progress
        job.message = message
        logger.info("[job %s] %s (%.0f%%) — %s", job.id, status.value, progress * 100, message or status.value)
        self._emit(job)

    # ---- pipeline execution -------------------------------------------
    def start(
        self,
        job: Job,
        upload_path: Optional[Path] = None,
        upload_name: Optional[str] = None,
        ref_audio_path: Optional[Path] = None,
    ) -> None:
        thread = threading.Thread(
            target=self._run,
            args=(job, upload_path, upload_name, ref_audio_path),
            daemon=True,
        )
        thread.start()

    def _run(
        self,
        job: Job,
        upload_path: Optional[Path],
        upload_name: Optional[str],
        ref_audio_path: Optional[Path],
    ) -> None:
        cfg = job.config
        src, tgt = cfg.source_lang, cfg.target_lang
        job_dir = self.job_dir(job.id)
        try:
            self._update(job, JobStatus.downloading, 0.05, "Fetching media")
            media, wav = ingest.ingest(
                job_dir,
                url=job.source_url,
                upload_path=upload_path,
                upload_name=upload_name,
            )
            job.media_filename = media.name

            self._update(job, JobStatus.transcribing, 0.25, "Transcribing audio")
            asr_result = asr.transcribe(wav, src, cfg)

            self._update(job, JobStatus.segmenting, 0.5, "Building subtitle cues")
            segments = segment.segment_words(asr_result.words, cfg)

            asr.unload()

            self._update(job, JobStatus.translating, 0.6, "Translating")
            translator = translate.get_translator(
                cfg.translator_backend,
                nllb_model=cfg.nllb_model,
                hunyuan_model=cfg.hunyuan_model,
            )
            source_texts = [s.text for s in segments]
            translations = translator.translate(
                source_texts, src, tgt, batch_size=cfg.translate_batch_size
            )

            if cfg.qc_enabled:
                self._update(job, JobStatus.quality_check, 0.8, "Quality checking")
                translations = qc.quality_check(source_texts, translations, src, tgt, cfg)

            translations = punctuation.add_punctuation(translations)

            self._update(job, JobStatus.building, 0.9, "Writing subtitles")
            cues = subtitles.build_cues(segments, translations, offset_sec=cfg.audio_offset_sec)
            job.cues = cues
            subtitles.write_artifacts(cues, job_dir, cfg.subtitle_style)

            if cfg.job_mode == "dub":
                translate.unload()

                ref = None
                needs_ref = (
                    cfg.tts_backend in ("omnivoice", "higgs")
                    or (
                        cfg.tts_backend == "qwen"
                        and is_qwen_voice_clone_model(cfg.tts_model)
                    )
                    or cfg.voice_mode in ("clone_video", "clone_upload")
                )
                if needs_ref:
                    if cfg.voice_mode == "clone_upload" and ref_audio_path:
                        dest = job_dir / "ref_upload.wav"
                        shutil.copy2(ref_audio_path, dest)
                        ref = voice_ref.prepare_reference(
                            job_dir,
                            wav,
                            asr_result.words,
                            voice_mode=cfg.voice_mode,
                            ref_text=cfg.ref_text,
                            upload_path=dest,
                        )
                    elif cfg.voice_mode == "clone_video":
                        ref = voice_ref.prepare_reference(
                            job_dir,
                            wav,
                            asr_result.words,
                            voice_mode=cfg.voice_mode,
                            ref_text=cfg.ref_text,
                        )

                self._update(job, JobStatus.synthesizing, 0.75, "Synthesizing speech")
                dubbed_vocals_path = job_dir / "dubbed_vocals.wav"
                import soundfile as sf

                media_duration = float(sf.info(str(wav)).duration)
                dub.synthesize_timeline(
                    cues, cfg, ref, dubbed_vocals_path, media_duration=media_duration
                )
                unload_tts()

                self._update(job, JobStatus.separating, 0.85, "Separating background audio")
                accompaniment, _, separation_ok = audio_mix.separate_accompaniment(
                    wav, job_dir, keep_background=cfg.keep_background
                )
                if not separation_ok and cfg.keep_background:
                    job.message = (
                        "Background separation failed; mixed with attenuated original audio"
                    )

                self._update(job, JobStatus.mixing, 0.92, "Mixing dubbed audio")
                dubbed_audio_path = job_dir / "dubbed_audio.wav"
                orig_samples = audio_mix.mono_sample_count(wav)
                audio_mix.mix_dubbed(
                    dubbed_vocals_path,
                    accompaniment,
                    dubbed_audio_path,
                    original_wav=wav,
                    background_level=cfg.background_mix_level,
                    fallback_original_level=cfg.background_fallback_level,
                    pad_to_samples=orig_samples,
                )

                dubbed_mp4 = job_dir / "dubbed.mp4"
                audio_mix.mux_audio(media, dubbed_audio_path, dubbed_mp4)
                job.dub_filename = dubbed_mp4.name

            self._update(job, JobStatus.done, 1.0, "Complete")
            self._persist(job)
        except Exception as exc:  # noqa: BLE001
            job.error = f"{exc}\n{traceback.format_exc()}"
            logger.exception("[job %s] pipeline failed: %s", job.id, exc)
            self._update(job, JobStatus.error, job.progress, str(exc))
            self._persist(job)

    def _persist(self, job: Job) -> None:
        (self.job_dir(job.id) / "job.json").write_text(
            job.model_dump_json(indent=2), encoding="utf-8"
        )

    def media_path(self, job: Job) -> Path:
        job_dir = self.job_dir(job.id)
        if job.config.job_mode == "dub" and job.dub_filename:
            dubbed = job_dir / job.dub_filename
            if dubbed.exists():
                return dubbed
        return job_dir / (job.media_filename or "")

    # ---- export -------------------------------------------------------
    def export(
        self,
        job: Job,
        subtitle_style=None,
        *,
        include_subtitles: bool = False,
    ) -> Path:
        job_dir = self.job_dir(job.id)
        media = self.media_path(job)
        if not media.exists():
            raise FileNotFoundError("Source media not available for export.")
        cues = self.load_cues(job.id)
        if not cues:
            raise FileNotFoundError("Subtitles not generated yet.")

        if job.config.job_mode == "dub" and not include_subtitles:
            out = job_dir / "export.mp4"
            import shutil

            shutil.copy2(media, out)
            job.export_filename = out.name
            self._persist(job)
            return out

        ass = job_dir / "subtitles.ass"
        style = subtitle_style if subtitle_style is not None else job.config.subtitle_style
        ass.write_text(subtitles.build_ass(cues, style), encoding="utf-8")
        out = job_dir / "export.mp4"
        subtitles.burn_in(media, ass, out)
        job.export_filename = out.name
        self._persist(job)
        return out

    def load_cues(self, job_id: str) -> List[Cue]:
        job = self.get_job(job_id)
        if job and job.cues:
            return job.cues
        path = self.job_dir(job_id) / "cues.json"
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            return [Cue(**c) for c in data]
        return []


manager = JobManager()
