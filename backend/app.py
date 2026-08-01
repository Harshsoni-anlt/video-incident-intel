# SPDX-License-Identifier: Apache-2.0
"""HTTP API.

One file on purpose — the whole surface fits on a screen or two, and splitting
it into a routers/ tree would add directories without adding clarity.
"""

from __future__ import annotations

import asyncio
import csv
import io
import json
import logging
import shutil
import sqlite3
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from . import analysis, config, db, pipeline

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
# httpx logs full request URLs at INFO, and Gemini takes its key as a query
# parameter — so this would print the API key on every call, into any log file
# or demo screen recording. Warnings still surface.
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("video-incident-intel")

# True while the first-run demo is being analysed, so the UI can say so rather
# than showing an empty dashboard that looks broken.
_seeding = False

DEMO_PROFILE = "Safety compliance"


def _demo_source() -> tuple[Path, str] | None:
    """Real footage if it has been fetched, otherwise None (caller synthesises).

    Preferring the near-miss clip is deliberate: it is the one where something
    actually happens, so the seeded dashboard has a real finding on it.
    """
    sample_dir = Path(config.DATA_DIR) / "sample"
    if not sample_dir.is_dir():
        return None
    clips = sorted(sample_dir.glob("*.mp4"))
    if not clips:
        return None
    best = next((c for c in clips if "nearmiss" in c.name.lower()), clips[0])
    return best, best.name


async def _seed_demo() -> None:
    """Analyse one clip on first run so the app opens with a working dashboard.

    This is a real analysis, not fixtures — the descriptions and incidents on
    screen are genuine model output, and it costs one API call.
    """
    global _seeding
    _seeding = True
    try:
        source = await asyncio.to_thread(_demo_source)
        if source:
            src, name = source
            dest = Path(config.UPLOAD_DIR) / f"demo-{uuid.uuid4().hex[:8]}{src.suffix}"
            # Copy rather than reference: deleting the demo from the UI must not
            # delete the footage the user fetched.
            await asyncio.to_thread(shutil.copy2, src, dest)
        else:
            name = "synthetic-warehouse-sample.mp4"
            dest = Path(config.UPLOAD_DIR) / f"demo-{uuid.uuid4().hex[:8]}.mp4"
            await asyncio.to_thread(pipeline.make_test_clip, dest, 30, 15)

        p = await asyncio.to_thread(pipeline.probe, dest)
        vid = db.execute(
            "INSERT INTO videos (filename, stored_path, duration_s, fps, width, height, size_bytes) "
            "VALUES (?,?,?,?,?,?,?)",
            (name, str(dest), p.duration_s, p.fps, p.width, p.height, dest.stat().st_size),
        )
        run_id = db.execute(
            "INSERT INTO runs (video_id, profile, mode, stage) VALUES (?,?,?,?)",
            (vid, DEMO_PROFILE, "filtered", "Queued"),
        )
        log.info("seeding the first-run demo from %s", name)
        await analysis.run_analysis(vid, run_id, DEMO_PROFILE, "filtered")
    except Exception:                              # noqa: BLE001
        # A failed seed must never stop the app booting — the user can still
        # upload their own footage, which is the point of the product anyway.
        log.exception("demo seeding failed; starting with an empty dashboard")
    finally:
        _seeding = False


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init()
    ok, why = config.vision_ready()
    log.info("vision provider %s: %s", config.VISION_PROVIDER, "ready" if ok else why)
    # Nothing analysed yet: prepare a demo so the first screen shows the product
    # working instead of an empty state. Backgrounded so startup is not blocked.
    if config.SEED_DEMO and ok and not db.one("SELECT 1 AS x FROM videos LIMIT 1"):
        asyncio.create_task(_seed_demo())
    yield


app = FastAPI(
    title="Video Incident Intelligence",
    description="Ask plain-language questions of camera footage. Bring your own video.",
    version="1.0.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ALLOWED_SUFFIXES = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"}

# Absolute paths on the host are nobody's business over HTTP — they leak the
# user's home directory into API responses and demo screenshots.
_HIDDEN = ("stored_path",)


def _public(row: dict | None) -> dict | None:
    return {k: v for k, v in row.items() if k not in _HIDDEN} if row else row


# --- Health ---------------------------------------------------------------

