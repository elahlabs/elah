# `core/renderer/gpu`

WebGL2 GPU renderer — the concrete implementation of the `Renderer` interface that composites a `Scene` onto a hardware-accelerated canvas.

---

## Folder map

```
gpu/
├── README.md               ← you are here
├── WebGLContext.ts         ← canvas + GL context lifecycle (Phase 1 ✓)
├── ShaderProgram.ts        ← compile/link/uniform helper (Phase 1 ✓)
├── GpuRenderer.ts          ← Renderer impl: mount/resize/render/dispose (Phase 2)
├── RenderGraph.ts          ← Scene diffing + layer dispatch (Phase 2)
├── TexturePool.ts          ← LRU texture allocator (Phase 2 ✓)
├── VideoTexture.ts         ← per-clip texture handle (Phase 2 ✓)
├── VideoFrameProvider.ts   ← sync best-effort getter + async prefetch (Phase 2)
├── VideoDecoderManager.ts  ← VideoDecoder state machine per source (Phase 2)
├── FrameCache.ts           ← ring buffer of decoded VideoFrames (Phase 2)
├── shaders/
│   ├── quad.vert.ts        ← textured quad vertex shader (Phase 1 ✓)
│   └── quad.frag.ts        ← textured quad fragment shader (Phase 1 ✓)
├── layers/
│   ├── types.ts            ← Layer<TItem> + LayerContext interfaces (Phase 1 ✓)
│   └── VideoLayer.ts       ← ActiveVideoClip → texture → draw (Phase 2)
└── demuxer/
    └── MediabunnyDemuxer.ts ← lazy mediabunny adapter (Phase 2)
```

Legend: `✓` = implemented, no label = not yet written.

---

## Architectural boundaries

This entire folder may only import from:

- `core/resolver/scene.ts` (the `Scene` shape and clip types)
- `core/types` (shared value types: `Transform`, etc.)
- Standard browser APIs (`WebGL2RenderingContext`, `VideoDecoder`, `OffscreenCanvas`, …)

**Forbidden imports:** `Project`, `Track`, `Clip`, `TimelineEngine`, `PlaybackEngine`, any Zustand store, any React package. Violations break the architecture's isolation guarantee and will cause circular dependency errors.

---

## Module responsibilities

### `WebGLContext.ts` (Phase 1)

The **only** file that calls `canvas.getContext('webgl2')`. Owns:

- Canvas element creation and attachment.
- WebGL2 context acquisition with WebGL1 fallback.
- `webglcontextlost` / `webglcontextrestored` event handling. On loss it nulls the context and fires `onLost`; on restore it re-acquires, re-initialises GL state, and fires `onRestore` so callers rebuild their GPU objects.
- Physical canvas resize (backing-store = CSS pixels × DPR) and `gl.viewport` sync.
- Global GL state: premultiplied-alpha blend, clear colour.

```ts
const ctx = new WebGLContext({ onLost, onRestore })
ctx.resize(cssW, cssH, window.devicePixelRatio)
ctx.clear()
const gl = ctx.gl  // null while lost — always guard
```

### `ShaderProgram.ts` (Phase 1)

Compile / link helper with a per-instance `WebGLUniformLocation` cache. Shaders are detached and deleted after link. Provides typed setters (`setUniform1f`, `setUniformMatrix3fv`, …) so call sites never touch raw GL uniform APIs.

```ts
const prog = ShaderProgram.create(gl, QUAD_VERT_SRC, QUAD_FRAG_SRC)
prog.use(gl)
prog.setUniform1i(gl, 'uTexture', 0)
prog.setUniform1f(gl, 'uOpacity', clip.opacity)
prog.setUniformMatrix3fv(gl, 'uTransform', false, mat)
```

### `shaders/quad.vert.ts` + `shaders/quad.frag.ts` (Phase 1)

GLSL `#version 300 es` sources for a textured quad drawn as `TRIANGLE_STRIP` over 4 vertices. The vertex shader uses `gl_VertexID` — no VBO required. The fragment shader samples `uTexture` and multiplies by `uOpacity` for premultiplied-alpha compositing. Reused by every layer that draws a rectangular region (VideoLayer, future ImageLayer, future TextLayer).

### `layers/types.ts` (Phase 1)

`Layer<TItem>` and `LayerContext` interfaces. A Layer encapsulates all GPU resources and draw logic for one clip kind. `RenderGraph` holds a registry of Layer instances and calls `acquire` / `release` / `draw` based on Scene diffs. Adding a new clip kind (text, image, effect) means writing a new `Layer` implementation — no changes to RenderGraph.

