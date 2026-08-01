# SPDX-License-Identifier: Apache-2.0
"""SQLite storage. Plain stdlib sqlite3 — one file, no server, no ORM.

Schema in one sentence: a *video* gets an analysis *run*; a run keeps the
*frames* that survived the motion filter; each frame is scored against the
*checks* the user defined, producing *observations*; observations that trip a
severity threshold become *incidents*.
"""

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any, Iterable

import numpy as np

from . import config

SCHEMA = """
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS videos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  filename     TEXT NOT NULL,
  stored_path  TEXT NOT NULL,
  duration_s   REAL,
  fps          REAL,
  width        INTEGER,
  height       INTEGER,
  size_bytes   INTEGER,
  status       TEXT NOT NULL DEFAULT 'uploaded',   -- uploaded|analyzing|ready|failed
  error        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS checks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  profile     TEXT NOT NULL,
  question    TEXT NOT NULL,          -- plain language, sent to the vision model
  kind        TEXT NOT NULL,          -- bool | count | category | text
  options     TEXT,                   -- JSON array, for kind=category
  severity    TEXT NOT NULL DEFAULT 'low',   -- low|medium|high|critical
  -- What answer counts as a problem worth filing. bool: "true"/"false".
  -- count: ">3" / "<1". category: comma-separated values. Empty = never files.
  trips_when  TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  builtin     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id        INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  profile         TEXT NOT NULL,
  mode            TEXT NOT NULL DEFAULT 'filtered',  -- filtered | every_frame
  status          TEXT NOT NULL DEFAULT 'running',   -- running|done|failed
  stage           TEXT,
  progress        REAL NOT NULL DEFAULT 0,
  frames_total    INTEGER DEFAULT 0,   -- frames in the source video
  frames_sampled  INTEGER DEFAULT 0,   -- after fps downsampling
  frames_kept     INTEGER DEFAULT 0,   -- after the motion filter: what we paid for
  api_calls       INTEGER DEFAULT 0,
  tokens_est      INTEGER DEFAULT 0,
  seconds_elapsed REAL DEFAULT 0,
  error           TEXT,
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at     TEXT
);

CREATE TABLE IF NOT EXISTS frames (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id     INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  run_id       INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  ts_s         REAL NOT NULL,
  thumb        TEXT,
  motion_score REAL,
  description  TEXT,
  embedding    BLOB
);
CREATE INDEX IF NOT EXISTS idx_frames_video_ts ON frames(video_id, ts_s);

CREATE TABLE IF NOT EXISTS observations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id   INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  run_id     INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  frame_id   INTEGER NOT NULL REFERENCES frames(id) ON DELETE CASCADE,
  check_id   INTEGER NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
  ts_s       REAL NOT NULL,
  value      TEXT,      -- always the raw answer as text
  value_num  REAL,      -- parsed number, for kind=count
  tripped    INTEGER NOT NULL DEFAULT 0,
  confidence REAL,
  note       TEXT
);
CREATE INDEX IF NOT EXISTS idx_obs_video_check ON observations(video_id, check_id);

CREATE TABLE IF NOT EXISTS incidents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id    INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  check_id    INTEGER REFERENCES checks(id) ON DELETE SET NULL,
  ts_s        REAL NOT NULL,
  severity    TEXT NOT NULL,
  description TEXT NOT NULL,
  thumb       TEXT,
  confidence  REAL,
  exported_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_incidents_video ON incidents(video_id, ts_s);
"""

_local = threading.local()


def conn() -> sqlite3.Connection:
    """One connection per thread. FastAPI runs sync endpoints in a threadpool."""
    c = getattr(_local, "conn", None)
    if c is None:
        Path(config.DB_PATH).parent.mkdir(parents=True, exist_ok=True)
        c = sqlite3.connect(config.DB_PATH, check_same_thread=False)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA foreign_keys=ON")
        # Analysis runs write from a worker thread while the API reads from the
        # request thread; without this they race and raise "database is locked".
        c.execute("PRAGMA busy_timeout=10000")
        _local.conn = c
    return c


def query(sql: str, args: Iterable = ()) -> list[dict]:
    return [dict(r) for r in conn().execute(sql, tuple(args)).fetchall()]