@app.get("/api/health")
def health() -> dict:
    ok, why = config.vision_ready()
    return {
        "status": "ok" if ok else "needs_key",
        "detail": why,
        "provider": config.VISION_PROVIDER,
        "vision_model": config.VISION_MODEL if config.VISION_PROVIDER == "gemini" else config.OLLAMA_VISION_MODEL,
        "sample_fps": config.SAMPLE_FPS,
        "motion_threshold": config.MOTION_THRESHOLD,
        "frames_per_call": config.FRAMES_PER_CALL,
        "max_frames": config.MAX_FRAMES,
        "warehouse_export": bool(config.WAREHOUSE_DB_PATH),
        "seeding": _seeding,
    }


# --- Videos ---------------------------------------------------------------

@app.get("/api/videos")
def list_videos() -> list[dict]:
    return [_public(r) for r in db.query("""
        SELECT v.*,
               (SELECT COUNT(*) FROM incidents i WHERE i.video_id = v.id) AS incident_count,
               (SELECT COUNT(*) FROM frames f WHERE f.video_id = v.id)    AS frame_count,
               (SELECT id FROM runs r WHERE r.video_id = v.id ORDER BY id DESC LIMIT 1) AS latest_run_id
        FROM videos v ORDER BY v.id DESC
    """)]


@app.post("/api/videos")
async def upload_video(file: UploadFile = File(...)) -> dict:
    """Bring your own footage. This is the point of the app, not a side door."""
    name = Path(file.filename or "upload.mp4").name
    suffix = Path(name).suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(400, f"{suffix or 'That file type'} is not supported. "
                                 f"Use one of: {', '.join(sorted(ALLOWED_SUFFIXES))}")

    dest = Path(config.UPLOAD_DIR) / f"{uuid.uuid4().hex}{suffix}"
    limit = config.MAX_UPLOAD_MB * 1024 * 1024
    size = 0
    try:
        with dest.open("wb") as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > limit:
                    raise HTTPException(413, f"File is larger than the {config.MAX_UPLOAD_MB} MB limit.")
                out.write(chunk)
    except Exception:
        dest.unlink(missing_ok=True)
        raise

    try:
        p = await asyncio.to_thread(pipeline.probe, dest)
    except ValueError as e:
        dest.unlink(missing_ok=True)
        raise HTTPException(400, str(e))

    vid = db.execute(
        "INSERT INTO videos (filename, stored_path, duration_s, fps, width, height, size_bytes) "
        "VALUES (?,?,?,?,?,?,?)",
        (name, str(dest), p.duration_s, p.fps, p.width, p.height, size),
    )
    return _public(db.one("SELECT * FROM videos WHERE id=?", (vid,)))


@app.post("/api/videos/sample")
async def create_sample() -> dict:
    """Add a sample clip to work with.

    Real footage if `scripts/fetch_sample.py` has been run, otherwise a
    generated one. The generated clip is an abstract test pattern — coloured
    shapes, no people, no shelving — so a check like "how many people are
    visible?" correctly answers zero on it. That is honest but reads as a
    broken app, hence `synthetic` in the response for the UI to warn about.
    """
    source = await asyncio.to_thread(_demo_source)
    if source:
        src, name = source
        dest = Path(config.UPLOAD_DIR) / f"sample-{uuid.uuid4().hex[:8]}{src.suffix}"
        await asyncio.to_thread(shutil.copy2, src, dest)
        synthetic = False
    else:
        name = "test-pattern.mp4"
        dest = Path(config.UPLOAD_DIR) / f"sample-{uuid.uuid4().hex[:8]}.mp4"
        await asyncio.to_thread(pipeline.make_test_clip, dest, 30, 15)
        synthetic = True

    p = await asyncio.to_thread(pipeline.probe, dest)
    vid = db.execute(
        "INSERT INTO videos (filename, stored_path, duration_s, fps, width, height, size_bytes) "
        "VALUES (?,?,?,?,?,?,?)",
        (name, str(dest), p.duration_s, p.fps, p.width, p.height, dest.stat().st_size),
    )
    out = _public(db.one("SELECT * FROM videos WHERE id=?", (vid,)))
    out["synthetic"] = synthetic
    return out


@app.get("/api/sample-status")
def sample_status() -> dict:
    """Whether real footage is available locally, for the UI to say so."""
    src = _demo_source()
    return {
        "has_real_footage": bool(src),
        "name": src[1] if src else None,
        "fetch_command": "python scripts/fetch_sample.py",
    }


@app.get("/api/videos/{video_id}")
def get_video(video_id: int) -> dict:
    v = db.one("SELECT * FROM videos WHERE id=?", (video_id,))
    if not v:
        raise HTTPException(404, "No such video")
    v = _public(v)
    v["runs"] = db.query("SELECT * FROM runs WHERE video_id=? ORDER BY id DESC", (video_id,))
    return v


