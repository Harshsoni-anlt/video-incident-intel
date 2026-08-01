# Video Incident Intelligence

**Ask hours of camera footage a question in plain English. Runs on a laptop, costs nothing.**

Upload a video, tell it what you care about — *is the fire exit blocked? how many
pallets are on the floor? is anyone working without a hi-vis vest?* — and get
back timestamped answers with the frame that proves each one.

You write the questions. That is the point: this is not a fixed safety-detection
model, it is a general frame-reading pipeline you point at your own problem.

---

## Why this is not just "send the video to a vision model"

Ten hours of CCTV at 30 fps is 1.1 million frames. Sending them all is
impossible on a free tier and pointless besides — a warehouse aisle at 3am is
the same frame ten thousand times.

So the work is deciding **what to send**:

```
video ──▶ sample at 1 fps ──▶ motion filter ──▶ batch 12 per request ──▶ vision model
        1,080,000 → 36,000    36,000 → ~400        ~400 → ~34 calls
```

- **Sampling** drops 97% of frames before anything looks at them.
- **The motion filter** compares each frame against the last one *kept* — not
  the last one seen, so a slow drift still accumulates past the threshold — and
  discards anything where nothing changed. It runs locally on a 64×64 greyscale
  copy and costs nothing.
- **Batching** packs 12 frames into a single request. Free tiers cap *requests
  per day* far more tightly than tokens, so this is what makes long footage
  affordable at all.
- **Low media resolution** costs 66 tokens per frame instead of 258.

The app ships a **baseline mode** that skips the filter and describes every
sampled frame, so the saving is a number you can measure rather than a claim in
a README.

### Measured on real footage

A 10-second 1920×1080 CCTV clip from NVIDIA's SDG-Warehouse near-miss scenario
(`python scripts/fetch_sample.py`), run against the Safety compliance profile:

| | |
|---|---|
| Frames decoded | 300 |
| Sampled at 1 fps | 10 |
| Sent to the model | 9 |
| API calls | 1 |
| Tokens | 4,737 |
| Wall clock | 10.1s |
| Flagged | forklift within 2 m of a person at 00:04, `critical`, confidence 0.90 |

**The filter saved almost nothing on this clip, and that is the honest result.**
Ten seconds of continuous action has nothing static to drop. The filter earns
its keep on long, mostly-empty footage — an overnight shift where the same
frame repeats ten thousand times — not on a short action sequence. Run the same
clip in baseline mode and the numbers are nearly identical; run it on an hour of
a quiet aisle and they are not.

## What it does

| | |
|---|---|
| **Bring your own video** | Drag in an MP4. The file never leaves your machine — only small, downscaled frames go to the model. |
| **Write your own checks** | A check is a plain-language question plus the kind of answer it expects (yes/no, a count, one of a list, free text). Group them into profiles and pick one per run. |
| **Automatic incidents** | A check that trips with enough confidence files an incident with the frame attached. Consecutive trips are merged, so an eight-second near-miss is one incident, not eight. |
| **Ask anything** | Free-text questions run over the indexed frame descriptions. Answers cite the timestamps they came from, and clicking one seeks the player there. |
| **Dashboard** | Frames skipped, API calls spent, incidents by severity, which checks fire most often. |
| **Export** | CSV, or write straight into [WarehouseOps AI](https://github.com/Harshsoni-anlt/warehouseops-ai)'s safety-incident table so its assistant starts answering with things a camera found. |

## Quickstart

```bash
git clone https://github.com/Harshsoni-anlt/video-incident-intel
cd video-incident-intel
cp .env.example .env        # add a free Gemini key: https://aistudio.google.com/apikey
./run.sh
```

Open <http://localhost:5173> and press **Use a sample clip** — it generates a
synthetic warehouse scene locally, so the whole pipeline is demoable before you
download anything or point it at real footage.

Needs Python ≥ 3.11 and Node ≥ 18; `run.sh` creates the virtualenv and installs
both sides on first run. **No ffmpeg install required** — OpenCV ships its own
decoders.

## The stack, and what it costs

| Layer | Choice | Cost |
|---|---|---|
| Vision + text | Gemini Flash-Lite free tier | ₹0, no card |
| Embeddings | `gemini-embedding-001`, 768-dim | ₹0 |
| Decode + motion filter | OpenCV, local | ₹0 |
| Search | numpy cosine over frame embeddings | ₹0 |
| Storage | SQLite | ₹0 |
| UI | React + Vite + Tailwind | ₹0 |

No vector database: a few hundred frames per video makes one pure overhead, and
a cosine scan over a 400×768 matrix is instant. No torch either — embeddings
come from the API, which keeps the install small and the cold start fast.

**Fully offline alternative:** set `VISION_PROVIDER=ollama` and
`ollama pull moondream`. Slower, no batching, and search falls back to keyword
matching, but nothing leaves the machine.

## Sample footage

Two options, neither of which needs an account:

```bash
python scripts/fetch_sample.py --list      # four scenarios
python scripts/fetch_sample.py             # forklift near-miss, ~170 MB
python scripts/fetch_sample.py --all       # one clip per scenario
```

That pulls real 1080p CCTV-view footage from NVIDIA's **PhysicalAI
SDG-Warehouse** dataset. The dataset is 18 TiB and its shards are gigabytes
each, but they are WebDataset tars — sequential — so the script streams one and
stops at the first clip instead of downloading the shard.

The footage is **fully synthetic**, rendered in Isaac Sim: no real people, no
privacy question, no consent to chase. Licensed OpenMDW 1.1 — see [NOTICE](NOTICE).

Or press **Use a sample clip** in the app, which generates a synthetic scene
locally in a second and needs no download at all.

## Honest limitations

- **It reads frames, not motion.** Sampling at 1 fps means an event shorter than
  about a second can fall between frames. Lower `SAMPLE_FPS` if that matters,
  and pay for it.
- **A vision model is not a safety certification.** It miscounts in clutter and
  it is confident when it is wrong. Every answer sits next to the frame it came
  from precisely so you can check it.
- **"n/a" is load-bearing.** Checks distinguish *"no, the rule is broken"* from
  *"nothing relevant is in this frame"*. Without that distinction every empty
  frame files a false incident — which it did, until it didn't.
- **Confidence comes from the model.** It is a useful sort order, not a
  calibrated probability.
- **One camera at a time.** No multi-camera correlation, no person tracking, no
  live RTSP. Deliberately.

## Tests

```bash
python -m backend.pipeline    # decode, motion filter, frame cap
python -m backend.analysis    # trip rules, incident merging, cosine ranking
python tests/test_api.py      # API surface, upload guards, path confinement
```

None of them need an API key or a network.

## Project 2 of a series

| # | Project | Modality | Status |
|---|---|---|---|
| 1 | [WarehouseOps AI](https://github.com/Harshsoni-anlt/warehouseops-ai) | Text · structured data | Shipped |
| **2** | **Video incident intelligence** *(this repo)* | **Video · vision** | Shipped |
| 3 | Voice operations agent | Audio · speech | Queued |
| 4 | Catalogue enrichment from a photo | Image · text | Queued |

Same discipline each time: grounded answers, honest limits, and a way to try it
on your own data.

## License

Apache 2.0. See [NOTICE](NOTICE) for third-party attribution.
