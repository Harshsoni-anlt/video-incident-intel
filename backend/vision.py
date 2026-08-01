# SPDX-License-Identifier: Apache-2.0
"""Vision + text calls. Gemini over plain REST; Ollama for the offline path.

Everything here is batched. The free tier limits *requests per day* far more
tightly than tokens, so packing 12 frames into one call is what makes a
few-hundred-frame video affordable. Gemini accepts up to 3,600 images per
request, and at low media resolution each frame costs 66 tokens instead of 258.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import random
from typing import Any, Sequence

import httpx

from . import config

log = logging.getLogger(__name__)

# Free tiers 429 readily. Back off and retry rather than failing a whole run.
_MAX_RETRIES = 5
_TIMEOUT = httpx.Timeout(180.0, connect=15.0)


class VisionError(RuntimeError):
    pass


# --- HTTP with retry ------------------------------------------------------

async def _post(client: httpx.AsyncClient, url: str, payload: dict) -> dict:
    last = ""
    for attempt in range(_MAX_RETRIES):
        try:
            r = await client.post(url, json=payload)
        except httpx.RequestError as e:
            last = f"network error: {e}"
        else:
            if r.status_code == 200:
                return r.json()
            last = f"HTTP {r.status_code}: {r.text[:400]}"
            # 400 is our bug, not a blip — don't burn retries on it.
            if r.status_code == 400:
                raise VisionError(last)
            if r.status_code in (401, 403):
                raise VisionError(f"{last}\nCheck GEMINI_API_KEY / GOOGLE_API_KEY is valid.")
        # 429 and 5xx: exponential backoff with jitter
        wait = min(2 ** attempt, 30) + random.random()
        log.warning("vision call failed (%s), retrying in %.1fs", last, wait)
        await asyncio.sleep(wait)
    raise VisionError(f"Gave up after {_MAX_RETRIES} attempts. Last error — {last}")


# --- Prompt construction --------------------------------------------------

_KIND_HINT = {
    # "n/a" is load-bearing. Without it the model answers "false" both when a
    # rule is broken and when the subject simply is not in shot, and every
    # empty frame files a false incident.
    "bool": 'answer exactly "true", "false", or "n/a" if what the question asks about is not present in the frame',
    "count": 'answer with a whole number only, or "0" if none are visible',
    "category": "answer with exactly one of: {options}",
    "text": 'answer with a short phrase, at most 8 words, or "n/a" if not visible',
}


def _check_lines(checks: Sequence[dict]) -> str:
    out = []
    for c in checks:
        hint = _KIND_HINT.get(c["kind"], _KIND_HINT["text"])
        if c["kind"] == "category":
            opts = json.loads(c["options"]) if isinstance(c.get("options"), str) else (c.get("options") or [])
            hint = hint.format(options=", ".join(opts) if opts else "any short label")
        out.append(f'  {{"id": {c["id"]}}} {c["question"]} — {hint}')
    return "\n".join(out)


_SYSTEM = """You are reviewing still frames from a fixed warehouse security camera.

For every frame you are given, return:
  - a one-sentence factual description of what is happening
  - an answer to each numbered check

Rules:
- Report only what is visible. If something is not visible, say so rather than guessing.
- A check about people, vehicles or equipment that are not in the frame is "n/a",
  never "false". "false" means you can see the subject and the condition does not hold.
