# Roadmap

> Where the engine is today and what the next architectural layer looks like.
> Status here is descriptive of the **current codebase** — not a plan to build it.

The foundation (engine, resolver, playback, state model) and the first feature
wave (GPU renderer, real video decode, text/image layers, audio, MP4 export) are
**shipped**. The next major layer is a **scheduler / media-coordination** system
that turns the current best-effort decode pipeline into a predictive one.

For the things that are known-incomplete today, see
[`CURRENT_LIMITATIONS.md`](./CURRENT_LIMITATIONS.md).

---

## Shipped

| Area | What works |
|---|---|
| Data model | `Project` / `Track` / `Clip`, integer-frame time, normalized `transform` |
| `TimelineEngine` | Immer mutations, undo/redo, batch transactions, typed events |
| `PlaybackEngine` | Anchor-and-integrate RAF clock, subscribe / timeupdate channels |
| `resolveTimeline` | Pure `(frame, project) → Scene`; solo / mute / disabled / zIndex |
| Timeline UI | `Timeline`, `Ruler`, `TrackRow`, `ClipBlock`, `Playhead`, drag/trim/split |
| Media library | `importFiles`, metadata probe, async thumbnails, drag-to-timeline |
| GPU renderer | WebGL2 `GpuRenderer` + `RenderGraph`; video / image / text layers; context-loss recovery |
| Real video decode | Push-based `StreamingFrameProducer` (WebCodecs) + mediabunny demux + copy-and-close `FrameCache` |
| `<Preview>` | Mounts the renderer, drives RAF, paints the interactive text overlay |
| Audio playback | `AudioPlaybackController` on the `PlaybackEngine` clock |
| Aspect ratio | Contain-fit viewport + per-clip object-fit; switchable stage via `setStage` |
| **Export** | `exportVideo()` → worker → OffscreenCanvas frame render → mediabunny MP4 mux, with main-thread audio mix |

---

## Next architectural layer — Scheduler / media coordination

The current decode pipeline is **push-based and best-effort**: `VideoLayer`
calls `setPlayhead(N)`, and `StreamingFrameProducer` feeds a forward lookahead
window. It has no global view across clips and no notion of priority. The next
layer is a coordinator that sits between the render tick and the providers.

Planned responsibilities (none implemented yet):

- **Predictive frame caching** — warm frames ahead of where the playhead is
  *going*, not just ahead of where it is.
- **Reverse-scrub support** — decode/cache strategy for backward playback that
  doesn't cold-start from a keyframe on every step.
- **Decode prioritization** — order/cancel work across multiple clips by
  visibility and proximity to the playhead.
- **Cache warming** — pre-roll around cut points and pending seeks.
- **Playback ↔ export coordination** — one scheduling policy shared by the live
  RAF loop and the deterministic export loop.
- **Transition synchronization** — keep both sides of an overlap decoded so a
  crossfade never shows a black frame.

This is the seam that `Scene.transitions` (reserved, empty today) and the
`StreamingFrameProducer` lookahead/hysteresis logic are shaped to grow into.

---

## Feature backlog (unsequenced)

Planned, not started. Order will be decided when the scheduler lands.

- Transition system (crossfade / cut / wipe) on top of `Scene.transitions`
- Multi-track video/audio compositing beyond the current single-track v1 path
- On-canvas resize/rotate gizmos for video & image clips (text already has them)
- Waveform rendering and timeline clip thumbnails / filmstrips
- Effects / filters / animation (per-clip shader passes via a new layer)
- Asset persistence (IndexedDB / OPFS) so the library survives reload
- WebGPU backend behind the existing `Renderer` interface

---

## Decisions log

| Date | Decision | Rationale |
|---|---|---|
| 2026-05 | Frames as the only internal time unit | Eliminate floating-point drift across splits/trims |
| 2026-05 | `resolveTimeline` is pure | Renderer-agnostic, worker-safe, testable, export-reusable |
| 2026-05 | Single package (`@elah/editor`) | Avoid premature monorepo split; folders, not packages |
| 2026-05 | Zustand stores are Ring 1 mirrors only | Engine stays the single source of truth |
| 2026-05 | GPU (WebGL2) renderer as the shipped backend | A planned DOM-first renderer was dropped; the textured-quad path generalizes to image/text and reuses the same placement math the export worker uses |
| 2026-05 | mediabunny injected, never a hard dependency | Keep WebCodecs/demux out of the core bundle (see [`BUNDLE_STRATEGY.md`](./BUNDLE_STRATEGY.md)) |
| 2026-05 | Copy decoded frames to `ImageBitmap`, close immediately | Stop the decoder output pool from starving and freezing playback |
| 2026-06 | Export reuses `resolveTimeline` + shared placement math | One rendering truth for preview and export; no export-specific scene system |

See [`ARCHITECTURE.md` § anti-patterns](./ARCHITECTURE.md#9-what-this-architecture-rejects-anti-patterns)
for the standing list of things this project deliberately does not build.