@app.delete("/api/videos/{video_id}")
def delete_video(video_id: int) -> dict:
    v = db.one("SELECT * FROM videos WHERE id=?", (video_id,))
    if not v:
        raise HTTPException(404, "No such video")
    Path(v["stored_path"]).unlink(missing_ok=True)
    shutil.rmtree(Path(config.THUMB_DIR) / str(video_id), ignore_errors=True)
    db.execute("DELETE FROM videos WHERE id=?", (video_id,))
    return {"deleted": video_id}


@app.get("/api/videos/{video_id}/stream")
def stream_video(video_id: int):
    v = db.one("SELECT stored_path, filename FROM videos WHERE id=?", (video_id,))
    if not v or not Path(v["stored_path"]).exists():
        raise HTTPException(404, "No such video")
    # FileResponse handles Range requests, which is what lets the player seek
    # to an incident timestamp instead of downloading the whole file first.
    return FileResponse(v["stored_path"], media_type="video/mp4", filename=v["filename"])


@app.get("/api/thumbs/{path:path}")
def thumb(path: str):
    # Resolve and confine to the thumbnail root: `path` is user-influenced.
    root = Path(config.THUMB_DIR).resolve()
    target = (root / path).resolve()
    if not target.is_relative_to(root) or not target.is_file():
        raise HTTPException(404, "No such thumbnail")
    return FileResponse(target, media_type="image/jpeg")


# --- Analysis -------------------------------------------------------------

class AnalyzeRequest(BaseModel):
    profile: str = "Safety compliance"
    mode: str = Field("filtered", pattern="^(filtered|every_frame)$")


@app.post("/api/videos/{video_id}/analyze")
def analyze(video_id: int, req: AnalyzeRequest, background: BackgroundTasks) -> dict:
    v = db.one("SELECT * FROM videos WHERE id=?", (video_id,))
    if not v:
        raise HTTPException(404, "No such video")
    if v["status"] == "analyzing":
        raise HTTPException(409, "This video is already being analysed.")
    # Validate the request before the environment: "that profile has no active
    # checks" is specific to what the user just did, whereas a missing key is a
    # setup problem the UI already reports in a banner on every screen.
    if not db.query("SELECT 1 FROM checks WHERE profile=? AND active=1", (req.profile,)):
        raise HTTPException(400, f"Profile {req.profile!r} has no active checks.")
    ok, why = config.vision_ready()
    if not ok:
        raise HTTPException(503, why)

    run_id = db.execute(
        "INSERT INTO runs (video_id, profile, mode, stage) VALUES (?,?,?,?)",
        (video_id, req.profile, req.mode, "Queued"),
    )
    background.add_task(analysis.run_analysis, video_id, run_id, req.profile, req.mode)
    return {"run_id": run_id, "video_id": video_id, "status": "running"}


@app.get("/api/runs/{run_id}")
def get_run(run_id: int) -> dict:
    r = db.one("SELECT * FROM runs WHERE id=?", (run_id,))
    if not r:
        raise HTTPException(404, "No such run")
    return r


@app.get("/api/videos/{video_id}/timeline")
def timeline(video_id: int) -> dict:
    """Everything the timeline view needs in one round trip."""
    frames = db.query(
        "SELECT id, ts_s, thumb, description, motion_score FROM frames "
        "WHERE video_id=? ORDER BY ts_s", (video_id,)
    )
    obs = db.query("""
        SELECT o.*, c.question, c.label, c.kind, c.severity
        FROM observations o JOIN checks c ON c.id = o.check_id
        WHERE o.video_id=? ORDER BY o.ts_s
    """, (video_id,))
    by_frame: dict[int, list[dict]] = {}
    for o in obs:
        by_frame.setdefault(o["frame_id"], []).append(o)
    for f in frames:
        f["observations"] = by_frame.get(f["id"], [])
    return {
        "video": _public(db.one("SELECT * FROM videos WHERE id=?", (video_id,))),
        "frames": frames,
        "incidents": db.query(
            "SELECT i.*, c.question, c.label FROM incidents i LEFT JOIN checks c ON c.id=i.check_id "
            "WHERE i.video_id=? ORDER BY i.ts_s", (video_id,)
        ),
    }


class AskRequest(BaseModel):
    question: str = Field(min_length=2, max_length=500)
    k: int = Field(8, ge=1, le=30)


