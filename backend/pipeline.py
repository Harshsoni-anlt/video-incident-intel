# SPDX-License-Identifier: Apache-2.0
"""Decode → downsample → motion-filter → JPEG.

This is where the money is saved. Ten hours of CCTV at 30 fps is ~1.1M frames.
Sampling at 1 fps cuts that to 36k. Dropping frames where nothing moved cuts it
again to a few hundred — and only those reach the vision model.

OpenCV ships its own ffmpeg libraries, so nothing needs to be installed system
wide for this to run.
"""

from __future__ import annotations

import heapq
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from . import config

# The motion comparison runs on a tiny greyscale copy — full-resolution
# differencing would cost more than it saves.
_DIFF_SIZE = (64, 64)


@dataclass
class Frame:
    ts_s: float
    jpeg: bytes
    motion_score: float


@dataclass
class Probe:
    duration_s: float
    fps: float
    width: int
    height: int
    frame_count: int


def probe(path: str | Path) -> Probe:
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise ValueError(f"Could not open video: {path}. Unsupported codec or corrupt file.")
    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
        count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        # Some containers report nonsense fps; fall back to something sane so
        # the sampling maths below never divides by zero.
        if not 1 <= fps <= 240:
            fps = 25.0
        return Probe(
            duration_s=count / fps if count else 0.0,
            fps=fps, width=w, height=h, frame_count=count,
        )
    finally:
        cap.release()


def _resize_long_edge(img: np.ndarray, long_edge: int) -> np.ndarray:
    h, w = img.shape[:2]
    scale = long_edge / max(h, w)
    if scale >= 1:
        return img
    return cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)


def _encode(img: np.ndarray, quality: int = 80) -> bytes:
    ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        raise RuntimeError("JPEG encode failed")
    return buf.tobytes()


