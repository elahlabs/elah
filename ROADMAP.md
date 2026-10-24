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
| **Video & image transform overlay** | `MediaTransformOverlay` — click-select, drag-move, 8 resize handles with non-uniform scale (Shift keeps aspect), Resize/Crop toggle; writes `transform` through `previewClip`/`commitInteraction` (one undo per gesture); export parity automatic (transform already flowed through both renderers) |
| **Timeline thumbnails + waveforms** | Filmstrip tiles and real waveform peaks per asset; generated once on drop, cached on `MediaAsset`; displayed in `ClipBlock` |
| **Audio-on-drop dialog** | 3-choice modal on video drop with audio; both clips in one `engine.batch` (one undo entry) |
| **Transitions** (9 kinds, 1.0.0) | `fade`, `slide`, `wipe`, `zoom`, `spin`, `whip`, `glitchCut`, `warpDissolve`, `lumaWipe`. `resolveTimeline` keeps both clips in the scene and fills `Scene.transitions`; the WebGL2 renderer composites the pair with one shader in preview and export. `slide` and `whip` take a direction (left, right, up, down) |
| **Multiple video tracks** (0.6.0) | `addTrack('video')` adds a lane; video lanes composite in track order, topmost on top. Decode is still unscheduled |
| **Clip speed, crop, corner radius** (0.6.0) | `Clip.speed` (0.25–4, honoured by export), `Clip.crop`, `Clip.cornerRadius`; crop editable in `MediaTransformOverlay` |
| **Text templates & layered motion** (0.6.0) | 14 `BUILT_IN_TEXT_TEMPLATES`, `applyTextTemplate`, `MotionSpec` entry/exit; template `stagger`/`tracking` are not executed |
| **Frame sequences** (0.6.0) | `createFrameSequence`, `FrameSequenceController`, `frameSequenceToProject` |
| **Stored projects & library snapshot** (0.6.0) | `readProjectDocument`, `relinkProjectMedia`, `loadProject` options + `project:loaded`; `snapshotMediaLibrary` / `hydrateMediaLibrary` (host supplies storage) |
| **Protected / pinned tracks** (0.6.0) | `Track.protected`, `Track.pinned: 'bottom'` |
| **Motion layer** (1.0.0) | Keyframes on every transform channel, the full ease set, springs, hold, stagger, motion paths, text animators, scramble, repeat/yoyo, skew, 3D tilt, expressions, 36 motion presets |
| **Effects, generators, blend modes, mattes** (1.0.0) | 23 GPU effects with bundles and looks, 8 generators, masks, track mattes, blend modes; one WebGL2 pipeline for preview and export |
| **New clip types** (1.0.0) | `adjustment`, `generator`, `compound`, `sequence`; project document version 5; the timeline draws them, the editor plays, saves and exports them |
| **Clip audio** (1.0.0) | `Clip.audio`: mute, boost, fades and Enhance, one envelope for preview and export |
| **Lottie and SVG import** (1.0.0) | `lottieToClip`, `svgToProject` |
| **Export containers** (1.0.0) | MP4, WebM (transparent where supported), GIF, PNG sequence; `avc`, `hevc`, `av1`, `vp9`, `vp8` where the browser can encode; in/out range |
| **VideoSpec, HTML/CSS scenes, editor ops** (1.0.0, experimental) | `compileVideoSpec` / `buildVideo` / `layProject`, `validateScene` / `sceneToClip`, 57 typed ops with `applyOps` / `sanitizeOps` |
| **Fonts in the package, CDN-safe workers, `@elah/core/engine`** (1.0.0) | 12 OFL fonts shipped (opt-in `packageFontsBaseUrl()`); workers start from a cross-origin URL; a browser-free engine entry for React Native and Node |

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

This is the seam that `Scene.transitions` and the `StreamingFrameProducer`
lookahead/hysteresis logic are shaped to grow into.

---

## Feature backlog

- **Rotation handle for video/image** — `transform.rotation` already flows through both renderers; the interactive handle in `MediaTransformOverlay` is the only missing piece (text clips already have a rotate knob)
- **Editing UI for the 1.0.0 clip types** — an inspector, curve editor, effect stack and compound editor in `@elah/timeline` / `@elah/editor` for adjustment, generator, compound and sequence clips; today they are driven through the engine, ops or VideoSpec
- **A host-side scene measurer** — `sceneToClip` converts a *measured* HTML/CSS scene; a DOM measurer that produces the `MeasuredScene` is not in the packages
- **Template stagger/tracking** — `applyTextTemplate` ignores a template's `stagger` and `tracking`
- **`@elah/cli` release** — the CLI keeps its own version; the next release moves it to `@elah/core@^1.0.0`, and an ffmpeg layer is planned but not designed
- **Playback correctness** — reverse scrub stability, predictive frame caching, black-frame elimination at clip boundaries; requires the scheduler layer (see above)
- **Export frame-accuracy** — half-frame phase offset between preview (center-of-frame) and export (start-of-frame); golden-frame parity harness
- Multi-track **video** *tuning* — multiple video tracks shipped in 0.6.0 (multi-track **audio** in 0.3.0), but several simultaneously decoding clips still need the scheduler layer above
- Asset persistence — **partly shipped in 0.6.0**: `snapshotMediaLibrary` / `hydrateMediaLibrary` and `readProjectDocument` / `relinkProjectMedia` are the seam, with the host supplying storage. Still open: a built-in IndexedDB / OPFS adapter and storing the bytes of locally imported files (`blob:` URLs do not survive a reload)
- WebGPU backend behind the existing `Renderer` interface
- **React Native binding** (`@elah/react-native`) — **timeline first**. The base is built: shared timeline math in `@elah/core` and a tested gesture model in `packages/react-native`. The device work is cut into contributor issues RN-T1 to RN-T9 ([`docs/react-native/issues/`](./docs/react-native/issues/README.md)), starting with a Metro-safe `@elah/core/engine` entry. Skia preview, native decode/encode and export follow the timeline. Hand-off docs in [`docs/react-native/`](./docs/react-native/README.md)

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
| 2026-06-07 | Snapshot overlay for transitions (not GPU crossfade) | Avoids decoder contention; preview = CSS opacity on a frozen canvas snapshot; export = `globalAlpha=1-t` pass; adding new transition kinds requires only a CSS mapping, no resolver or shader change. **Superseded in 1.0.0** by one WebGL2 transition shader that composites both clips (see the next row) |
| 2026-10 | Converge `@elah/core` with the engine our own editor runs on, release as 1.0.0 | One engine instead of two; the model-facing layers (`spec`, `vector/html`, `ops`) ship open but experimental, and the rest of the exported surface becomes a semver promise |
| 2026-06-07 | Standalone `MediaTransformOverlay` (not unified with `TextOverlay`) | Kept the proven text path untouched; gesture math is a copy; unification deferred until both overlays are stable and a shared hook is obviously better |

See [`ARCHITECTURE.md` § anti-patterns](./ARCHITECTURE.md#9-what-this-architecture-rejects-anti-patterns)
for the standing list of things this project deliberately does not build.
