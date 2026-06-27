"""In-process job manager that runs the pipeline in a background thread and
broadcasts progress over asyncio queues (consumed by the WebSocket route)."""
from __future__ import annotations

import asyncio
import json
import logging
import threading
import traceback
import uuid
from pathlib import Path
from typing import Dict, List, Optional

from .config import PipelineConfig, settings
from .models import Cue, Job, JobStatus
from .pipeline import asr, ingest, qc, segment, subtitles, translate

logger = logging.getLogger(__name__)


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
    def start(self, job: Job, upload_path: Optional[Path] = None, upload_name: Optional[str] = None) -> None:
        thread = threading.Thread(
            target=self._run, args=(job, upload_path, upload_name), daemon=True
        )
        thread.start()

    def _run(self, job: Job, upload_path: Optional[Path], upload_name: Optional[str]) -> None:
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

            self._update(job, JobStatus.translating, 0.6, "Translating")
            translator = translate.get_translator(cfg.translator_backend)
            source_texts = [s.text for s in segments]
            translations = translator.translate(source_texts, src, tgt)

            if cfg.qc_enabled:
                self._update(job, JobStatus.quality_check, 0.8, "Quality checking")
                translations = qc.quality_check(source_texts, translations, src, tgt, cfg)

            self._update(job, JobStatus.building, 0.9, "Writing subtitles")
            cues = subtitles.build_cues(segments, translations)
            job.cues = cues
            subtitles.write_artifacts(cues, job_dir)

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

    # ---- export -------------------------------------------------------
    def export(self, job: Job) -> Path:
        job_dir = self.job_dir(job.id)
        media = job_dir / (job.media_filename or "")
        ass = job_dir / "subtitles.ass"
        if not media.exists():
            raise FileNotFoundError("Source media not available for export.")
        if not ass.exists():
            raise FileNotFoundError("Subtitles not generated yet.")
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
