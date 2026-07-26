# Video Incident Intelligence

**Search hours of warehouse camera footage in plain language. Runs on a laptop, costs nothing.**

> 🚧 **Not built yet.** This repository is scaffolding — the brief, the design
> and the constraints are written down; the code isn't. See
> [docs/BRIEF.md](docs/BRIEF.md).

---

## The idea

A warehouse has cameras. Nobody watches them.

Footage gets reviewed after something goes wrong, by scrubbing hours of video
looking for the moment. The questions a supervisor actually wants answered —
*was the fire exit blocked this week? how long was the dock congested?* — are
sitting in that footage, and nobody has the time.

This is search and summary over video, in plain language:

- *"Show me every time the loading bay was blocked last week."*
- *"Summarise yesterday's evening shift."*
- Anything it's confident about opens a safety incident automatically, with the
  clip attached.

## Project 2 of a series

| # | Project | Modality | Status |
|---|---|---|---|
| 1 | [WarehouseOps AI](https://github.com/Harshsoni-anlt/warehouseops-ai) | Text · structured data | ✅ Shipped |
| **2** | **Video incident intelligence** *(this repo)* | **Video · vision** | 🔨 Next |
| 3 | Voice operations agent | Audio · speech | 📋 Queued |
| 4 | Catalogue enrichment from a photo | Image · text | 📋 Queued |

Same planner, tool-routing and guardrail layer underneath each one. The modality
changes; the discipline doesn't.

This one writes into the **same safety-incident table** WarehouseOps AI reads —
so asking that assistant "show me recent safety incidents" starts returning
things a camera found.

## Constraints

Carried over from project 1, deliberately:

- **₹0** — no GPU, no managed services, nothing with a monthly bill
- **Runs on a laptop** — two commands
- **Apache 2.0**, with the limitations written down rather than hidden

## The actual engineering problem

Sending every frame to a vision model is too slow and too expensive, even on
free tiers. Ten hours at 30 fps is a million frames.

So the work is in deciding **what to send**: sample at ~1 fps, drop frames where
nothing changed using a cheap local motion pass, and only then describe what
survives. Getting from a million frames to a few hundred worth looking at —
without missing the event — is the whole problem. The rest is plumbing that
already exists in project 1.

## Status

Nothing here yet. [docs/BRIEF.md](docs/BRIEF.md) has the design, the candidate
free components, the open questions, and the scope boundary for v1.

Watch the repo if you want to see it take shape.

## License

Apache 2.0.
