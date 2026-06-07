# `core/renderer/gpu`

WebGL2 GPU renderer — the concrete implementation of the `Renderer` interface that composites a `Scene` onto a hardware-accelerated canvas.

End-to-end pipeline:

```
Scene → RenderGraph → VideoLayer → core/media/video (VideoFrameProvider) → VideoTexture
     → TexturePool → ShaderProgram → WebGL draw → canvas output
```

Decode lives in [`../../media/video/`](../../media/video/) — this folder is compositing only.

---

## Folder map

```
gpu/
├── README.md                ← you are here
├── GpuRenderer.ts           ← Renderer impl (mount/resize/render/dispose/setDebug)
├── RenderGraph.ts           ← Scene diffing + layer dispatch
├── WebGLContext.ts          ← canvas + GL context lifecycle
├── ShaderProgram.ts         ← compile/link/uniform helper
├── TexturePool.ts           ← LRU texture allocator
├── VideoTexture.ts          ← per-clip texture handle
├── types.ts                 ← Viewport, RendererOptions, SceneDiff
├── shaders/
│   ├── quad.vert.ts         ← textured quad vertex shader
│   └── quad.frag.ts         ← textured quad fragment shader
├── layers/
│   ├── types.ts             ← Layer<TItem> + LayerContext interfaces
│   ├── VideoLayer.ts        ← ActiveVideoClip → texture → draw
│   └── TestLayer.ts         ← solid-colour quads (debug renderer only)
├── debug/
│   ├── GpuRendererDebugPanel.ts ← production renderer DOM overlay
│   ├── DebugGpuRenderer.ts      ← isolated debug pipeline using TestLayer
│   ├── DebugOverlay.ts          ← FPS + bounding boxes for scenarios
│   ├── GpuDebugCounters.ts      ← metric counters (cache hits, latency, …)
│   ├── GpuDebugGlobal.ts        ← optional `window.__GPU_DEBUG__`
│   ├── playground.ts            ← `loadDebugScenario()` manual harness
│   ├── scenarios.ts             ← validation scenarios A–E
│   └── types.ts
└── __tests__/                   ← compositing-only vitest suites

core/media/video/              ← decode pipeline (moved out of gpu/)
├── VideoFrameProvider.ts      ← Mock + Synthetic + factory (push interface)
├── VideoDecoderManager.ts     ← per-source decoder: feed/reset/onFrame/drain
├── FrameCache.ts              ← forward-oriented cache of decoded VideoFrames
├── StreamingFrameProducer.ts  ← push-based VideoFrameProvider implementation
├── demuxer/                   ← MediabunnyDemuxer + createMediabunnyBackend
└── __tests__/                   ← decode + demuxer vitest suites
```

---

## Architectural boundaries

This folder may only import from:

- `core/resolver/scene.ts` (the `Scene` shape and clip types)
- `core/types` (shared value types: `Transform`, etc.)
- `core/media/video` (public barrel or `VideoFrameProvider` type module only)
- Standard browser APIs (`WebGL2RenderingContext`, `VideoDecoder`, `OffscreenCanvas`, …)

**Forbidden imports:** `Project`, `Track`, `Clip`, `TimelineEngine`, `PlaybackEngine`, any Zustand store, any React package, deep imports into `core/media/video/**` beyond the barrel/`VideoFrameProvider` module. Violations break the architecture's isolation guarantee.

Import rules are enforced by [`core/media/__tests__/ImportBoundary.test.ts`](../../media/__tests__/ImportBoundary.test.ts).

---

## `GpuRenderer.ts`

Implements `Renderer`. Owns `WebGLContext`, `TexturePool`, `RenderGraph`, and a single `VideoLayer` registered against `scene.videos`.

```ts
const renderer = new GpuRenderer({ maxTextures: 16, clearColor: [0, 0, 0, 1] })
renderer.mount(container)
renderer.resize(cssW, cssH, window.devicePixelRatio)
renderer.render(scene)   // synchronous, idempotent on equal scene refs
renderer.setDebug(true)  // optional DOM overlay
renderer.dispose()
```

**`RendererOptions`:**

