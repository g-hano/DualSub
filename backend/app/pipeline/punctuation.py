"""Light rule-based punctuation for translated subtitle lines."""
from __future__ import annotations

from typing import List

_SENTENCE_END = {".", "!", "?", "…"}


def add_punctuation(texts: List[str]) -> List[str]:
    """Ensure each non-empty line ends with sentence punctuation."""
    result: List[str] = []
    for text in texts:
        t = text.strip()
        if not t:
            result.append(t)
            continue
        if t[-1] not in _SENTENCE_END:
            t = t + "."
        result.append(t)
    return result