```ts
interface Layer<TItem> {
  acquire(item: TItem, ctx: LayerContext): void   // item entered Scene
  release(itemId: string): void                   // item left Scene
  draw(item: TItem, ctx: LayerContext): void       // called once per frame per item
  dispose(): void
}
```

### `TexturePool.ts` (Phase 2)

Capped LRU allocator for `WebGLTexture` handles keyed by `{ width, height, internalFormat }`. Hard cap defaults to 16 textures. `acquire()` reuses a matching free entry or allocates fresh; when the cap is hit it evicts the oldest released texture before allocating. `release()` returns a handle to the pool. `handleContextLost()` clears bookkeeping without GL deletes.

```ts
const pool = new TexturePool({ maxTextures: 16 })
const entry = pool.acquire(gl, 1920, 1080)  // null if pool exhausted
pool.release(entry)
pool.handleContextLost()  // on webglcontextlost
pool.dispose(gl)
```

### `VideoTexture.ts` (Phase 2)

Thin per-clip handle bound to a shared `TexturePool`. `upload(gl, frame)` is the single `texImage2D` abstraction — it uploads pixel data and **immediately** calls `frame.close()` (frame ownership rule). Re-acquires from the pool when dimensions change. `bind(gl, unit)` activates the texture for drawing; returns `-1` if nothing uploaded yet.

```ts
const texture = new VideoTexture(pool)
if (texture.upload(gl, videoFrame)) {
  texture.bind(gl, 0)
  prog.setUniform1i(gl, 'uTexture', 0)
}
texture.release()
```

---

## Phase 2 modules (not yet written)

### `GpuRenderer.ts`

Implements `Renderer`. Owns `WebGLContext`, `RenderGraph`, and all Layer instances. Entry point for the GPU pipeline. See the plan doc for the full lifecycle spec (`mount` → `resize` → `render` loop → `dispose`).

### `RenderGraph.ts`

Receives `Scene`, diffs it against the previous Scene to detect entering/leaving clip ids, drives `acquire`/`release`/`draw` on each Layer in ascending `zIndex` order. Single chokepoint for compositing decisions.

### `VideoFrameProvider.ts`

Per-source orchestrator combining `VideoDecoderManager` + `FrameCache`. Exposes:
- `getCurrent(sourceFrame)` — synchronous best-effort getter (returns `null` if not decoded yet).
- `requestFrame(sourceFrame)` — fire-and-forget async decode.
- `prefetch(from, count)` — forward prefetch hint.

### `VideoDecoderManager.ts`

One `VideoDecoder` + one `MediabunnyDemuxer` per unique source URL. State machine: `Idle → Opening → Ready → Decoding → Seeking → Draining`. Keyed by `src` so two clips that trim the same file share one decoder.

### `FrameCache.ts`

Ring buffer of decoded `VideoFrame`s keyed by source frame number. Hard cap (e.g. 8 frames). Evicts in source-frame order; closes evicted frames. **Frame ownership rule:** the cache owns every `VideoFrame` until it is uploaded to a texture, at which point `VideoTexture.upload` closes it.

### `demuxer/MediabunnyDemuxer.ts`

Thin adapter that **lazy-imports** `mediabunny` (so the dependency is never in the main bundle until a video clip plays). Exposes `open(src)` → `{ config, packets(timeRange) }`. Single seam for swapping demuxers.

### `layers/VideoLayer.ts`

Implements `Layer<ActiveVideoClip>`. Owns a `VideoFrameProvider` per unique `src` (not per clip). On `draw`: calls `getCurrent`, uploads to `VideoTexture` if a frame is available (keeps last texture otherwise to prevent flicker), then issues a quad draw with `uTransform` + `uOpacity`.

---

## Context loss recovery checklist

When `WebGLContext.onRestore` fires, every module that holds GL objects must rebuild them:

- [ ] `ShaderProgram` — re-compile via `ShaderProgram.create`
- [x] `TexturePool` — `handleContextLost()` clears all handles; re-allocate on next `acquire`
- [x] `VideoTexture` — `handleContextLost()` nulls handle; re-upload on next `upload`
- [ ] Vertex buffers (if any are added) — re-create and re-upload

`FrameCache` and `VideoDecoderManager` do **not** hold GL objects; they survive context loss unchanged.