@app.post("/api/videos/{video_id}/ask")
async def ask(video_id: int, req: AskRequest) -> dict:
    if not db.one("SELECT 1 AS x FROM videos WHERE id=?", (video_id,)):
        raise HTTPException(404, "No such video")
    ok, why = config.vision_ready()
    if not ok:
        raise HTTPException(503, why)
    return await analysis.ask(video_id, req.question, req.k)


# --- Checks: the part users actually build -------------------------------

class CheckIn(BaseModel):
    profile: str = Field(min_length=1, max_length=80)
    question: str = Field(min_length=5, max_length=400)
    label: str | None = Field(None, max_length=80)
    kind: str = Field("bool", pattern="^(bool|count|category|text)$")
    options: list[str] | None = None
    severity: str = Field("medium", pattern="^(low|medium|high|critical)$")
    trips_when: str = ""
    active: bool = True


@app.get("/api/profiles")
def profiles() -> list[dict]:
    return db.query("""
        SELECT profile,
               COUNT(*)                      AS check_count,
               SUM(active)                   AS active_count,
               MIN(builtin)                  AS all_custom
        FROM checks GROUP BY profile ORDER BY profile
    """)


@app.get("/api/checks")
def list_checks(profile: str | None = None) -> list[dict]:
    rows = (db.query("SELECT * FROM checks WHERE profile=? ORDER BY id", (profile,))
            if profile else db.query("SELECT * FROM checks ORDER BY profile, id"))
    for r in rows:
        r["options"] = json.loads(r["options"]) if r["options"] else None
    return rows


@app.post("/api/checks")
def create_check(c: CheckIn) -> dict:
    cid = db.execute(
        "INSERT INTO checks (profile, question, label, kind, options, severity, trips_when, active, builtin) "
        "VALUES (?,?,?,?,?,?,?,?,0)",
        (c.profile, c.question, c.label or None, c.kind,
         json.dumps(c.options) if c.options else None,
         c.severity, c.trips_when, int(c.active)),
    )
    return db.one("SELECT * FROM checks WHERE id=?", (cid,))


@app.put("/api/checks/{check_id}")
def update_check(check_id: int, c: CheckIn) -> dict:
    if not db.one("SELECT 1 AS x FROM checks WHERE id=?", (check_id,)):
        raise HTTPException(404, "No such check")
    db.execute(
        "UPDATE checks SET profile=?, question=?, label=?, kind=?, options=?, severity=?, "
        "trips_when=?, active=? WHERE id=?",
        (c.profile, c.question, c.label or None, c.kind,
         json.dumps(c.options) if c.options else None,
         c.severity, c.trips_when, int(c.active), check_id),
    )
    return db.one("SELECT * FROM checks WHERE id=?", (check_id,))


@app.delete("/api/checks/{check_id}")
def delete_check(check_id: int) -> dict:
    if not db.one("SELECT 1 AS x FROM checks WHERE id=?", (check_id,)):
        raise HTTPException(404, "No such check")
    db.execute("DELETE FROM checks WHERE id=?", (check_id,))
    return {"deleted": check_id}


# --- Incidents ------------------------------------------------------------

@app.get("/api/incidents")
def list_incidents(
    video_id: int | None = None,
    severity: str | None = None,
    limit: int = Query(200, ge=1, le=1000),
) -> list[dict]:
    where, args = ["1=1"], []
    if video_id:
        where.append("i.video_id=?")
        args.append(video_id)
    if severity:
        where.append("i.severity=?")
        args.append(severity)
    args.append(limit)
    return db.query(f"""
        SELECT i.*, v.filename, c.question, c.label, c.kind
        FROM incidents i
        JOIN videos v ON v.id = i.video_id
        LEFT JOIN checks c ON c.id = i.check_id
        WHERE {' AND '.join(where)}
        ORDER BY i.created_at DESC, i.ts_s ASC LIMIT ?
    """, args)


@app.get("/api/incidents/export.csv")
def export_csv(video_id: int | None = None) -> StreamingResponse:
    rows = list_incidents(video_id=video_id, limit=1000)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "video", "timestamp_s", "timestamp", "severity", "description",
                "confidence", "detected_at"])
    for r in rows:
        w.writerow([r["id"], r["filename"], round(r["ts_s"], 2), analysis._hms(r["ts_s"]),
                    r["severity"], r["description"], round(r["confidence"] or 0, 2),
                    r["created_at"]])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="incidents.csv"'},
    )


