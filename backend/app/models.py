"""Shared data models for words, cues, and jobs."""
from __future__ import annotations

from enum import Enum
from typing import List, Optional

from pydantic import BaseModel

from .config import PipelineConfig


class Word(BaseModel):
    w: str
    start: float
    end: float


class Line(BaseModel):
    text: str
    words: List[Word] = []


class Cue(BaseModel):
    id: int
    start: float
    end: float
    source: Line
    target: Line


class JobStatus(str, Enum):
    pending = "pending"
    downloading = "downloading"
    extracting = "extracting"
    transcribing = "transcribing"
    segmenting = "segmenting"
    translating = "translating"
    quality_check = "quality_check"
    building = "building"
    done = "done"
    error = "error"


class ProgressEvent(BaseModel):
    job_id: str
    status: JobStatus
    progress: float = 0.0  # 0..1
    message: str = ""


class Job(BaseModel):
    id: str
    status: JobStatus = JobStatus.pending
    progress: float = 0.0
    message: str = ""
    config: PipelineConfig
    source_url: Optional[str] = None
    media_filename: Optional[str] = None
    error: Optional[str] = None
    cues: List[Cue] = []
    export_filename: Optional[str] = None