- confidence is 0.0-1.0 and should reflect how clearly you can see the answer, not how likely it is in general.
- Return one result object per frame, in the order the frames were given.
"""

_RESPONSE_SCHEMA = {
    "type": "ARRAY",
    "items": {
        "type": "OBJECT",
        "properties": {
            "frame": {"type": "INTEGER"},
            "description": {"type": "STRING"},
            "answers": {
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "properties": {
                        "id": {"type": "INTEGER"},
                        "value": {"type": "STRING"},
                        "confidence": {"type": "NUMBER"},
                    },
                    "required": ["id", "value", "confidence"],
                },
            },
        },
        "required": ["frame", "description", "answers"],
    },
}


# --- Gemini ---------------------------------------------------------------

def _gemini_url(model: str, method: str) -> str:
    # The key goes in a header, not the query string: anything that logs or
    # reports a URL (httpx, tracebacks, the UI's error box) would otherwise
    # carry the secret with it.
    return f"{config.GEMINI_BASE}/models/{model}:{method}"


def _client() -> httpx.AsyncClient:
    headers = {"x-goog-api-key": config.GEMINI_API_KEY} if config.GEMINI_API_KEY else {}
    return httpx.AsyncClient(timeout=_TIMEOUT, headers=headers)


async def _gemini_frames(
    client: httpx.AsyncClient, batch: list[tuple[float, bytes]], checks: Sequence[dict]
) -> tuple[list[dict], int]:
    parts: list[dict] = [{
        "text": f"{len(batch)} frames follow, in time order, from one camera.\n"
                f"Timestamps: {', '.join(f'#{i}={ts:.1f}s' for i, (ts, _) in enumerate(batch))}\n\n"
                f"Checks to answer for every frame:\n{_check_lines(checks)}"
    }]
    for i, (_, jpeg) in enumerate(batch):
        parts.append({"text": f"Frame #{i}:"})
        parts.append({"inline_data": {"mime_type": "image/jpeg",
                                      "data": base64.b64encode(jpeg).decode()}})

    payload: dict[str, Any] = {
        "systemInstruction": {"parts": [{"text": _SYSTEM}]},
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "temperature": 0.1,
            "responseMimeType": "application/json",
            "responseSchema": _RESPONSE_SCHEMA,
            "mediaResolution": config.MEDIA_RESOLUTION,
        },
    }
    url = _gemini_url(config.VISION_MODEL, "generateContent")
    try:
        data = await _post(client, url, payload)
    except VisionError as e:
        # mediaResolution is Gemini-3-and-later. Older models 400 on it; the
        # run should still complete, just at 258 tokens/frame instead of 66.
        if "mediaResolution" not in str(e):
            raise
        log.warning("model rejected mediaResolution — retrying at default resolution")
        payload["generationConfig"].pop("mediaResolution")
        data = await _post(client, url, payload)

    tokens = int(data.get("usageMetadata", {}).get("totalTokenCount", 0))
    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        return json.loads(text), tokens
    except (KeyError, IndexError, json.JSONDecodeError) as e:
        finish = (data.get("candidates") or [{}])[0].get("finishReason", "?")
        raise VisionError(f"Could not parse model response (finishReason={finish}): {e}")


# --- Ollama (offline path) ------------------------------------------------

async def _ollama_frames(
    client: httpx.AsyncClient, batch: list[tuple[float, bytes]], checks: Sequence[dict]
) -> tuple[list[dict], int]:
    """Local vision models handle one image at a time; no batching to be had."""
    results = []
    prompt = (
        "Describe this warehouse camera frame in one sentence, then answer each check.\n"
        f"Checks:\n{_check_lines(checks)}\n\n"
        'Reply with JSON only: {"description": "...", '
        '"answers": [{"id": <id>, "value": "...", "confidence": 0.0}]}'
    )
    for i, (_, jpeg) in enumerate(batch):
        r = await client.post(
            f"{config.OLLAMA_BASE_URL}/api/generate",
            json={"model": config.OLLAMA_VISION_MODEL, "prompt": prompt,
                  "images": [base64.b64encode(jpeg).decode()],
                  "format": "json", "stream": False, "options": {"temperature": 0.1}},
        )
        if r.status_code != 200:
            raise VisionError(
                f"Ollama returned HTTP {r.status_code}. Is it running, and have you run "
                f"`ollama pull {config.OLLAMA_VISION_MODEL}`?"
            )
        try:
            obj = json.loads(r.json().get("response", "{}"))
        except json.JSONDecodeError:
            obj = {}
        results.append({"frame": i,
                        "description": obj.get("description", ""),
                        "answers": obj.get("answers", [])})
    return results, 0


async def analyse_frames(
    batch: list[tuple[float, bytes]], checks: Sequence[dict]
) -> tuple[list[dict], int]:
    """One vision request for a batch of (timestamp, jpeg) frames."""
    if not batch:
        return [], 0
    async with _client() as client:
        if config.VISION_PROVIDER == "ollama":
            return await _ollama_frames(client, batch, checks)
        return await _gemini_frames(client, batch, checks)


# --- Embeddings -----------------------------------------------------------

EMBED_DIM = 768


async def embed(texts: Sequence[str]) -> list[list[float]]:
    """Embed frame descriptions so plain-language search can find them.

    Returns [] when embeddings are unavailable — search then falls back to
    keyword matching rather than the whole feature disappearing.
    """
    texts = [t or " " for t in texts]
    if not texts or config.VISION_PROVIDER != "gemini" or not config.GEMINI_API_KEY:
        return []
    out: list[list[float]] = []
    async with _client() as client:
        for i in range(0, len(texts), 100):          # API caps a batch at 100
            chunk = texts[i:i + 100]
            payload = {"requests": [
                {"model": f"models/{config.EMBED_MODEL}",
                 "content": {"parts": [{"text": t}]},
                 "outputDimensionality": EMBED_DIM}
                for t in chunk
            ]}
            try:
                data = await _post(client, _gemini_url(config.EMBED_MODEL, "batchEmbedContents"), payload)
            except VisionError as e:
                log.warning("embeddings unavailable, search will use keywords only: %s", e)
                return []
            out.extend(e.get("values", []) for e in data.get("embeddings", []))
    return out


# --- Text generation ------------------------------------------------------

async def compose(prompt: str, system: str = "") -> str:
    """Plain text completion — used to turn retrieved frames into an answer."""
    if config.VISION_PROVIDER == "ollama":
        async with _client() as client:
            r = await client.post(
                f"{config.OLLAMA_BASE_URL}/api/generate",
                json={"model": config.OLLAMA_VISION_MODEL, "prompt": f"{system}\n\n{prompt}",
                      "stream": False},
            )
            return r.json().get("response", "") if r.status_code == 200 else ""

    payload: dict[str, Any] = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.2},
    }
    if system:
        payload["systemInstruction"] = {"parts": [{"text": system}]}
    async with _client() as client:
        data = await _post(client, _gemini_url(config.VISION_MODEL, "generateContent"), payload)
    try:
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError):
        return ""