def one(sql: str, args: Iterable = ()) -> dict | None:
    r = conn().execute(sql, tuple(args)).fetchone()
    return dict(r) if r else None


def execute(sql: str, args: Iterable = ()) -> int:
    """Run a write and commit. Returns lastrowid."""
    c = conn()
    cur = c.execute(sql, tuple(args))
    c.commit()
    return cur.lastrowid


def executemany(sql: str, rows: list[tuple]) -> None:
    c = conn()
    c.executemany(sql, rows)
    c.commit()


def pack(vec: list[float] | np.ndarray) -> bytes:
    return np.asarray(vec, dtype=np.float32).tobytes()


def unpack(blob: bytes | None) -> np.ndarray | None:
    if not blob:
        return None
    return np.frombuffer(blob, dtype=np.float32)


# --- Built-in check profiles ---------------------------------------------
# These are starting points, not the product. The point of the app is that a
# user writes their own questions; these just make the first run useful.

BUILTIN_PROFILES: dict[str, list[dict[str, Any]]] = {
    "Safety compliance": [
        {"question": "Is a person visible in this frame wearing a high-visibility vest? Answer no only if a person is visible without one.",
         "kind": "bool", "severity": "high", "trips_when": "false"},
        {"question": "Is a marked walkway, fire exit or emergency door blocked or obstructed by anything?",
         "kind": "bool", "severity": "critical", "trips_when": "true"},
        {"question": "Is a person standing or walking within roughly two metres of a moving forklift or vehicle?",
         "kind": "bool", "severity": "critical", "trips_when": "true"},
        {"question": "Are there visible spills, debris, or loose objects on the floor creating a trip hazard?",
         "kind": "bool", "severity": "medium", "trips_when": "true"},
        {"question": "Is anything stacked in a way that looks unstable or leaning?",
         "kind": "bool", "severity": "high", "trips_when": "true"},
    ],
    "Inventory count": [
        {"question": "How many boxes, cartons or packages are visible in this frame? Answer with a number only.",
         "kind": "count", "severity": "low", "trips_when": ""},
        {"question": "How many pallets are visible? Answer with a number only.",
         "kind": "count", "severity": "low", "trips_when": ""},
        {"question": "How many people are visible? Answer with a number only.",
         "kind": "count", "severity": "low", "trips_when": ""},
        {"question": "Are any storage racks or shelves completely empty?",
         "kind": "bool", "severity": "low", "trips_when": "true"},
    ],
    "Product identification": [
        {"question": "What type of goods or products are visible? Answer with a short noun phrase.",
         "kind": "text", "severity": "low", "trips_when": ""},
        {"question": "What is the dominant packaging type visible?",
         "kind": "category", "severity": "low",
         "options": ["cardboard boxes", "pallets", "crates", "drums", "sacks", "loose items", "none visible"],
         "trips_when": ""},
        {"question": "Is any packaging visibly damaged, crushed or torn open?",
         "kind": "bool", "severity": "medium", "trips_when": "true"},
    ],
    "Dock & congestion": [
        {"question": "Is a vehicle present at the loading dock?",
         "kind": "bool", "severity": "low", "trips_when": ""},
        {"question": "Is the loading bay area congested or blocked such that a vehicle could not pass?",
         "kind": "bool", "severity": "medium", "trips_when": "true"},
        {"question": "How many vehicles are visible? Answer with a number only.",
         "kind": "count", "severity": "low", "trips_when": ""},
    ],
}


def init(seed_builtins: bool = True) -> None:
    conn().executescript(SCHEMA)
    conn().commit()
    if seed_builtins and not one("SELECT 1 AS x FROM checks LIMIT 1"):
        rows = [
            (name, c["question"], c["kind"], json.dumps(c.get("options")) if c.get("options") else None,
             c["severity"], c.get("trips_when", ""), 1, 1)
            for name, checks in BUILTIN_PROFILES.items()
            for c in checks
        ]
        executemany(
            "INSERT INTO checks (profile, question, kind, options, severity, trips_when, active, builtin) "
            "VALUES (?,?,?,?,?,?,?,?)",
            rows,
        )
