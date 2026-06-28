"""Group word-level ASR output into subtitle cues.

A new cue is started when any of the following holds:
  - the previous token ended a sentence (. ! ? …)
  - the silent gap to the next word exceeds ``pause_gap``
  - adding the word would exceed ``max_cue_chars`` or ``max_cue_duration``
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List

from .asr import AsrWord

_SENTENCE_END = {".", "!", "?", "…"}
# Punctuation tokens that should attach to the previous word, not stand alone.
_TRAILING = {".", ",", "!", "?", ":", ";", "…", ")", "”", "»"}


@dataclass
class SegmentWord:
    w: str
    start: float
    end: float


@dataclass
class Segment:
    words: List[SegmentWord] = field(default_factory=list)

    @property
    def start(self) -> float:
        return self.words[0].start

    @property
    def end(self) -> float:
        return self.words[-1].end

    @property
    def text(self) -> str:
        out = ""
        for word in self.words:
            if word.w in _TRAILING or not out:
                out += word.w
            else:
                out += " " + word.w
        return out.strip()


def _ends_sentence(token: str) -> bool:
    return bool(token) and token[-1] in _SENTENCE_END


def segment_words(words: List[AsrWord], config) -> List[Segment]:
    segments: List[Segment] = []
    current = Segment()

    for i, word in enumerate(words):
        candidate_text = (current.text + " " + word.w).strip()
        too_long = len(candidate_text) > config.max_cue_chars
        too_far = current.words and (word.end - current.start) > config.max_cue_duration

        if current.words and (too_long or too_far):
            segments.append(current)
            current = Segment()

        current.words.append(SegmentWord(w=word.w, start=word.start, end=word.end))

        next_word = words[i + 1] if i + 1 < len(words) else None
        gap_break = next_word is not None and (next_word.start - word.end) > config.pause_gap

        if _ends_sentence(word.w) or gap_break:
            segments.append(current)
            current = Segment()

    if current.words:
        segments.append(current)

    return merge_short_segments([s for s in segments if s.words], config)


def merge_short_segments(segments: List[Segment], config) -> List[Segment]:
    """Merge adjacent short segments split by pause gaps during slow speech."""
    if not segments:
        return segments

    merged: List[Segment] = []
    current = segments[0]

    for nxt in segments[1:]:
        gap = nxt.start - current.end
        combined_text = (current.text + " " + nxt.text).strip()
        combined_dur = nxt.end - current.start
        ends_sentence = _ends_sentence(current.words[-1].w)
        can_merge = (
            not ends_sentence
            and gap < config.merge_gap
            and len(combined_text) <= config.max_cue_chars
            and combined_dur <= config.max_cue_duration
        )
        if can_merge:
            current.words.extend(nxt.words)
        else:
            merged.append(current)
            current = nxt
    merged.append(current)

    min_dur = getattr(config, "min_cue_duration", 1.0)
    if min_dur <= 0:
        return merged

    result: List[Segment] = []
    i = 0
    while i < len(merged):
        seg = merged[i]
        dur = seg.end - seg.start
        if dur < min_dur and i + 1 < len(merged):
            nxt = merged[i + 1]
            combined_text = (seg.text + " " + nxt.text).strip()
            combined_dur = nxt.end - seg.start
            if (
                len(combined_text) <= config.max_cue_chars
                and combined_dur <= config.max_cue_duration
            ):
                combined = Segment(words=seg.words + nxt.words)
                result.append(combined)
                i += 2
                continue
        result.append(seg)
        i += 1
    return result
