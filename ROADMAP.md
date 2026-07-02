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

| Area                                | What works                                                                                                                                                                                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data model                          | `Project` / `Track` / `Clip`, integer-frame time, normalized `transform`                                                                                                                                                                     |
| `TimelineEngine`                    | Immer mutations, undo/redo, batch transactions, typed events                                                                                                                                                                                 |
| `PlaybackEngine`                    | Anchor-and-integrate RAF clock, subscribe / timeupdate channels                                                                                                                                                                              |
| `resolveTimeline`                   | Pure `(frame, project) → Scene`; solo / mute / disabled / zIndex                                                                                                                                                                             |
| Timeline UI                         | `Timeline`, `Ruler`, `TrackRow`, `ClipBlock`, `Playhead`, drag/trim/split                                                                                                                                                                    |
| Media library                       | `importFiles`, metadata probe, async thumbnails, drag-to-timeline                                                                                                                                                                            |
| GPU renderer                        | WebGL2 `GpuRenderer` + `RenderGraph`; video / image / text layers; context-loss recovery                                                                                                                                                     |
| Real video decode                   | Push-based `StreamingFrameProducer` (WebCodecs) + mediabunny demux + copy-and-close `FrameCache`                                                                                                                                             |
| `<Preview>`                         | Mounts the renderer, drives RAF, paints the interactive text overlay                                                                                                                                                                         |
| Audio playback                      | `AudioPlaybackController` on the `PlaybackEngine` clock                                                                                                                                                                                      |
| Aspect ratio                        | Contain-fit viewport + per-clip object-fit; switchable stage via `setStage`                                                                                                                                                                  |
| **Export**                          | `exportVideo()` → worker → OffscreenCanvas frame render → mediabunny MP4 mux, with main-thread audio mix                                                                                                                                     |
| **Video & image transform overlay** | `MediaTransformOverlay` — click-select, drag-move, corner-drag uniform scale; writes `transform` through `previewClip`/`commitInteraction` (one undo per gesture); export parity automatic (transform already flowed through both renderers) |
| **Timeline thumbnails + waveforms** | Filmstrip tiles and real waveform peaks per asset; generated once on drop, cached on `MediaAsset`; displayed in `ClipBlock`                                                                                                                  |
| **Audio-on-drop dialog**            | 3-choice modal on video drop with audio; both clips in one `engine.batch` (one undo entry)                                                                                                                                                   |
| **Fade transition**                 | Snapshot-overlay architecture: `resolveTimeline` drives opacity; `TransitionOverlay` fades a canvas snapshot via CSS; export mirrors with `globalAlpha=1-t`; `Scene.transitions` fully typed and populated                                   |

---

## Next architectural layer — Scheduler / media coordination

The current decode pipeline is **push-based and best-effort**: `VideoLayer`
calls `setPlayhead(N)`, and `StreamingFrameProducer` feeds a forward lookahead
window. It has no global view across clips and no notion of priority. The next
layer is a coordinator that sits between the render tick and the providers.

Planned responsibilities (none implemented yet):

- **Predictive frame caching** — warm frames ahead of where the playhead is
  _going_, not just ahead of where it is.
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

## Feature backlog

- **Rotation handle for video/image** — `transform.rotation` already flows through both renderers; the interactive handle in `MediaTransformOverlay` is the only missing piece
- **Slide / wipe transitions** — architecture in place (snapshot overlay + `Scene.transitions`); CSS `transform` on the snapshot div + matching export pass in `ExportWorker`
- **Playback correctness** — reverse scrub stability, predictive frame caching, black-frame elimination at clip boundaries; requires the scheduler layer (see above)
- **Export frame-accuracy** — half-frame phase offset between preview (center-of-frame) and export (start-of-frame); golden-frame parity harness
- Multi-track video/audio compositing beyond the current single-track v1 path
- Effects / filters / animation (per-clip shader passes via a new layer)
- Asset persistence (IndexedDB / OPFS) so the library survives reload
- WebGPU backend behind the existing `Renderer` interface

---

## Decisions log

| Date       | Decision                                                            | Rationale                                                                                                                                                                                            |
| ---------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05    | Frames as the only internal time unit                               | Eliminate floating-point drift across splits/trims                                                                                                                                                   |
| 2026-05    | `resolveTimeline` is pure                                           | Renderer-agnostic, worker-safe, testable, export-reusable                                                                                                                                            |
| 2026-05    | Single package (`@elah/editor`)                                     | Avoid premature monorepo split; folders, not packages                                                                                                                                                |
| 2026-05    | Zustand stores are Ring 1 mirrors only                              | Engine stays the single source of truth                                                                                                                                                              |
| 2026-05    | GPU (WebGL2) renderer as the shipped backend                        | A planned DOM-first renderer was dropped; the textured-quad path generalizes to image/text and reuses the same placement math the export worker uses                                                 |
| 2026-05    | mediabunny injected, never a hard dependency                        | Keep WebCodecs/demux out of the core bundle (see [`BUNDLE_STRATEGY.md`](./BUNDLE_STRATEGY.md))                                                                                                       |
| 2026-05    | Copy decoded frames to `ImageBitmap`, close immediately             | Stop the decoder output pool from starving and freezing playback                                                                                                                                     |
| 2026-06    | Export reuses `resolveTimeline` + shared placement math             | One rendering truth for preview and export; no export-specific scene system                                                                                                                          |
| 2026-06-07 | Snapshot overlay for transitions (not GPU crossfade)                | Avoids decoder contention; preview = CSS opacity on a frozen canvas snapshot; export = `globalAlpha=1-t` pass; adding new transition kinds requires only a CSS mapping, no resolver or shader change |
| 2026-06-07 | Standalone `MediaTransformOverlay` (not unified with `TextOverlay`) | Kept the proven text path untouched; gesture math is a copy; unification deferred until both overlays are stable and a shared hook is obviously better                                               |

See [`ARCHITECTURE.md` § anti-patterns](./ARCHITECTURE.md#9-what-this-architecture-rejects-anti-patterns)
for the standing list of things this project deliberately does not build.