@app.post("/api/incidents/push-to-warehouse")
def push_to_warehouse(video_id: int | None = None) -> dict:
    """Write incidents into WarehouseOps AI's safety_incidents table.

    That app already reads this table, so a camera finding shows up when someone
    asks the assistant "show me recent safety incidents". Set WAREHOUSE_DB_PATH.
    """
    if not config.WAREHOUSE_DB_PATH:
        raise HTTPException(400, "WAREHOUSE_DB_PATH is not set. Point it at WarehouseOps AI's "
                                 "warehouse.db to enable this.")
    target = Path(config.WAREHOUSE_DB_PATH)
    if not target.exists():
        raise HTTPException(400, f"No database at {target}")

    rows = [r for r in list_incidents(video_id=video_id, limit=1000) if not r["exported_at"]]
    if not rows:
        return {"exported": 0, "detail": "Nothing new to export."}

    conn = sqlite3.connect(target)
    try:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(safety_incidents)")}
        if not cols:
            raise HTTPException(400, "That database has no safety_incidents table.")
        conn.executemany(
            "INSERT INTO safety_incidents (severity, description, reported_by, occurred_at) "
            "VALUES (?,?,?,datetime('now'))",
            [(r["severity"], f"[camera] {r['description']} ({r['filename']})",
              "video-incident-intel") for r in rows],
        )
        conn.commit()
    finally:
        conn.close()

    db.executemany("UPDATE incidents SET exported_at=datetime('now') WHERE id=?",
                   [(r["id"],) for r in rows])
    return {"exported": len(rows), "target": str(target)}


@app.delete("/api/incidents/{incident_id}")
def dismiss_incident(incident_id: int) -> dict:
    if not db.one("SELECT 1 AS x FROM incidents WHERE id=?", (incident_id,)):
        raise HTTPException(404, "No such incident")
    db.execute("DELETE FROM incidents WHERE id=?", (incident_id,))
    return {"dismissed": incident_id}


# --- Dashboard ------------------------------------------------------------

@app.get("/api/stats")
def stats() -> dict[str, Any]:
    totals = db.one("""
        SELECT COUNT(*) AS videos,
               COALESCE(SUM(duration_s), 0) AS seconds_of_footage,
               COALESCE(SUM(size_bytes), 0) AS bytes
        FROM videos
    """) or {}
    work = db.one("""
        SELECT COALESCE(SUM(frames_sampled), 0) AS sampled,
               COALESCE(SUM(frames_kept), 0)    AS sent,
               COALESCE(SUM(api_calls), 0)      AS api_calls,
               COALESCE(SUM(tokens_est), 0)     AS tokens,
               COALESCE(SUM(seconds_elapsed), 0) AS compute_seconds,
               COUNT(*) AS runs
        FROM runs WHERE status='done'
    """) or {}

    sampled, sent = work.get("sampled", 0) or 0, work.get("sent", 0) or 0
    return {
        "videos": totals.get("videos", 0),
        "seconds_of_footage": round(totals.get("seconds_of_footage") or 0, 1),
        "hours_of_footage": round((totals.get("seconds_of_footage") or 0) / 3600, 2),
        "runs": work.get("runs", 0),
        "frames_sampled": sampled,
        "frames_sent": sent,
        # The headline number: what the motion filter saved.
        "frames_skipped_pct": round(100 * (1 - sent / sampled), 1) if sampled else 0,
        "api_calls": work.get("api_calls", 0),
        "tokens": work.get("tokens", 0),
        "compute_seconds": round(work.get("compute_seconds") or 0, 1),
        "incidents_total": (db.one("SELECT COUNT(*) AS n FROM incidents") or {}).get("n", 0),
        "by_severity": db.query(
            "SELECT severity, COUNT(*) AS count FROM incidents GROUP BY severity"),
        "by_video": db.query("""
            SELECT v.id, v.filename, COUNT(i.id) AS incidents
            FROM videos v LEFT JOIN incidents i ON i.video_id = v.id
            GROUP BY v.id ORDER BY incidents DESC, v.id DESC LIMIT 10
        """),
        "top_checks": db.query("""
            SELECT COALESCE(c.label, c.question) AS question, c.severity, COUNT(o.id) AS trips
            FROM observations o JOIN checks c ON c.id = o.check_id
            WHERE o.tripped = 1 GROUP BY c.id ORDER BY trips DESC LIMIT 8
        """),
        "recent_incidents": db.query("""
            SELECT i.id, i.ts_s, i.severity, i.description, i.thumb, v.filename
            FROM incidents i JOIN videos v ON v.id = i.video_id
            ORDER BY i.created_at DESC, i.id DESC LIMIT 8
        """),
    }
