# Project 2 — Video Incident Intelligence

**Status:** open questions resolved 31 Jul 2026 (see below). Ready to scaffold.
**Predecessor:** [WarehouseOps AI](https://github.com/Harshsoni-anlt/warehouseops-ai) — shipped 26 Jul 2026.

---

## The problem

A warehouse has cameras. Nobody watches them.

Footage is reviewed after something goes wrong, by scrubbing hours of video
looking for the moment. Meanwhile the things a supervisor actually wants to know
— *was the fire exit blocked this week? how long was the dock congested? did
anyone work at height without a harness?* — are answerable from that footage and
nobody has the time.

That's the gap. Not object detection for its own sake: **search and summary over
footage, in plain language.**

## What it should do

| | |
|---|---|
| **Ask in plain language** | "Show me every time the loading bay was blocked last week." "Was anyone in Zone C without a hi-vis vest?" |
| **Summarise a shift** | Ten hours in, five moments out — with timestamps and a thumbnail each. |
| **Open incidents automatically** | A detection with high enough confidence files a safety incident, with the clip attached, into the same table WarehouseOps AI already reads. |
| **Stay auditable** | Every answer cites the clip and timestamp it came from. Same principle as project 1: the model writes the sentence, the evidence is real. |

## Why it follows project 1

It reuses the planner, tool-routing and guardrail layer already built, and it
writes into the **same safety-incident table** the warehouse assistant reads. So
"show me recent safety incidents" in project 1 starts returning things a camera
found. That connection is the story: one agent architecture, a second input type.

---

## Constraints (unchanged from project 1)

- **₹0.** No GPU, no managed services, nothing with a monthly bill.
- **Runs on a laptop.** Two commands.
- **Apache 2.0**, and honest about limits in the README.

## Technical approach — first pass

The naive approach (send every frame to a vision model) is both too slow and too
expensive even on free tiers. The design problem is **what to send**.

```
video file
   │
   ├─ 1. Sample frames        ffmpeg, ~1 fps, plus scene-change detection
   │                          so static periods cost nothing
   │
   ├─ 2. Filter               cheap local motion/diff pass — skip frames where
   │                          nothing changed. This is where the cost saving is.
   │
   ├─ 3. Describe             free vision model (Gemini free tier / local
   │                          Moondream or Qwen-VL) → text description per
   │                          surviving frame, with timestamp
   │
   ├─ 4. Index               embed descriptions → ChromaDB, timestamp as metadata
   │
   └─ 5. Answer              plain-language query → vector search over
                             descriptions → LLM composes the answer, citing
                             timestamps → optional incident write-back
```

**The interesting engineering is step 2.** Getting from "30 fps × 10 hours" to
"a few hundred frames worth describing" without missing the event is the whole
problem. Everything else is plumbing that already exists in project 1.

### Candidate free components

| Need | Option | Notes |
|---|---|---|
| Frame extraction | `ffmpeg` | Already available; scene-change filter is built in |
| Motion filtering | OpenCV frame differencing | Local, fast, free |
| Vision model | Gemini free tier | Generous free quota, no card |
| Vision model (offline) | Moondream 2 / Qwen2-VL 2B via Ollama | Runs on CPU/M-series, slower |
| Embeddings | sentence-transformers | Same as project 1 |
| Vector store | ChromaDB | Same as project 1 |
| Sample footage | Public warehouse/CCTV datasets, or record a phone video of a desk setup | **Must not use real footage of identifiable people** |

---

## Open questions — resolved 31 Jul 2026

1. **Sample data.** ✅ **NVIDIA PhysicalAI SDG-Warehouse** synthetic dataset
   (`nvidia/PhysicalAI-WorldModel-Synthetic-Warehouse-Operations-Scenes` on
   Hugging Face). Fully rendered in Isaac Sim — no real footage, no real
   people, zero privacy exposure (stronger than "faces blurred": there are no
   faces to blur). Licensed **OpenMDW 1.1** (Linux Foundation, permissive,
   redistribution allowed with attribution). Four scenarios, three of them
   literally safety incidents: forklift–human near-miss, warehouse fire +
   evacuation, forklift–shelf collision, routine box-pickup (our negative/
   baseline case). Same provenance pattern as project 1 (NVIDIA source,
   stated once in README + NOTICE, never the headline) — precedent already
   set, no new positioning problem.
   - **Practical note:** shards are ~5 GB each — far too big to ship. Plan:
     download one shard per scenario, `ffmpeg`-trim to a 30–90s highlight
     clip, keep only the trimmed MP4s (a few MB total) in `data/sample/`,
     discard the shard. Attribution goes in NOTICE, same as project 1.
2. **Vision model choice.** ✅ Mirror project 1's dual-path pattern: **Gemini
   free tier** primary (fast to build against), **local Moondream 2 via
   Ollama** as the offline fallback, so the "runs entirely offline" claim
   holds. Same `--offline` flag shape as project 1.
3. **How much do we describe?** ✅ **Targeted checks**, not dense captions —
   a fixed condition list evaluated per surviving frame (exit blocked /
   clear, hi-vis vest present, forklift proximity to a person, congestion).
   Cheaper, more auditable, and maps directly onto the four SDG-Warehouse
   scenarios. Dense captioning stays an explicit non-goal for v1.
4. **Standalone or extension?** ✅ **Standalone repo**, writes into project 1's
   existing SQLite safety-incident table via the schema it already defines —
   same integration shape as any other incident source, no shared codebase.

## Scope discipline

Project 1 took far longer than planned because the scope kept growing. For this
one:

**In scope for v1**
- One video file at a time, uploaded through a UI
- Plain-language search over it, with timestamped results
- Shift summary
- Sample footage that ships with the repo

**Explicitly not in v1**
- Live RTSP streams
- Multi-camera correlation
- Person tracking or re-identification
- Anything requiring a GPU

---

## Lessons carried forward from project 1

Written down because they cost real time:

1. **Record the demo early.** Two serious bugs were found only by recording a
   walkthrough — a read query that wrote to the database, and an agent that
   couldn't reach its own tools. Recording forces the paths a user takes.
2. **Never let a question mutate state.** Separate read intents from write
   intents explicitly, and test it.
3. **Substring matching in routers is a trap.** Whole-word, weighted, scored.
4. **Check the read path, not just the write path.** The document pipeline
   worked perfectly for days while the UI showed nothing, because status was
   read from one store and written to another.
5. **A demo that reports false success is worse than one that fails.** A
   document with no extractable text was scored 4.2/5 and auto-approved.
6. **Ship the honest limitations in the README.** It costs nothing and it's the
   thing people actually respect.
