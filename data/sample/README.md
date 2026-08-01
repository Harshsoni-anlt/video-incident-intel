# Sample footage

Clips are downloaded here, not committed — `.gitignore` excludes video, because
a repo is not a CDN.

## Get some

```bash
python scripts/fetch_sample.py --list      # show the four scenarios
python scripts/fetch_sample.py             # forklift near-miss (default)
python scripts/fetch_sample.py --all       # one clip per scenario
```

| Scenario | What happens |
|---|---|
| `nearmiss` | Forklift passes close to a worker |
| `fire` | Ignition followed by worker evacuation |
| `collision` | Forklift drives into a shelf |
| `pickup` | Routine box pickup — the negative case, so you can see the checks *not* fire |

Each is a 10–15 second run at 1920×1080, 30 fps, from a fixed CCTV-style camera.

## Where it comes from

NVIDIA **PhysicalAI SDG-Warehouse**
([Hugging Face](https://huggingface.co/datasets/nvidia/PhysicalAI-WorldModel-Synthetic-Warehouse-Operations-Scenes)),
licensed **OpenMDW 1.1**. Attribution is in [NOTICE](../../NOTICE).

Everything in it was rendered in Isaac Sim. **No real-world footage was captured
and no real people appear in it** — which is a stronger privacy position than
blurring faces, because there are no faces to blur.

The full dataset is 18 TiB and individual shards run to several gigabytes. The
fetch script streams one shard and stops at the first clip, so it pulls tens of
megabytes rather than the whole thing.

## No download at all

Press **Use a sample clip** in the app. It generates a synthetic warehouse scene
locally — static shelving, a stock level that changes, and a moving vehicle —
which is enough to watch the whole pipeline run end to end.
