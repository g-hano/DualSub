"""Quality control for translations.

Strategy: take the source text and its translation, back-translate the
translation (tgt -> src), then ask an LM Studio LLM to compare the original
source with the back-translation. If meaning diverged, the LLM returns a
corrected translation; otherwise the original translation is kept.

Requests are sent in small batches (not the full transcript at once) to keep
prompts within context limits and reduce LM Studio channel errors.
"""
from __future__ import annotations

import json
import logging
import time
from typing import List, Sequence, Tuple

import httpx

from ..config import language_name
from .translate import get_translator

logger = logging.getLogger(__name__)

# Avoid angle-bracket placeholders — they confuse structured-output parsers
# and show up truncated in LM Studio logs.
_SYSTEM_PROMPT = (
    "You are a meticulous bilingual translation reviewer. You receive numbered "
    "subtitle pairs: original text, its machine translation, and a back-translation "
    "into the original language. For each item decide whether the translation "
    "preserves the meaning of the original.\n\n"
    "Respond ONLY with valid JSON in this exact shape:\n"
    '{"results": [{"id": 0, "ok": true, "correction": ""}]}\n\n'
    "Rules:\n"
    "- Include one entry per input id, in the same order.\n"
    "- ok: true when faithful; false when a correction is needed.\n"
    "- correction: empty string when ok is true; otherwise the improved translation.\n"
    "- No markdown, no code fences, no commentary."
)

# Pause between LM Studio requests to avoid rapid-fire channel errors.
_BATCH_DELAY_SEC = 0.4


def _chunked(items: Sequence, size: int):
    for i in range(0, len(items), size):
        yield i, items[i : i + size]


def _build_batch_prompt(
    batch: Sequence[Tuple[int, str, str, str]], src: str, tgt: str
) -> str:
    src_name = language_name(src) or src
    tgt_name = language_name(tgt) or tgt
    lines = [
        f"Review these {len(batch)} subtitle pairs ({src_name} -> {tgt_name}).",
        "",
    ]
    for item_id, src_text, translation, back in batch:
        lines.extend(
            [
                f"[{item_id}]",
                f"Original ({src_name}): {src_text}",
                f"Translation ({tgt_name}): {translation}",
                f"Back-translation ({src_name}): {back}",
                "",
            ]
        )
    lines.append("Return the JSON results array now.")
    return "\n".join(lines)


def _lmstudio_chat_url(lmstudio_url: str) -> str:
    """Resolve the native LM Studio chat endpoint from a configured base URL."""
    raw = lmstudio_url.rstrip("/")
    if raw.endswith("/chat/completions"):
        raw = raw[: -len("/chat/completions")]
    if raw.endswith("/api/v1/chat"):
        return raw
    if raw.endswith("/v1"):
        return raw[: -len("/v1")] + "/api/v1/chat"
    if raw.endswith("/api/v1"):
        return raw + "/chat"
    return raw + "/api/v1/chat"


def _extract_response_content(body: dict) -> str:
    if "error" in body:
        err = body["error"]
        message = err.get("message", err) if isinstance(err, dict) else err
        raise RuntimeError(message)
    parts: List[str] = []
    for item in body.get("output", []):
        if not isinstance(item, dict):
            continue
        if item.get("type") == "message":
            parts.append(str(item.get("content", "")))
    content = "".join(parts).strip()
    if not content:
        raise RuntimeError("Empty LM Studio response")
    return content


def _call_lmstudio(config, user_prompt: str, *, batch_size: int) -> dict:
    url = _lmstudio_chat_url(config.lmstudio_url)
    max_output_tokens = min(4096, 64 + batch_size * 80)
    payload = {
        "model": config.lmstudio_model,
        "system_prompt": _SYSTEM_PROMPT,
        "input": user_prompt,
        "temperature": 0.0,
        "max_output_tokens": max_output_tokens,
        "reasoning": "off",
        "store": False,
    }
    resp = httpx.post(url, json=payload, timeout=180.0)
    resp.raise_for_status()
    content = _extract_response_content(resp.json())
    return _parse_json(content)


def _parse_json(content: str) -> dict:
    start = content.find("{")
    end = content.rfind("}")
    if start != -1 and end != -1 and end > start:
        content = content[start : end + 1]
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        return {"results": []}
    if not isinstance(data, dict):
        return {"results": []}
    return data


def _apply_batch_verdicts(
    batch: Sequence[Tuple[int, str, str, str]],
    translations: List[str],
    verdict: dict,
) -> None:
    results = verdict.get("results")
    if not isinstance(results, list):
        return
    by_id = {
        item["id"]: item
        for item in results
        if isinstance(item, dict) and "id" in item
    }
    for item_id, _src_text, translation, _back in batch:
        item = by_id.get(item_id)
        if not item:
            continue
        if not item.get("ok", True) and item.get("correction"):
            translations[item_id] = str(item["correction"]).strip()


def quality_check(
    source_texts: List[str],
    translations: List[str],
    src: str,
    tgt: str,
    config,
) -> List[str]:
    """Return possibly-corrected translations, one per input."""
    if not config.qc_enabled or not translations:
        return translations

    back_translator = get_translator(config.translator_backend)
    back_translations = back_translator.translate(
        translations, tgt, src, batch_size=getattr(config, "translate_batch_size", 16)
    )

    corrected = list(translations)
    batch_size = max(1, config.qc_batch_size)
    triples = list(zip(source_texts, translations, back_translations))
    total_batches = (len(triples) + batch_size - 1) // batch_size

    for batch_idx, (start, chunk) in enumerate(_chunked(triples, batch_size)):
        batch = [
            (start + offset, src_text, translation, back)
            for offset, (src_text, translation, back) in enumerate(chunk)
        ]
        prompt = _build_batch_prompt(batch, src, tgt)
        try:
            verdict = _call_lmstudio(config, prompt, batch_size=len(batch))
            _apply_batch_verdicts(batch, corrected, verdict)
        except Exception as exc:
            logger.warning(
                "QC batch %d/%d failed (%d items), keeping originals: %s",
                batch_idx + 1,
                total_batches,
                len(batch),
                exc,
            )
        if batch_idx + 1 < total_batches:
            time.sleep(_BATCH_DELAY_SEC)

    return corrected
