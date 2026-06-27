"""Media ingestion: download from YouTube (yt-dlp) or accept local uploads,
then extract a 16kHz mono WAV for the ASR model using ffmpeg."""
from __future__ import annotations

import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


class IngestError(RuntimeError):
    pass


def _ensure_js_runtime_on_path() -> None:
    """Prepend common Deno install locations so yt-dlp can solve YouTube JS challenges."""
    home = Path.home()
    candidates = [
        home / ".deno" / "bin",
        Path(os.environ.get("DENO_INSTALL", "")) / "bin",
    ]
    extra = os.pathsep.join(str(p) for p in candidates if p.is_dir())
    if extra:
        os.environ["PATH"] = extra + os.pathsep + os.environ.get("PATH", "")


class _YtDlpLogger:
    """Forward yt-dlp messages to the app logger (visible in the backend terminal)."""

    def debug(self, msg: str) -> None:
        if msg.strip():
            logger.debug(msg)

    def info(self, msg: str) -> None:
        if msg.strip():
            logger.info(msg)

    def warning(self, msg: str) -> None:
        logger.warning(msg)

    def error(self, msg: str) -> None:
        logger.error(msg)


def _require_ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if not exe:
        raise IngestError(
            "ffmpeg not found on PATH. Install it (https://ffmpeg.org/) and restart."
        )
    return exe


def download_youtube(url: str, dest_dir: Path) -> Path:
    """Download the best available video+audio for a YouTube URL into dest_dir.

    Returns the path to the downloaded video file.
    """
    try:
        from yt_dlp import YoutubeDL
    except ImportError as exc:  # pragma: no cover
        raise IngestError("yt-dlp is not installed") from exc

    _ensure_js_runtime_on_path()
    dest_dir.mkdir(parents=True, exist_ok=True)
    outtmpl = str(dest_dir / "source.%(ext)s")
    ydl_opts = {
        # Flexible selector: prefer separate streams, fall back to any best format.
        "format": "bestvideo*+bestaudio/best",
        "merge_output_format": "mp4",
        "outtmpl": outtmpl,
        "quiet": True,
        "no_warnings": False,
        "noprogress": True,
        "noplaylist": True,
        "logger": _YtDlpLogger(),
        "extractor_args": {
            "youtube": {
                "player_client": ["web", "mweb", "android"],
            }
        },
    }
    logger.info("Downloading YouTube media: %s", url)
    try:
        with YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            path = Path(ydl.prepare_filename(info))
    except Exception as exc:
        raise IngestError(str(exc)) from exc
    # merge_output_format may rewrite the extension to mp4.
    if not path.exists():
        merged = path.with_suffix(".mp4")
        if merged.exists():
            path = merged
    if not path.exists():
        raise IngestError(f"Download finished but file not found: {path}")
    logger.info("YouTube download complete: %s", path.name)
    return path


def save_upload(src_path: Path, dest_dir: Path, filename: str) -> Path:
    """Copy/move an uploaded media file into the job directory."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    suffix = Path(filename).suffix or ".mp4"
    dest = dest_dir / f"source{suffix}"
    shutil.copyfile(src_path, dest)
    logger.info("Saved upload as %s", dest.name)
    return dest


def extract_audio(media_path: Path, dest_dir: Path) -> Path:
    """Extract a 16kHz mono WAV from any media file."""
    ffmpeg = _require_ffmpeg()
    dest_dir.mkdir(parents=True, exist_ok=True)
    wav_path = dest_dir / "audio.wav"
    cmd = [
        ffmpeg,
        "-y",
        "-i",
        str(media_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "wav",
        str(wav_path),
    ]
    logger.info("Extracting 16 kHz mono audio from %s", media_path.name)
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        logger.error("ffmpeg failed:\n%s", proc.stderr[-2000:])
        raise IngestError(f"ffmpeg audio extraction failed:\n{proc.stderr[-2000:]}")
    logger.info("Audio extraction complete: %s", wav_path.name)
    return wav_path


def ingest(
    dest_dir: Path,
    url: Optional[str] = None,
    upload_path: Optional[Path] = None,
    upload_name: Optional[str] = None,
) -> tuple[Path, Path]:
    """Resolve input into (media_path, wav_path)."""
    if url:
        media = download_youtube(url, dest_dir)
    elif upload_path:
        media = save_upload(upload_path, dest_dir, upload_name or upload_path.name)
    else:
        raise IngestError("Either a URL or an uploaded file is required.")
    wav = extract_audio(media, dest_dir)
    return media, wav
