"""Build subtitle artifacts: cue list (for the web player), an ASS file with
karaoke word timing, and an optional ffmpeg burn-in export."""
from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path
from typing import List

from ..models import Cue, Line, Word
from .segment import Segment


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


def build_cues(segments: List[Segment], translations: List[str]) -> List[Cue]:
    cues: List[Cue] = []
    for idx, (seg, translation) in enumerate(zip(segments, translations)):
        source_words = [
            Word(w=w.w, start=round(w.start, 3), end=round(w.end, 3)) for w in seg.words
        ]
        target_words = _approx_target_words(translation, seg.start, seg.end)
        cues.append(
            Cue(
                id=idx,
                start=round(seg.start, 3),
                end=round(seg.end, 3),
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


def _karaoke_line(words: List[Word], cue_start: float) -> str:
    """Build a line with ASS \\k karaoke tags (centiseconds per word)."""
    if not words:
        return ""
    parts: List[str] = []
    prev_end = cue_start
    for word in words:
        # leading gap as an unhighlighted pause
        gap_cs = max(int(round((word.start - prev_end) * 100)), 0)
        if gap_cs > 0:
            parts.append(f"{{\\k{gap_cs}}} ")
        dur_cs = max(int(round((word.end - word.start) * 100)), 1)
        parts.append(f"{{\\k{dur_cs}}}{_ass_escape(word.w)} ")
        prev_end = word.end
    return "".join(parts).strip()


_ASS_HEADER = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Source,Arial,54,&H00FFFFFF,&H0000C8FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,3,1,2,80,80,120,1
Style: Target,Arial,44,&H00B4F0C8,&H0000C8FF,&H00000000,&H64000000,0,1,0,0,100,100,0,0,1,3,1,2,80,80,60,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def build_ass(cues: List[Cue]) -> str:
    lines = [_ASS_HEADER]
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


def write_artifacts(cues: List[Cue], job_dir: Path) -> tuple[Path, Path]:
    """Write cues.json and subtitles.ass; return their paths."""
    import json

    cues_path = job_dir / "cues.json"
    ass_path = job_dir / "subtitles.ass"
    cues_path.write_text(
        json.dumps([c.model_dump() for c in cues], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    ass_path.write_text(build_ass(cues), encoding="utf-8")
    return cues_path, ass_path


def burn_in(media_path: Path, ass_path: Path, out_path: Path) -> Path:
    """Burn the ASS subtitles into the video with ffmpeg."""
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg not found on PATH.")
    # ffmpeg's subtitles filter needs an escaped path (esp. on Windows).
    ass_arg = str(ass_path).replace("\\", "/").replace(":", "\\:")
    # Burning subtitles requires re-encoding the video. Use a high-quality x264
    # encode (CRF 18 is visually near-lossless) and copy the audio untouched so
    # the output quality stays as close to the source as possible.
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
