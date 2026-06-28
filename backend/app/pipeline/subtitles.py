"""Build subtitle artifacts: cue list (for the web player), an ASS file with
karaoke word timing, and an optional ffmpeg burn-in export."""
from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path
from typing import List, Optional

from ..config import SubtitleStyleConfig, TrackStyle
from ..models import Cue, Line, Word
from .segment import Segment

ASS_FONT_SCALE = 2.7


def _split_target_words(text: str) -> List[str]:
    return [t for t in re.split(r"\s+", text.strip()) if t]


def _approx_target_words(text: str, start: float, end: float) -> List[Word]:
    """Distribute a cue's time across target words proportionally to length."""
    tokens = _split_target_words(text)
    if not tokens:
        return []
    weights = [max(len(t), 1) for t in tokens]
    total = sum(weights)
    span = max(end - start, 0.001)
    words: List[Word] = []
    cursor = start
    for tok, weight in zip(tokens, weights):
        dur = span * (weight / total)
        words.append(
            Word(w=tok, start=round(cursor, 3), end=round(cursor + dur, 3))
        )
        cursor += dur
    if words:
        words[-1].end = round(end, 3)
    return words


def build_cues(
    segments: List[Segment],
    translations: List[str],
    *,
    offset_sec: float = 0.0,
) -> List[Cue]:
    cues: List[Cue] = []
    for idx, (seg, translation) in enumerate(zip(segments, translations)):
        start = round(seg.start + offset_sec, 3)
        end = round(seg.end + offset_sec, 3)
        source_words = [
            Word(
                w=w.w,
                start=round(w.start + offset_sec, 3),
                end=round(w.end + offset_sec, 3),
            )
            for w in seg.words
        ]
        target_words = _approx_target_words(translation, start, end)
        cues.append(
            Cue(
                id=idx,
                start=start,
                end=end,
                source=Line(text=seg.text, words=source_words),
                target=Line(text=translation, words=target_words),
            )
        )
    return cues


def _fmt_ass_time(seconds: float) -> str:
    if seconds < 0:
        seconds = 0
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = int(round((seconds - int(seconds)) * 100))
    if cs == 100:
        cs = 0
        s += 1
    return f"{h:d}:{m:02d}:{s:02d}.{cs:02d}"


def _ass_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("{", "(").replace("}", ")")


def _hex_to_ass_color(hex_color: str, alpha: int = 0) -> str:
    """Convert #RRGGBB to ASS &HAABBGGRR format."""
    hex_color = hex_color.lstrip("#")
    if len(hex_color) != 6:
        return "&H00FFFFFF"
    r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
    return f"&H{alpha:02X}{b:02X}{g:02X}{r:02X}"


def _ass_font_size(px: int) -> int:
    return max(18, round(px * ASS_FONT_SCALE))


def _opacity_to_ass_alpha(opacity: float) -> int:
    """Map 0..1 opacity to ASS alpha byte (0=opaque, 255=transparent)."""
    return int((1.0 - max(0.0, min(1.0, opacity))) * 255)


def _track_style_line(name: str, track: TrackStyle, margin_v: int) -> str:
    primary = _hex_to_ass_color(track.color)
    karaoke = _hex_to_ass_color(track.karaoke_active_color)
    back_alpha = _opacity_to_ass_alpha(track.background_opacity)
    back_colour = f"&H{back_alpha:02X}000000"
    bold = -1 if track.bold else 0
    italic = -1 if track.italic else 0
    fontsize = _ass_font_size(track.font_size)
    return (
        f"Style: {name},{track.font_family},{fontsize},{primary},{karaoke},"
        f"&H00000000,{back_colour},{bold},{italic},0,0,100,100,0,0,1,3,1,2,80,80,{margin_v},1"
    )


