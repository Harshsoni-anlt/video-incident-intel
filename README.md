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

Four scenarios from NVIDIA's SDG-Warehouse dataset (`python scripts/fetch_sample.py --all`),
1920×1080 at 30 fps. Frame counts are exact — the filter runs locally, so measuring
it costs nothing:

| Clip | Decoded | Sampled @1fps | Sent | Requests (filtered → baseline) | Filter saved |
|---|---|---|---|---|---|
| Forklift–shelf collision | 451 | 16 | 2 | 1 → 2 | 88% |
| Warehouse fire | 277 | 10 | 3 | 1 → 1 | 70% |
| Box pickup | 418 | 14 | 3 | 1 → 2 | 79% |
| Forklift near-miss | 300 | 10 | 9 | 1 → 1 | **10%** |
| **Total** | **1,446** | **50** | **17** | | **66%** |

**Two different reductions, and they should not be quoted as one number:**

- **Sampling is content-independent.** 30 fps → 1 fps removes 96.5% of frames on
  any footage, guaranteed, because it is arithmetic rather than a judgement.
- **The motion filter is content-dependent.** Across these four clips it removed
  a further 66% of what survived sampling — but the spread is 10% to 88%. The
  near-miss clip is ten seconds of continuous action with nothing static to
  drop; the collision clip is mostly an undisturbed aisle. Real overnight CCTV
  looks far more like the second than the first.

Combined, 1,446 frames became 17. But the honest way to read this is that the
guaranteed part is the sampling, and the filter is a multiplier whose value
depends entirely on how much of your footage is nothing happening.

**So the app measures it for you.** The dashboard shows how many requests your
runs actually made next to how many they would have made with the filter off —
exact arithmetic on frames already counted, not a second set of API calls. There
is also a baseline mode that genuinely re-runs without the filter if you want to
compare the outputs and not just the cost.

## What it does

| | |
|---|---|
| **Bring your own video** | Drag in an MP4. The file never leaves your machine — only small, downscaled frames go to the model. |
| **Write your own checks** | A check is a plain-language question plus the kind of answer it expects (yes/no, a count, one of a list, free text). Group them into profiles and pick one per run. |
| **Automatic incidents** | A check that trips with enough confidence files an incident with the frame attached. Consecutive trips are merged, so an eight-second near-miss is one incident, not eight. |
| **Ask anything** | Free-text questions run over the indexed frame descriptions. Answers cite the timestamps they came from, and clicking one seeks the player there. |
| **Dashboard** | Frames skipped, API calls spent, incidents by severity, which checks fire most often. |
| **Opens on a working demo** | First run analyses a clip in the background so the first screen shows the product working instead of an empty state. `SEED_DEMO=0` turns it off. |
| **Export** | CSV, JSON, or POST incidents to any webhook — a ticketing system, a chat workflow, whatever already runs your operation. |

## Quickstart

```bash
git clone https://github.com/Harshsoni-anlt/video-incident-intel
cd video-incident-intel
cp .env.example .env        # add a free Gemini key: https://aistudio.google.com/apikey
./run.sh
```

Open <http://localhost:5173>. You land on a page explaining what the system does
and how it keeps the cost down; **Open the app** takes you to the dashboard,
which has already analysed a clip for you — a real run, not fixtures.

For real footage, `python scripts/fetch_sample.py` pulls a 1080p warehouse clip;
after that, **Use a sample clip** hands you that instead of a generated one.
With nothing downloaded you still get a test pattern that proves the pipeline
runs end to end — the app is explicit that it is an abstract pattern, because a
question like "how many people are visible?" will honestly answer zero on it.

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

Once a clip is downloaded, **Use a sample clip** in the app hands you that.
With nothing downloaded it generates an abstract test pattern instead — enough
to prove the pipeline runs, but questions about people or stock will answer
zero on it, and the app says so rather than letting you conclude it is broken.

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
- **No object localisation.** Findings are frame-level: *this frame shows a
  person near a forklift*, not *the forklift is at these pixels*. If you need
  boxes, a trained detector is the right tool.
- **Single user.** SQLite, one process, no auth. Answering a question while an
  analysis is running is slow, because the analysis holds the write lock.

## Tests

```bash
python -m backend.pipeline    # decode, motion filter, frame cap
python -m backend.analysis    # trip rules, incident merging, cosine ranking
python tests/test_api.py      # API surface, upload guards, path confinement
```

None of them need an API key or a network.

## Part of a series — but it stands alone

This is the second of several systems I'm building around one idea: production-
shaped AI that runs on free infrastructure, answers with evidence, and is honest
about what it cannot do.

**It has no dependency on any of the others.** Clone it, add a key, run it. It
does not read another project's database, import another project's code, or
assume anything else is installed. Incidents leave through a CSV, a JSON file or
a webhook you point wherever you like.

| # | Project | Modality |
|---|---|---|
| 1 | [WarehouseOps AI](https://github.com/Harshsoni-anlt/warehouseops-ai) | Text · structured data |
| **2** | **Video incident intelligence** *(this repo)* | **Video · vision** |
| 3 | Voice operations agent | Audio · speech — next |

## License

Apache 2.0. See [NOTICE](NOTICE) for third-party attribution.
