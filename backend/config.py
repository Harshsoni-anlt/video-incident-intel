# SPDX-License-Identifier: Apache-2.0
"""Settings, all overridable from .env. No secrets have defaults."""

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent

# The repo's own .env wins; 10_repos/.env is a convenience fallback so the
# keys already on this machine work without being copied around.
load_dotenv(ROOT / ".env")
load_dotenv(ROOT.parent / ".env")


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except ValueError:
        return default


# --- Storage ---
DATA_DIR = Path(os.getenv("DATA_DIR", ROOT / "data"))
UPLOAD_DIR = DATA_DIR / "uploads"
THUMB_DIR = DATA_DIR / "thumbs"
DB_PATH = Path(os.getenv("DB_PATH", DATA_DIR / "incidents.db"))

for _d in (UPLOAD_DIR, THUMB_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# --- Vision provider ---
VISION_PROVIDER = os.getenv("VISION_PROVIDER", "gemini").lower()

# GOOGLE_API_KEY is what Google's own tooling sets; accept either spelling.
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or ""
GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"
VISION_MODEL = os.getenv("VISION_MODEL", "gemini-3.5-flash-lite")
EMBED_MODEL = os.getenv("EMBED_MODEL", "gemini-embedding-001")

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_VISION_MODEL = os.getenv("OLLAMA_VISION_MODEL", "moondream")

# --- Sampling / filtering ---
# Sample this often. CCTV at 30fps is 30x more frames than anyone needs.
SAMPLE_FPS = _float("SAMPLE_FPS", 1.0)
# Mean absolute pixel difference (0-1) below which a frame is considered
# "nothing changed" and never reaches the model. This is the cost lever.
MOTION_THRESHOLD = _float("MOTION_THRESHOLD", 0.02)
# Never send more than this many frames from one video, whatever the filter says.
MAX_FRAMES = _int("MAX_FRAMES", 400)
# Frames per vision request. Gemini allows thousands; batching is what keeps us
# inside the free tier's requests-per-day cap.
FRAMES_PER_CALL = _int("FRAMES_PER_CALL", 12)
# Gemini charges 66 tokens/frame at low media resolution vs 258 at default.
MEDIA_RESOLUTION = os.getenv("MEDIA_RESOLUTION", "MEDIA_RESOLUTION_LOW")
# Long edge, in pixels, of frames sent to the model and stored as thumbnails.
FRAME_LONG_EDGE = _int("FRAME_LONG_EDGE", 512)

# --- Upload guard ---
MAX_UPLOAD_MB = _int("MAX_UPLOAD_MB", 500)

# --- Incident write-back to project 1 (WarehouseOps AI) ---
# Point this at that repo's warehouse.db to have camera findings show up in the
# assistant's safety-incident table. Empty = feature off.
WAREHOUSE_DB_PATH = os.getenv("WAREHOUSE_DB_PATH", "")

CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")


def vision_ready() -> tuple[bool, str]:
    """Whether a vision model is reachable, and why not if it isn't."""
    if VISION_PROVIDER == "gemini":
        if not GEMINI_API_KEY:
            return False, "GEMINI_API_KEY (or GOOGLE_API_KEY) is not set. Get a free key at https://aistudio.google.com/apikey"
        return True, ""
    if VISION_PROVIDER == "ollama":
        return True, ""
    return False, f"Unknown VISION_PROVIDER={VISION_PROVIDER!r}. Use 'gemini' or 'ollama'."