def extract(
    path: str | Path,
    sample_fps: float | None = None,
    motion_threshold: float | None = None,
    max_frames: int | None = None,
    keep_every_frame: bool = False,
) -> tuple[list[Frame], dict]:
    """Return the frames worth describing, plus counters for the cost report.

    `keep_every_frame` skips the motion filter entirely. That is the naive
    baseline the README benchmarks against — it exists to be beaten.
    """
    sample_fps = sample_fps if sample_fps is not None else config.SAMPLE_FPS
    motion_threshold = motion_threshold if motion_threshold is not None else config.MOTION_THRESHOLD
    max_frames = max_frames if max_frames is not None else config.MAX_FRAMES

    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise ValueError(f"Could not open video: {path}. Unsupported codec or corrupt file.")

    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
        if not 1 <= fps <= 240:
            fps = 25.0
        stride = max(1, round(fps / max(sample_fps, 0.01)))

        # Bounded min-heap of the most-motion frames seen so far, so memory
        # stays flat no matter how long the video is.
        # ponytail: ranks purely by motion, so a very busy 10 minutes can crowd
        # out a quiet 9 hours. Stratify per time-bucket if coverage matters.
        heap: list[tuple[float, int, Frame]] = []
        seq = 0
        prev_small: np.ndarray | None = None
        total = sampled = kept = 0

        while True:
            if not cap.grab():           # cheap: advances without decoding
                break
            total += 1
            if (total - 1) % stride:
                continue
            ok, frame = cap.retrieve()   # decode only the frames we sample
            if not ok:
                continue
            sampled += 1
            ts = (total - 1) / fps

            small = cv2.cvtColor(cv2.resize(frame, _DIFF_SIZE, interpolation=cv2.INTER_AREA),
                                 cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
            if prev_small is None:
                score = 1.0                      # always keep the opening frame
            else:
                score = float(np.abs(small - prev_small).mean())

            if not keep_every_frame and score < motion_threshold:
                continue                          # nothing changed: never leaves this machine

            # Compare against the last frame we *kept*, not the last one we
            # looked at, so a slow drift eventually accumulates past the
            # threshold instead of never tripping it.
            prev_small = small
            kept += 1
            f = Frame(ts_s=ts, jpeg=_encode(_resize_long_edge(frame, config.FRAME_LONG_EDGE)),
                      motion_score=score)
            seq += 1
            if len(heap) < max_frames:
                heapq.heappush(heap, (score, seq, f))
            elif score > heap[0][0]:
                heapq.heapreplace(heap, (score, seq, f))

        frames = sorted((f for _, _, f in heap), key=lambda f: f.ts_s)
        stats = {
            "frames_total": total,
            "frames_sampled": sampled,
            "frames_kept": len(frames),
            "frames_passed_filter": kept,
            "fps": fps,
            "stride": stride,
        }
        return frames, stats
    finally:
        cap.release()


def save_thumbs(video_id: int, frames: list[Frame]) -> list[str]:
    """Write JPEGs to disk and return paths relative to the thumbnail root."""
    out = Path(config.THUMB_DIR) / str(video_id)
    out.mkdir(parents=True, exist_ok=True)
    paths = []
    for f in frames:
        name = f"{f.ts_s:09.2f}.jpg"
        (out / name).write_bytes(f.jpeg)
        paths.append(f"{video_id}/{name}")
    return paths


def make_test_clip(path: str | Path, seconds: int = 20, fps: int = 15) -> Path:
    """Synthesise a clip: static shelves, a box count that changes, and a
    'forklift' that only appears for part of the run.

    Used by the self-check, and as a zero-download fallback sample so the app
    is demoable before anyone fetches real footage.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    w, h = 640, 360
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
    if not writer.isOpened():
        raise RuntimeError("OpenCV could not open an mp4v writer")
    try:
        for i in range(seconds * fps):
            t = i / fps
            img = np.full((h, w, 3), 40, np.uint8)
            for x in range(40, w - 40, 120):        # shelving: never moves
                cv2.rectangle(img, (x, 90), (x + 90, 300), (90, 90, 100), -1)
            n_boxes = 3 if t < 10 else 6            # stock level changes at 10s
            for b in range(n_boxes):
                x = 50 + b * 95
                cv2.rectangle(img, (x, 250), (x + 60, 300), (60, 140, 200), -1)
            if 5 <= t <= 15:                        # the only real motion
                fx = int((t - 5) / 10 * (w - 120))
                cv2.rectangle(img, (fx, 200), (fx + 100, 320), (30, 200, 230), -1)
            writer.write(img)
    finally:
        writer.release()
    return path


if __name__ == "__main__":
    import tempfile

    tmp = Path(tempfile.mkdtemp())
    clip = make_test_clip(tmp / "clip.mp4", seconds=20, fps=15)

    p = probe(clip)
    assert p.frame_count > 0, "probe found no frames"
    assert 19 <= p.duration_s <= 21, f"duration wrong: {p.duration_s}"

    frames, stats = extract(clip, sample_fps=1.0, motion_threshold=0.02)
    assert stats["frames_sampled"] == 20, f"expected 20 sampled, got {stats['frames_sampled']}"
    # The forklift moves between 5s and 15s; outside that only the box change
    # at 10s disturbs the scene. The filter must drop the static majority.
    assert 2 < stats["frames_kept"] < 18, f"filter kept {stats['frames_kept']}/20 — not filtering"
    assert all(f.jpeg[:2] == b"\xff\xd8" for f in frames), "frames are not valid JPEG"
    assert frames == sorted(frames, key=lambda f: f.ts_s), "frames out of order"

    every, stats2 = extract(clip, sample_fps=1.0, keep_every_frame=True)
    assert stats2["frames_kept"] == 20, "baseline mode must keep every sampled frame"
    assert len(frames) < len(every), "filtered mode should send fewer frames than the baseline"

    capped, _ = extract(clip, sample_fps=15.0, motion_threshold=0.0, max_frames=5)
    assert len(capped) == 5, f"max_frames not honoured: {len(capped)}"

    print(f"ok — {stats['frames_total']} decoded, {stats['frames_sampled']} sampled, "
          f"{stats['frames_kept']} sent to the model "
          f"({100 * (1 - stats['frames_kept'] / stats['frames_sampled']):.0f}% saved vs baseline)")
