#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Fetch one real warehouse clip from NVIDIA's PhysicalAI SDG-Warehouse dataset.

The dataset is 18 TiB and its shards are 1-5 GB each, but they are WebDataset
tars — sequential, so we can stream one and stop as soon as the first clip is
out. That pulls ~170 MB instead of the whole shard.

The footage is fully synthetic (rendered in Isaac Sim): no real people, no
privacy question. Licensed OpenMDW 1.1 — see NOTICE.

    python scripts/fetch_sample.py                    # near-miss (default)
    python scripts/fetch_sample.py --scenario fire
    python scripts/fetch_sample.py --list
"""

from __future__ import annotations

import argparse
import json
import sys
import tarfile
import urllib.request
from pathlib import Path

REPO = "nvidia/PhysicalAI-WorldModel-Synthetic-Warehouse-Operations-Scenes"
BASE = f"https://huggingface.co/datasets/{REPO}"
OUT = Path(__file__).resolve().parent.parent / "data" / "sample"

# Scenario -> the RGB directory holding its shards. All four are 10-15s runs
# at 1920x1080, 30fps, from fixed CCTV-style camera rigs.
SCENARIOS = {
    "nearmiss": ("rgb/forklift_human_nearmiss", "Forklift passes close to a worker"),
    "fire": ("rgb/warehouse_fire", "Ignition followed by worker evacuation"),
    "collision": ("rgb/forklift_shelf_collision", "Forklift drives into a shelf"),
    "pickup": ("rgb/warehouse_box_pickup", "Routine box pickup — the negative case"),
}


def _get_json(url: str) -> list[dict]:
    req = urllib.request.Request(url, headers={"User-Agent": "fetch_sample/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def smallest_shard(directory: str) -> tuple[str, int]:
    """Pick the smallest shard in a scenario — less to stream through."""
    files = [f for f in _get_json(f"https://huggingface.co/api/datasets/{REPO}/tree/main/{directory}")
             if f.get("type") == "file" and f["path"].endswith(".tar")]
    if not files:
        raise SystemExit(f"No shards found under {directory}. Has the dataset layout changed?")
    best = min(files, key=lambda f: f.get("size") or 0)
    return best["path"], best.get("size") or 0


def fetch(scenario: str) -> Path:
    directory, blurb = SCENARIOS[scenario]
    print(f"{scenario}: {blurb}")
    path, size = smallest_shard(directory)
    print(f"  shard {Path(path).name} is {size / 1e6:.0f} MB — streaming until the first clip appears…")

    OUT.mkdir(parents=True, exist_ok=True)
    dest = OUT / f"{scenario}.mp4"
    req = urllib.request.Request(f"{BASE}/resolve/main/{path}",
                                 headers={"User-Agent": "fetch_sample/1.0"})
    with urllib.request.urlopen(req, timeout=180) as r, tarfile.open(fileobj=r, mode="r|") as tf:
        for member in tf:
            if not member.isfile():
                continue
            if member.name.lower().endswith(".mp4"):
                print(f"  extracting {member.name} ({member.size / 1e6:.0f} MB)")
                dest.write_bytes(tf.extractfile(member).read())
                print(f"  saved {dest}")
                return dest
            # Guard against streaming a whole shard if the layout ever changes.
            if member.size > 400e6:
                break
    raise SystemExit("Streamed past the start of the shard without finding an MP4.")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scenario", choices=sorted(SCENARIOS), default="nearmiss")
    ap.add_argument("--all", action="store_true", help="fetch one clip per scenario")
    ap.add_argument("--list", action="store_true", help="show the scenarios and exit")
    a = ap.parse_args()

    if a.list:
        for k, (_, blurb) in sorted(SCENARIOS.items()):
            print(f"  {k:10s} {blurb}")
        return

    try:
        for s in sorted(SCENARIOS) if a.all else [a.scenario]:
            fetch(s)
    except urllib.error.URLError as e:
        raise SystemExit(f"Could not reach Hugging Face: {e}. Check your connection and retry.")

    print("\nDone. Start the app with ./run.sh, then upload the clip from data/sample/.")


if __name__ == "__main__":
    sys.exit(main())