def probe_video_size(path: Path) -> tuple[int, int]:
    """Return (width, height) of the first video stream, or 1920x1080 if unknown."""
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return 1920, 1080
    cmd = [
        ffprobe,
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "csv=p=0:s=x",
        str(path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        return 1920, 1080
    try:
        w_str, h_str = proc.stdout.strip().split("x")
        w, h = int(w_str), int(h_str)
        if w > 0 and h > 0:
            return w, h
    except ValueError:
        pass
    return 1920, 1080


def build_ass_header(
    style: Optional[SubtitleStyleConfig] = None,
    *,
    play_res_x: int = 1920,
    play_res_y: int = 1080,
) -> str:
    style = style or SubtitleStyleConfig()
    source_line = _track_style_line("Source", style.source, max(60, int(play_res_y * 0.11)))
    target_line = _track_style_line("Target", style.target, max(40, int(play_res_y * 0.055)))
    return f"""[Script Info]
ScriptType: v4.00+
PlayResX: {play_res_x}
PlayResY: {play_res_y}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
{source_line}
{target_line}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def _karaoke_line(words: List[Word], cue_start: float) -> str:
    """Build a line with ASS \\k karaoke tags (centiseconds per word)."""
    if not words:
        return ""
    parts: List[str] = []
    prev_end = cue_start
    for word in words:
        gap_cs = max(int(round((word.start - prev_end) * 100)), 0)
        if gap_cs > 0:
            parts.append(f"{{\\k{gap_cs}}} ")
        dur_cs = max(int(round((word.end - word.start) * 100)), 1)
        parts.append(f"{{\\k{dur_cs}}}{_ass_escape(word.w)} ")
        prev_end = word.end
    return "".join(parts).strip()


def build_ass(
    cues: List[Cue],
    style: Optional[SubtitleStyleConfig] = None,
    *,
    play_res_x: int = 1920,
    play_res_y: int = 1080,
) -> str:
    lines = [build_ass_header(style, play_res_x=play_res_x, play_res_y=play_res_y)]
    for cue in cues:
        start = _fmt_ass_time(cue.start)
        end = _fmt_ass_time(cue.end)
        source_text = _karaoke_line(cue.source.words, cue.start) or _ass_escape(
            cue.source.text
        )
        target_text = _karaoke_line(cue.target.words, cue.start) or _ass_escape(
            cue.target.text
        )
        lines.append(
            f"Dialogue: 0,{start},{end},Source,,0,0,0,,{source_text}"
        )
        lines.append(
            f"Dialogue: 0,{start},{end},Target,,0,0,0,,{target_text}"
        )
    return "\n".join(lines) + "\n"


def write_artifacts(
    cues: List[Cue],
    job_dir: Path,
    style: Optional[SubtitleStyleConfig] = None,
    *,
    media_path: Optional[Path] = None,
) -> tuple[Path, Path]:
    """Write cues.json and subtitles.ass; return their paths."""
    import json

    play_res_x, play_res_y = 1920, 1080
    if media_path is not None and media_path.exists():
        play_res_x, play_res_y = probe_video_size(media_path)

    cues_path = job_dir / "cues.json"
    ass_path = job_dir / "subtitles.ass"
    cues_path.write_text(
        json.dumps([c.model_dump() for c in cues], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    ass_path.write_text(
        build_ass(cues, style, play_res_x=play_res_x, play_res_y=play_res_y),
        encoding="utf-8",
    )
    return cues_path, ass_path


def burn_in(media_path: Path, ass_path: Path, out_path: Path) -> Path:
    """Burn the ASS subtitles into the video with ffmpeg."""
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg not found on PATH.")
    ass_arg = str(ass_path).replace("\\", "/").replace(":", "\\:")
    cmd = [
        ffmpeg,
        "-y",
        "-i",
        str(media_path),
        "-vf",
        f"subtitles='{ass_arg}'",
        "-c:v",
        "libx264",
        "-preset",
        "slow",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
        str(out_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg burn-in failed:\n{proc.stderr[-2000:]}")
    return out_path