- `maxTextures?: number` — pool cap (default 16).
- `clearColor?: [r, g, b, a]` — default opaque black.
- `providerFactory?: (src) => VideoFrameProvider` — inject test/custom providers.

**Lifecycle:**

- `mount(container)` — creates canvas, GL context, texture pool, video layer, and render graph. Guards against double-mount.
- `resize(w, h, dpr)` — updates the backing-store and viewport; does not re-allocate textures.
- `render(scene)` — measures FPS and render duration, clears, then executes the render graph. No-ops on equal scene refs or a lost context.
- `setDebug(enabled)` — mounts/unmounts a polling DOM overlay (FPS, frame, clips, textures, cache hit ratio, render duration).
- `dispose()` — disposes the render graph (which releases textures back to the pool), then disposes the pool, then the GL context. Order matters: pool disposal must come **after** the graph so acquired textures get returned before GL-delete.

---

## `RenderGraph.ts`

Stateful scene-diff engine. On each `execute(scene, ctx)`:

1. Diff each layer's active items against the current Scene slice.
2. Call `acquire()` for entering items, `release()` for leaving items.
3. Build a flat draw list sorted stable by `zIndex` ascending.
4. Issue `draw()` on each active item.

`registerLayer()` lets you add a new clip kind without modifying RenderGraph itself.

---

## `WebGLContext.ts`

The **only** file that calls `canvas.getContext('webgl2')`. Handles canvas creation, WebGL2 (with WebGL1 fallback), `webglcontextlost`/`webglcontextrestored`, resize (CSS × DPR), and global GL state (premultiplied-alpha blend, clear colour).

---

## `ShaderProgram.ts`

Compile / link helper with a per-instance uniform-location cache. Typed setters (`setUniform1f`, `setUniformMatrix3fv`, …) so call sites never touch raw GL uniform APIs.

## `shaders/`

`#version 300 es` textured quad: vertex shader uses `gl_VertexID` (no VBO required) and applies `uTransform` (mat3). Fragment shader samples `uTexture` × `uOpacity` with premultiplied output. Reused by every quad layer.

---

## `TexturePool.ts`

Capped LRU allocator for `WebGLTexture` handles keyed by `{ width, height, internalFormat }`. Default cap 16. `acquire()` reuses a matching free entry, allocates fresh up to the cap, or evicts the oldest free entry. `handleContextLost()` clears bookkeeping without GL deletes; `dispose(gl)` deletes every free entry.

## `VideoTexture.ts`

Per-clip handle backed by `TexturePool`. `upload(gl, frame)` is the single `texImage2D` abstraction — it uploads pixel data and **immediately** calls `frame.close()` (frame-ownership rule). Re-acquires from the pool when dimensions change. `bind(gl, unit)` returns `-1` if nothing has been uploaded yet.

---

## `layers/VideoLayer.ts`

Implements `Layer<ActiveVideoClip>`:

- One `VideoFrameProvider` **per unique `src`** (shared across clips, ref-counted). Providers come from [`core/media/video`](../../media/video/).
- One `VideoTexture` **per clip id**.
- `draw()` is synchronous: calls `provider.setPlayhead(sourceFrame)` (fire-and-forget, drives internal decode), then tries `provider.getCurrent(sourceFrame)`; uploads on hit, keeps the previous texture content to prevent flicker on miss.
- Issues a quad draw with `uTransform` (built from `transform.x/y/scale/anchor/rotation`) and `uOpacity`.
- `notifyContextLost()` nulls the shader program / VAO so `_ensurePipeline()` rebuilds on the next acquire.

## Decode pipeline (`core/media/video/`)

See [`../../media/video/README.md`](../../media/video/README.md) and [`../../media/README.md`](../../media/README.md).

- **`VideoFrameProvider`** — push-based interface: `setPlayhead(N)` (fire-and-forget) + sync `getCurrent(N)`; Mock, Synthetic, and `StreamingFrameProducer` implementations.
- **`VideoDecoderManager`** — one `VideoDecoder` + demuxer per unique source URL.
- **`FrameCache`** — bounded map of decoded `VideoFrame`s keyed by source frame number.
- **`demuxer/`** — Mediabunny adapter + `createMediabunnyBackend`.

