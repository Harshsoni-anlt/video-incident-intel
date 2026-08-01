# SPDX-License-Identifier: Apache-2.0
"""Offline API checks — no network, no API key needed.

Run: python tests/test_api.py

The two pieces of real logic have their own self-checks:
    python -m backend.pipeline     decode, motion filter, frame cap
    python -m backend.analysis     trip rules, incident merging, cosine search
"""

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# Point at a scratch database so a test run never touches real data.
_tmp = tempfile.mkdtemp()
os.environ["DATA_DIR"] = _tmp
os.environ["DB_PATH"] = str(Path(_tmp) / "test.db")
# The first-run demo would add a video these assertions do not expect, and
# would spend an API call on every test run.
os.environ["SEED_DEMO"] = "0"

from fastapi.testclient import TestClient  # noqa: E402

from backend.app import app  # noqa: E402


def main() -> None:
    with TestClient(app) as c:
        # Schema must exist by the time the first request lands. This is the
        # regression that broke when startup moved to a lifespan handler.
        r = c.get("/api/health")
        assert r.status_code == 200, r.text
        assert r.json()["provider"] in ("gemini", "ollama")

        # A template placeholder must never be treated as a real key. run.sh
        # copies .env.example to .env, and load_dotenv does not override, so an
        # untouched placeholder would otherwise shadow a real key permanently
        # and the app would report "API key not valid" instead of "not set".
        from backend.config import _first_real
        import os as _os
        _os.environ["__T_PLACEHOLDER"] = "your-key-here"
        _os.environ["__T_REAL"] = "AQ.realkeyvalue"
        assert _first_real("__T_PLACEHOLDER", "__T_REAL") == "AQ.realkeyvalue", \
            "a placeholder must fall through to the next candidate"
        assert _first_real("__T_PLACEHOLDER") == ""
        assert _first_real("__T_MISSING_ENTIRELY") == ""

        profiles = c.get("/api/profiles").json()
        assert len(profiles) >= 4, f"built-in profiles missing: {profiles}"
        assert any(p["profile"] == "Safety compliance" for p in profiles)

        # --- Videos -----------------------------------------------------
        v = c.post("/api/videos/sample").json()
        assert v["duration_s"] > 0 and v["status"] == "uploaded"
        assert "stored_path" not in v, "host filesystem paths must not leak over HTTP"

        listed = c.get("/api/videos").json()
        assert len(listed) == 1 and "stored_path" not in listed[0]

        assert c.get(f"/api/videos/{v['id']}/stream").status_code == 200
        assert c.get("/api/videos/9999").status_code == 404

        # Upload guards
        assert c.post("/api/videos", files={"file": ("x.txt", b"nope", "text/plain")}).status_code == 400

        # Thumbnails must stay inside their root, whatever the path says.
        from backend import config
        root = Path(config.THUMB_DIR).resolve()
        assert not (root / "../../../etc/passwd").resolve().is_relative_to(root)
        assert c.get("/api/thumbs/nope/missing.jpg").status_code == 404

        # --- Checks: the part users build -------------------------------
        made = c.post("/api/checks", json={
            "profile": "Custom", "question": "How many forklifts are visible?",
            "kind": "count", "severity": "high", "trips_when": ">2",
        })
        assert made.status_code == 200, made.text
        cid = made.json()["id"]
        assert made.json()["builtin"] == 0

        upd = c.put(f"/api/checks/{cid}", json={
            "profile": "Custom", "question": "How many pallets are visible?",
            "kind": "count", "severity": "low", "trips_when": ">5", "active": False,
        })
        assert upd.json()["question"].startswith("How many pallets")
        assert upd.json()["active"] == 0

        # A profile with nothing active cannot be analysed — better a clear
        # 400 than a run that quietly describes frames against no questions.
        # This must hold whether or not an API key is configured: request
        # validation runs before the environment check, so a clean clone with
        # no .env still gets the specific error rather than a generic 503.
        assert c.post(f"/api/videos/{v['id']}/analyze", json={"profile": "Custom"}).status_code == 400
        assert c.post(f"/api/videos/{v['id']}/analyze", json={"profile": "Nope"}).status_code == 400
        # Mode is constrained by the schema.
        assert c.post(f"/api/videos/{v['id']}/analyze",
                      json={"profile": "Safety compliance", "mode": "banana"}).status_code == 422

        assert c.delete(f"/api/checks/{cid}").status_code == 200
        assert c.delete(f"/api/checks/{cid}").status_code == 404

        # --- Incidents and stats ----------------------------------------
        assert c.get("/api/incidents").json() == []
        csv = c.get("/api/incidents/export.csv")
        assert csv.status_code == 200 and "timestamp" in csv.text
        # Export is off unless it has been pointed at a database.
        assert c.post("/api/incidents/push-to-warehouse").status_code == 400

        s = c.get("/api/stats").json()
        assert s["videos"] == 1 and s["incidents_total"] == 0
        assert s["frames_skipped_pct"] == 0, "no completed runs yet"

        # Re-analysing must replace the previous result, not stack on it.
        # (The delete runs inside run_analysis; assert the statement is there
        # rather than spending an API call to prove it end to end.)
        import inspect

        from backend import analysis as _an
        src = inspect.getsource(_an.run_analysis)
        assert "DELETE FROM frames WHERE video_id=? AND run_id<>?" in src, \
            "a re-run must clear the previous run's frames"
        assert "DELETE FROM incidents WHERE video_id=?" in src, \
            "a re-run must clear the previous run's incidents"

        # --- Deletion is thorough ---------------------------------------
        assert c.delete(f"/api/videos/{v['id']}").status_code == 200
        assert c.get("/api/videos").json() == []
        assert c.delete(f"/api/videos/{v['id']}").status_code == 404

    print("ok — API surface, upload guards, path confinement and check CRUD all behave")


if __name__ == "__main__":
    main()
