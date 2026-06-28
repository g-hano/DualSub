"""Separate vocals from accompaniment, mix dubbed speech, mux with video."""
from __future__ import annotations

import logging
import shutil
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf

logger = logging.getLogger(__name__)

TARGET_SR = 24000


def _require_ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if not exe:
        raise RuntimeError("ffmpeg not found on PATH.")
    return exe


def _probe_duration(path: Path) -> float:
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return 0.0
    cmd = [
        ffprobe,
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        return 0.0
    try:
        return max(0.0, float(proc.stdout.strip()))
    except ValueError:
        return 0.0


def _load_mono(path: Path, target_sr: int = TARGET_SR) -> np.ndarray:
    data, sr = sf.read(str(path), dtype="float32")
    if data.ndim > 1:
        data = data.mean(axis=1)
    if sr != target_sr:
        try:
            import librosa

            data = librosa.resample(data, orig_sr=sr, target_sr=target_sr)
        except Exception:
            ratio = target_sr / sr
            n = max(1, int(len(data) * ratio))
            x_old = np.linspace(0, 1, len(data))
            x_new = np.linspace(0, 1, n)
            data = np.interp(x_new, x_old, data).astype(np.float32)
    return np.asarray(data, dtype=np.float32)


def mono_sample_count(path: Path, target_sr: int = TARGET_SR) -> int:
    """Return sample count of a mono file resampled to target_sr."""
    return len(_load_mono(path, target_sr))


def load_accompaniment(job_dir: Path, wav_path: Path) -> tuple[np.ndarray, int, bool]:
    """Load cached accompaniment.wav if present, otherwise run Demucs separation."""
    accomp_path = job_dir / "accompaniment.wav"
    if accomp_path.exists():
        data = _load_mono(accomp_path, TARGET_SR)
        logger.info("Loaded cached accompaniment from %s", accomp_path.name)
        return data, TARGET_SR, True
    return separate_accompaniment(wav_path, job_dir, keep_background=True)


def separate_accompaniment(
    wav_path: Path,
    job_dir: Path,
    *,
    keep_background: bool = True,
) -> tuple[np.ndarray, int, bool]:
    """Return accompaniment stem (no vocals) at TARGET_SR.

    Returns (accompaniment, sample_rate, separation_succeeded).
    """
    vocals_path = job_dir / "vocals_orig.wav"
    accomp_path = job_dir / "accompaniment.wav"

    if accomp_path.exists():
        data = _load_mono(accomp_path, TARGET_SR)
        logger.info("Using existing accompaniment cache")
        return data, TARGET_SR, True

    if not keep_background:
        dur_samples = len(_load_mono(wav_path))
        return np.zeros(dur_samples, dtype=np.float32), TARGET_SR, True

    try:
        import torch
        import torchaudio
        from demucs.apply import apply_model
        from demucs.pretrained import get_model

        model = get_model("htdemucs")
        model.eval()
        wav, sr = torchaudio.load(str(wav_path))
        if wav.shape[0] == 1:
            wav = wav.repeat(2, 1)
        elif wav.shape[0] > 2:
            wav = wav[:2]
        ref_sr = model.samplerate
        if sr != ref_sr:
            wav = torchaudio.functional.resample(wav, sr, ref_sr)
        with torch.no_grad():
            sources = apply_model(model, wav[None], device="cpu", progress=False)[0]
        # sources: drums, bass, other, vocals
        accomp = sources[0].numpy() + sources[1].numpy() + sources[2].numpy()
        vocals = sources[3].numpy()
        vocals_mono = vocals.mean(axis=0).astype(np.float32)
        accomp_mono = accomp.mean(axis=0).astype(np.float32)
        sf.write(str(vocals_path), vocals_mono, ref_sr)
        sf.write(str(accomp_path), accomp_mono, ref_sr)
        if ref_sr != TARGET_SR:
            try:
                import librosa

                accomp_mono = librosa.resample(accomp_mono, orig_sr=ref_sr, target_sr=TARGET_SR)
            except Exception:
                pass
        logger.info("Demucs separation complete")
        return accomp_mono.astype(np.float32), TARGET_SR, True
    except Exception as exc:
        logger.warning("Demucs separation failed (%s); dubbed vocals only", exc)
        return np.zeros(0, dtype=np.float32), TARGET_SR, False


def mix_dubbed(
    dubbed_vocals_path: Path,
    accompaniment: np.ndarray,
    out_path: Path,
    original_wav: Path | None = None,
    *,
    background_level: float = 0.85,
    fallback_original_level: float = 0.3,
    pad_to_samples: int | None = None,
) -> Path:
    """Mix dubbed vocals with accompaniment (or original-audio fallback)."""
    dubbed = _load_mono(dubbed_vocals_path, TARGET_SR)
    if len(accompaniment) == 0:
        logger.info("No accompaniment available; using dubbed vocals only")
        mixed = dubbed
    else:
        n = max(len(dubbed), len(accompaniment))
        d = np.pad(dubbed, (0, n - len(dubbed)))
        a = np.pad(accompaniment, (0, n - len(accompaniment)))
        mixed = d + a * background_level

    if pad_to_samples is not None and len(mixed) < pad_to_samples:
        mixed = np.pad(mixed, (0, pad_to_samples - len(mixed)))

    peak = np.max(np.abs(mixed))
    if peak > 1e-6:
        mixed = mixed / peak * 0.98

    out_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(out_path), mixed, TARGET_SR)
    return out_path


def mux_audio(media_path: Path, audio_wav: Path, out_path: Path) -> Path:
    """Replace video audio track with dubbed WAV, padding audio to match video length."""
    ffmpeg = _require_ffmpeg()
    video_dur = _probe_duration(media_path)
    audio_dur = _probe_duration(audio_wav)

    if video_dur > 0 and audio_dur > 0 and video_dur > audio_dur + 0.05:
        pad_sec = video_dur - audio_dur + 0.1
        filter_complex = f"[1:a]apad=pad_dur={pad_sec:.3f}[aout]"
        cmd = [
            ffmpeg,
            "-y",
            "-i",
            str(media_path),
            "-i",
            str(audio_wav),
            "-filter_complex",
            filter_complex,
            "-map",
            "0:v:0",
            "-map",
            "[aout]",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            str(out_path),
        ]
    else:
        cmd = [
            ffmpeg,
            "-y",
            "-i",
            str(media_path),
            "-i",
            str(audio_wav),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            str(out_path),
        ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg mux failed:\n{proc.stderr[-2000:]}")
    return out_path