---

## `debug/`

All optional, importable without affecting the production pipeline.

| File | Role |
|---|---|
| `GpuRendererDebugPanel.ts` | DOM overlay used by `GpuRenderer.setDebug(true)`. Polls a `DebugPanelSnapshot` getter every 100 ms — no GL coupling. |
| `DebugGpuRenderer.ts` | Parallel renderer wired to `TestLayer` (solid-colour quads). Exercises shader/transform/zIndex paths with no decode. |
| `DebugOverlay.ts` | FPS + bounding boxes for scenario rendering. |
| `GpuDebugCounters.ts` | Static counters: cache hits/misses, decode latency, upload timing. Used by debug overlay + tests. |
| `GpuDebugGlobal.ts` | Optional `window.__GPU_DEBUG__` getter for live inspection. |
| `playground.ts` | `loadDebugScenario(container, 'A'..'E')` mounts the debug renderer + overlay. |
| `scenarios.ts` | Validation scenarios A–E: overlap, transform, opacity, full-stage. |

`apps/playground/src/GpuPreview.tsx` is the production wiring example — RAF loop, `playback.getFrameAt()`, `resolveTimeline()`, and `renderer.render(scene)`.

---

## Tests

**Compositing suites** under `gpu/__tests__/` (mock GL + DOM):

| File | Focus |
|---|---|
| `GpuRenderer` is exercised indirectly via | `RenderSynchronization`, `ErrorHandling`, `DebugGpuRenderer` |
| `RenderSynchronization.test.ts` | sourceFrame correctness, seek recovery, idempotent render, context-loss re-acquire |
| `RenderGraph.test.ts` | zIndex order, diff/acquire/release |
| `VideoLayer.test.ts` | provider sharing, transform/opacity uniforms, draw synchrony |
| `ErrorHandling.test.ts` | errored decoder, pool exhaustion, isolation |
| `GoldenFrameHash.test.ts` | draw call sequence stability |
| `CanvasValidation.test.ts` | helpers (`captureFrame`, `hashFrame`, `samplePixel`, `expectPixelApprox`) |
| `TestLayer.test.ts` | debug quad lifecycle |
| `DebugGpuRenderer.test.ts` | debug renderer lifecycle |

**Decode suites** under [`core/media/video/__tests__/`](../../media/video/__tests__/) include `VideoFrameProvider`, `VideoDecoderManager`, `FrameCache`, demuxer, and stress tests (`PlaybackStress`, `RapidSeekStress`, …).

Helpers: `gpu/__tests__/helpers/` (`trackingFrame.ts`, `canvasValidation.ts`); `media/video/__tests__/helpers/mockDemuxer.ts`.

---

## Context loss recovery

`GpuRenderer._handleContextLost()` runs in this order (it matters):

1. `texturePool.handleContextLost()` — clear bookkeeping without GL deletes.
2. `videoLayer.notifyContextLost()` — null each `VideoTexture._entry`, null shader program / VAO references.
3. `renderGraph.notifyContextLost()` — release every active item (no-op for textures since step 2 already neutered them).
4. Reset `_lastScene` so the next render re-acquires everything.

On `_handleContextRestored()`, the next `render()` triggers `VideoLayer._ensurePipeline()` which recompiles the shader program and rebuilds the VAO. `FrameCache` and `VideoDecoderManager` hold no GL objects and survive unchanged.

| Module | Holds GL? | Recovery |
|---|---|---|
| `WebGLContext` | yes (the context itself) | re-acquires on `webglcontextrestored`, re-runs `_initGLState()` |
| `TexturePool` | yes | `handleContextLost()` clears handles |
| `VideoTexture` | yes (entry ref) | `handleContextLost()` nulls `_entry`; next `upload()` re-acquires |
| `VideoLayer` | yes (program + VAO) | `notifyContextLost()` nulls them; `_ensurePipeline()` rebuilds on next acquire |
| `RenderGraph` | no (just bookkeeping) | `notifyContextLost()` releases active items |
| `FrameCache` | no | unchanged |
| `VideoDecoderManager` | no | unchanged |
