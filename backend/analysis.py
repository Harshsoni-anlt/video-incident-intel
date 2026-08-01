# SPDX-License-Identifier: Apache-2.0
"""The run: frames in, observations and incidents out.

Also holds the two bits of logic that are easy to get wrong and so are tested
directly — deciding whether an answer trips a check, and collapsing a burst of
consecutive trips into one incident instead of fifty.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from typing import Any, Sequence

import numpy as np

from . import config, db, pipeline, vision

log = logging.getLogger(__name__)

# Below this the model is guessing; don't file an incident on a guess.
MIN_INCIDENT_CONFIDENCE = 0.55
# Trips of the same check closer together than this are one event.
INCIDENT_MERGE_GAP_S = 30.0

_NUM = re.compile(r"-?\d+(?:\.\d+)?")
_COMPARISON = re.compile(r"^\s*(>=|<=|>|<|==|=)\s*(-?\d+(?:\.\d+)?)\s*$")


def to_number(value: str | None) -> float | None:
    """First number in a string. Models say "about 6 boxes" more often than "6"."""
    if value is None:
        return None
    m = _NUM.search(str(value))
    return float(m.group()) if m else None


# The model says one of these when the subject of the check is not in shot.
# Treating them as "false" is what turns an empty frame into a false incident.
NOT_APPLICABLE = {"n/a", "na", "n.a.", "not applicable", "unknown", "none", "not visible", ""}


def trips(kind: str, trips_when: str | None, value: str | None) -> bool:
    """Does this answer count as a problem worth filing?"""
    if not trips_when or value is None:
        return False
    rule, val = trips_when.strip().lower(), str(value).strip().lower()
    if val in NOT_APPLICABLE:
        return False

    if kind == "bool":
        truthy = val in ("true", "yes", "1")
        return truthy if rule in ("true", "yes", "1") else (not truthy if rule in ("false", "no", "0") else False)

    if kind == "count":
        n = to_number(val)
        m = _COMPARISON.match(rule)
        if n is None or not m:
            return False
        op, target = m.group(1), float(m.group(2))
        return {">": n > target, "<": n < target, ">=": n >= target,
                "<=": n <= target, "==": n == target, "=": n == target}[op]

    if kind in ("category", "text"):
        return any(val == w.strip() for w in rule.split(",") if w.strip())

    return False


def merge_incidents(tripped: Sequence[dict], gap_s: float = INCIDENT_MERGE_GAP_S) -> list[dict]:
    """Collapse consecutive trips of the same check into single events.

    A forklift near-miss lasting eight seconds trips eight consecutive frames.
    That is one incident, reported at its start, not eight.
    """
    by_check: dict[int, list[dict]] = {}
    for o in sorted(tripped, key=lambda o: (o["check_id"], o["ts_s"])):
        by_check.setdefault(o["check_id"], []).append(o)

    out: list[dict] = []
    for obs in by_check.values():
        group = [obs[0]]
        for o in obs[1:]:
            if o["ts_s"] - group[-1]["ts_s"] <= gap_s:
                group.append(o)
            else:
                out.append(_fold(group))
                group = [o]
        out.append(_fold(group))
    return sorted(out, key=lambda i: i["ts_s"])


def _fold(group: list[dict]) -> dict:
    best = max(group, key=lambda o: o.get("confidence") or 0)
    return {
        "check_id": group[0]["check_id"],
        "ts_s": group[0]["ts_s"],           # report when it started
        "end_ts_s": group[-1]["ts_s"],
        "confidence": best.get("confidence") or 0,
        "frame_id": best["frame_id"],
        "count": len(group),
    }


def cosine_top_k(query: np.ndarray, matrix: np.ndarray, k: int) -> list[int]:
    """Indices of the k closest rows.

    ponytail: a plain numpy scan. A few hundred frames per video makes a vector
    database pure overhead; revisit past ~100k frames.
    """
    if matrix.size == 0:
        return []
    q = query / (np.linalg.norm(query) + 1e-9)
    m = matrix / (np.linalg.norm(matrix, axis=1, keepdims=True) + 1e-9)
    scores = m @ q
    return np.argsort(-scores)[:k].tolist()


# --- The run --------------------------------------------------------------

def _set(run_id: int, **fields) -> None:
    cols = ", ".join(f"{k}=?" for k in fields)
    db.execute(f"UPDATE runs SET {cols} WHERE id=?", (*fields.values(), run_id))


async def run_analysis(video_id: int, run_id: int, profile: str, mode: str = "filtered") -> None:
    """Full pipeline for one video. Updates `runs` as it goes so the UI can
    show progress; never raises — failures land in runs.error."""
    started = time.monotonic()
    try:
        video = db.one("SELECT * FROM videos WHERE id=?", (video_id,))
        if not video:
            raise ValueError(f"video {video_id} not found")

        checks = db.query(
            "SELECT * FROM checks WHERE profile=? AND active=1 ORDER BY id", (profile,)
        )
        if not checks:
            raise ValueError(f"Profile {profile!r} has no active checks.")

        db.execute("UPDATE videos SET status='analyzing', error=NULL WHERE id=?", (video_id,))

        # Re-analysing replaces the previous result, it does not add to it.
        # Without this the timeline shows two frames per timestamp and every
        # re-run duplicates the incidents. Observations cascade from frames.
        db.execute("DELETE FROM frames WHERE video_id=? AND run_id<>?", (video_id, run_id))
        db.execute("DELETE FROM incidents WHERE video_id=?", (video_id,))

        _set(run_id, stage="Decoding and filtering frames", progress=0.05)

        # Blocking OpenCV work — keep it off the event loop.
        frames, stats = await asyncio.to_thread(
            pipeline.extract, video["stored_path"], keep_every_frame=(mode == "every_frame")
        )
        if not frames:
            raise ValueError("No frames could be read from this video.")

        thumbs = await asyncio.to_thread(pipeline.save_thumbs, video_id, frames)
        _set(run_id, stage="Frames selected", progress=0.15,
             frames_total=stats["frames_total"], frames_sampled=stats["frames_sampled"],
             frames_kept=stats["frames_kept"])

        frame_ids: list[int] = [
            db.execute(
                "INSERT INTO frames (video_id, run_id, ts_s, thumb, motion_score) VALUES (?,?,?,?,?)",
                (video_id, run_id, f.ts_s, thumb, f.motion_score),
            )
            for f, thumb in zip(frames, thumbs)
        ]

        # --- Describe, batched -------------------------------------------
        batches = [
            list(range(i, min(i + config.FRAMES_PER_CALL, len(frames))))
            for i in range(0, len(frames), config.FRAMES_PER_CALL)
        ]
        api_calls = tokens = 0
        descriptions: dict[int, str] = {}
        obs_rows: list[tuple] = []

        for bi, idxs in enumerate(batches):
            _set(run_id, stage=f"Analysing frames ({bi + 1}/{len(batches)} batches)",
                 progress=0.15 + 0.65 * bi / max(len(batches), 1))
            batch = [(frames[i].ts_s, frames[i].jpeg) for i in idxs]
            results, used = await vision.analyse_frames(batch, checks)
            api_calls += 1
            tokens += used
            _set(run_id, api_calls=api_calls, tokens_est=tokens)

            by_idx = {r.get("frame", n): r for n, r in enumerate(results)}
            for n, i in enumerate(idxs):
                r = by_idx.get(n)
                if not r:
                    continue
                descriptions[i] = r.get("description", "")
                for a in r.get("answers", []):
                    chk = next((c for c in checks if c["id"] == a.get("id")), None)
                    if not chk:
                        continue
                    val = str(a.get("value", "")).strip()
                    conf = float(a.get("confidence") or 0)
                    obs_rows.append((
                        video_id, run_id, frame_ids[i], chk["id"], frames[i].ts_s,
                        val, to_number(val),
                        int(trips(chk["kind"], chk["trips_when"], val)), conf, None,
                    ))

        db.executemany(
            "INSERT INTO observations (video_id, run_id, frame_id, check_id, ts_s, value, "
            "value_num, tripped, confidence, note) VALUES (?,?,?,?,?,?,?,?,?,?)", obs_rows,
        )
        for i, text in descriptions.items():
            db.execute("UPDATE frames SET description=? WHERE id=?", (text, frame_ids[i]))

        # --- Index for plain-language search ------------------------------
        _set(run_id, stage="Indexing descriptions", progress=0.85)
        ordered = sorted(descriptions)
        vectors = await vision.embed([descriptions[i] for i in ordered])
        for i, vec in zip(ordered, vectors):
            db.execute("UPDATE frames SET embedding=? WHERE id=?", (db.pack(vec), frame_ids[i]))

        # --- File incidents ----------------------------------------------
        _set(run_id, stage="Filing incidents", progress=0.93)
        tripped = db.query(
            "SELECT check_id, ts_s, confidence, frame_id FROM observations "
            "WHERE run_id=? AND tripped=1 AND confidence >= ?",
            (run_id, MIN_INCIDENT_CONFIDENCE),
        )
        by_id = {c["id"]: c for c in checks}
        thumb_of = {fid: t for fid, t in zip(frame_ids, thumbs)}
        for inc in merge_incidents(tripped):
            chk = by_id.get(inc["check_id"], {})
            span = inc["end_ts_s"] - inc["ts_s"]
            # Read the label if the check has one. The raw question is phrased
            # as an interrogation, which reads wrong on a finding: an incident
            # should say "Person near a moving forklift", not ask whether one is.
            what = chk.get("label") or chk.get("question") or "Check tripped"
            detail = f"{what} — at {_hms(inc['ts_s'])}"
            if span >= 1:
                detail += f", for {span:.0f}s"
            db.execute(
                "INSERT INTO incidents (video_id, check_id, ts_s, severity, description, "
                "thumb, confidence) VALUES (?,?,?,?,?,?,?)",
                (video_id, inc["check_id"], inc["ts_s"], chk.get("severity", "low"),
                 detail, thumb_of.get(inc["frame_id"]), inc["confidence"]),
            )

        _set(run_id, status="done", stage="Complete", progress=1.0,
             seconds_elapsed=time.monotonic() - started,
             finished_at=_now())
        db.execute("UPDATE videos SET status='ready' WHERE id=?", (video_id,))
        log.info("run %s done: %s frames, %s API calls, %s tokens",
                 run_id, len(frames), api_calls, tokens)

    except Exception as e:                       # noqa: BLE001 — surfaced to the UI
        log.exception("analysis run %s failed", run_id)
        _set(run_id, status="failed", error=str(e)[:1000],
             seconds_elapsed=time.monotonic() - started, finished_at=_now())
        db.execute("UPDATE videos SET status='failed', error=? WHERE id=?", (str(e)[:1000], video_id))


def _now() -> str:
    return db.one("SELECT datetime('now') AS n")["n"]


def _hms(seconds: float) -> str:
    s = int(seconds)
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


# --- Plain-language search ------------------------------------------------

async def ask(video_id: int, question: str, k: int = 8) -> dict[str, Any]:
    """Answer a question about one video, citing the frames it used."""
    frames = db.query(
        "SELECT id, ts_s, thumb, description, embedding FROM frames "
        "WHERE video_id=? AND description IS NOT NULL ORDER BY ts_s", (video_id,)
    )
    if not frames:
        return {"answer": "This video has not been analysed yet.", "citations": []}

    vecs = [(i, db.unpack(f["embedding"])) for i, f in enumerate(frames) if f["embedding"]]
    picked: list[int] = []
    if vecs:
        qv = await vision.embed([question])
        if qv:
            matrix = np.vstack([v for _, v in vecs])
            picked = [vecs[j][0] for j in cosine_top_k(np.asarray(qv[0], np.float32), matrix, k)]
    if not picked:
        # No embeddings (offline, or the embed call failed): keyword fallback.
        words = {w for w in re.findall(r"\w+", question.lower()) if len(w) > 3}
        scored = sorted(
            range(len(frames)),
            key=lambda i: -sum(w in (frames[i]["description"] or "").lower() for w in words),
        )
        picked = scored[:k]

    picked = sorted(set(picked))
    cited = [frames[i] for i in picked]
    context = "\n".join(f"[{_hms(f['ts_s'])}] {f['description']}" for f in cited)

    # Tripped checks are stronger evidence than a description; include them.
    trips_rows = db.query(
        "SELECT o.ts_s, c.question, o.value FROM observations o JOIN checks c ON c.id=o.check_id "
        "WHERE o.video_id=? AND o.tripped=1 ORDER BY o.ts_s LIMIT 40", (video_id,)
    )
    if trips_rows:
        context += "\n\nChecks that flagged:\n" + "\n".join(
            f"[{_hms(r['ts_s'])}] {r['question']} → {r['value']}" for r in trips_rows
        )

    answer = await vision.compose(
        f"Camera observations:\n{context}\n\nQuestion: {question}",
        system=(
            "You answer questions about warehouse camera footage using only the observations "
            "given. Cite timestamps in [HH:MM:SS] form. If the observations do not contain the "
            "answer, say so plainly — never infer events that were not observed. Be brief."
        ),
    )
    return {
        "answer": answer or "The model did not return an answer.",
        "citations": [
            {"frame_id": f["id"], "ts_s": f["ts_s"], "thumb": f["thumb"],
             "description": f["description"], "time": _hms(f["ts_s"])}
            for f in cited
        ],
    }


if __name__ == "__main__":
    # bool
    assert trips("bool", "true", "true")
    assert trips("bool", "true", "Yes")
    assert not trips("bool", "true", "false")
    assert trips("bool", "false", "false"), "a missing vest must trip a trips_when=false check"
    assert not trips("bool", "false", "true")
    assert not trips("bool", "", "true"), "empty rule must never trip"

    # The regression that filed a high-severity "no hi-vis vest" incident against
    # a frame containing no people at all. "Nobody is here" is not "nobody is
    # compliant", and a demo that reports false findings is worse than one that
    # finds nothing.
    assert not trips("bool", "false", "n/a"), "an absent subject must never file an incident"
    assert not trips("bool", "false", "not visible")
    assert not trips("bool", "true", "n/a")
    assert not trips("text", "damaged", "n/a")

    # count — models pad numbers with words
    assert trips("count", ">3", "6")
    assert trips("count", ">3", "about 6 boxes")
    assert not trips("count", ">3", "2")
    assert trips("count", "<1", "0")
    assert not trips("count", ">3", "no idea")

    # category
    assert trips("category", "damaged,crushed", "damaged")
    assert not trips("category", "damaged,crushed", "intact")

    # a burst of consecutive trips is one incident, not many
    burst = [{"check_id": 1, "ts_s": float(t), "confidence": 0.9, "frame_id": t} for t in range(8)]
    later = [{"check_id": 1, "ts_s": 300.0, "confidence": 0.7, "frame_id": 99}]
    other = [{"check_id": 2, "ts_s": 2.0, "confidence": 0.8, "frame_id": 2}]
    merged = merge_incidents(burst + later + other)
    assert len(merged) == 3, f"expected 3 incidents (burst, later, other check), got {len(merged)}"
    assert merged[0]["ts_s"] == 0.0 and merged[0]["count"] == 8
    assert any(m["ts_s"] == 300.0 for m in merged), "a gap must start a new incident"

    # cosine ranks the identical vector first
    mat = np.array([[1.0, 0], [0, 1.0], [0.7, 0.7]], np.float32)
    assert cosine_top_k(np.array([0, 1.0], np.float32), mat, 2)[0] == 1

    assert _hms(3725) == "01:02:05"
    print("ok — trip rules, incident merging, cosine ranking and timestamps all behave")
