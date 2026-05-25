# PR Split-03 — `TextLayer` (Canvas2D → GL texture)

> Standalone ticket. Pick this up cold. Read the whole thing top to bottom; the **copy-paste prompt** at the bottom is what you hand to an AI coding agent.
>
> Companion reading (do not skip):
>
> - **Prerequisites (merged):** [PR-media-split-01](./PR-media-split-01-structural-move.md), [PR-media-split-02](./PR-media-split-02-streaming-producer.md)
> - Master plan: `.cursor/plans/media-renderer-split-mvp_c1e1a43a.plan.md` (Session 3 section)
> - [`../packages/editor/src/core/resolver/scene.ts`](../packages/editor/src/core/resolver/scene.ts) — `ActiveTextClip`
> - [`../packages/editor/src/core/renderer/gpu/layers/VideoLayer.ts`](../packages/editor/src/core/renderer/gpu/layers/VideoLayer.ts) — layer pattern reference

---

## Status

🔴 Not started.

**Prerequisites:** Split-01 and Split-02 merged (video playback working).

**Next ticket after merge:** [PR-media-split-04-audio-playback.md](./PR-media-split-04-audio-playback.md)

---

## Goal

Add a `TextLayer` that renders `ActiveTextClip` items from the Scene onto the GPU canvas. Text is rasterized synchronously via Canvas2D, uploaded as a GL texture, and drawn with the existing `quad` shader (same path as video quads).

After this PR, adding a text clip to a project shows readable text in the playground preview, respecting `zIndex` and `opacity`.

---

## Why this matters

`resolveTimeline()` already emits `scene.texts: ActiveTextClip[]`, but no layer consumes them — text is dead data today. This ticket proves the **layer registration extension story**: new clip types plug into `RenderGraph` without touching decode or the resolver.

Text is the simplest non-video layer: no async decode, no cache, no WebCodecs. Ship it before audio to validate compositing patterns.

---

## Frozen surfaces (do not touch unless listed in Scope → In)

- `packages/editor/src/core/resolver/**`
- `packages/editor/src/core/media/**` (decode pipeline)
- `packages/editor/src/core/renderer/gpu/WebGLContext.ts`, `ShaderProgram.ts`, `VideoTexture.ts` logic (reuse, don't rewrite)
- Audio (Session 4)

---

## Scope

**In:**

- New: `packages/editor/src/core/renderer/gpu/layers/TextLayer.ts`
- New: `packages/editor/src/core/renderer/gpu/textures/TextureRasterizer.ts`
- Update: `packages/editor/src/core/renderer/gpu/GpuRenderer.ts` — register TextLayer in `mount()`
- New: `packages/editor/src/core/renderer/gpu/__tests__/TextLayer.test.ts`
- Smoke: add a static text clip to `apps/playground/src/App.tsx` demo project

**Out:**

- ImageLayer (deferred to polish session)
- Rich text (wrap, markdown, fonts beyond a sensible default)
- Text animation / keyframes
- Text transitions (fade-in/out — polish session A)
- Audio

---

## Design

### Layer contract

`TextLayer` implements `Layer<ActiveTextClip>` from `layers/types.ts`:

```ts
acquire(item: ActiveTextClip, ctx: LayerContext): void
draw(item: ActiveTextClip, ctx: LayerContext): void
release(itemId: string): void
dispose(): void
```

### Per-clip state

- One offscreen canvas per clip id (`OffscreenCanvas` with `HTMLCanvasElement` fallback in environments without OffscreenCanvas)
- One `VideoTexture` (or texture handle from `TexturePool`) per clip id
- Last rasterized content hash (content + font + color) to skip redundant uploads

### `draw()` flow

```ts
draw(item, ctx) {
  if (contentOrStyleChanged(item)) {
    TextureRasterizer.rasterizeText(canvas, item.content, style)
    texture.upload(ctx.gl, canvas)  // texImage2D from canvas/ImageBitmap
  }
  // Reuse quad shader + transform matrix (same as VideoLayer)
  program.use(gl)
  setUniforms(opacity: item.opacity, transform: buildTransformMatrix(...))
  gl.drawArrays(TRIANGLE_STRIP, 0, 4)
}
```

Reuse transform helpers from `VideoLayer.ts` where possible (`buildVideoTransformMatrix` / `resolveVideoDrawRect` — extract shared util if duplication is >10 lines).

### `TextureRasterizer` helper

`packages/editor/src/core/renderer/gpu/textures/TextureRasterizer.ts`:

```ts
export interface TextRasterStyle {
  font?: string      // default: 'bold 48px sans-serif'
  color?: string     // default: '#ffffff'
  padding?: number   // default: 8
}

export function rasterizeText(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  content: string,
  style?: TextRasterStyle,
): { width: number; height: number }
```

Resize canvas to fit measured text + padding. Clear, fill background transparent, `fillText` centered or top-left (pick one, document in code).

Future ImageLayer will reuse a sibling `rasterizeImage()` in the same module.

### Registration in `GpuRenderer.mount()`

```ts
this._textLayer = new TextLayer(this._texturePool)
this._renderGraph.registerLayer(
  this._textLayer,
  (scene) => scene.texts,
  (item) => item.id,
  (item) => item.zIndex,
)
```

Dispose `_textLayer` in `GpuRenderer.dispose()` alongside video layer cleanup.

### Shader

Reuse existing `quad.vert` + `quad.frag` — **no new shader** for MVP.

---

## Acceptance criteria

1. `TextLayer.ts` and `TextureRasterizer.ts` exist and compile.
2. `GpuRenderer` registers TextLayer; `RenderGraph.execute()` draws text clips when present in Scene.
3. Playground demo includes at least one text clip; text is visible on canvas during preview.
4. Changing `item.content` between ticks triggers re-rasterization (test asserts upload called twice).
5. Text respects `opacity` uniform (test or manual verify).
6. Text respects `zIndex` — text above video when on higher track, below when on lower track.
7. `TextLayer.test.ts` passes (texture upload, content change, opacity).
8. Full vitest suite green; typecheck clean.
9. No changes to resolver or media decode modules.

---

## Out of scope

- ImageLayer
- Custom fonts / font picker UI
- Text editing in preview (timeline/editor UI only)
- Subtitles / captions timing
- GPU text rendering (SDF, MSDF) — Canvas2D is fine for MVP

---

## Implementation notes

- `ActiveTextClip` fields today: `id`, `content`, `opacity`, `transform?`, `zIndex`, `sourceFrame` (ignore sourceFrame for static text).
- If canvas is empty (zero-length content), skip draw or draw nothing — do not upload 0×0 texture.
- Match VideoLayer's `notifyContextLost` / `disposeGL` pattern if TextLayer holds GL handles.
- Playground smoke: use `createTextClip()` from `@elah/editor` public API if available.

---

## Verification

1. **Unit:** `npm test -- --run TextLayer`
2. **Full suite:** `npm test --workspace=packages/editor`
3. **Manual:** playground with video + text overlay; scrub timeline; text stays visible when clip is active.

---

## Copy-paste prompt for an implementation agent

```
You are implementing a backlog ticket for the @elah/editor repo.

Ticket: docs/backlog/PR-media-split-03-text-layer.md
Prerequisites: PR-media-split-01 and PR-media-split-02 MUST be merged (video plays).

Read in this order before writing any code:
1. docs/backlog/PR-media-split-03-text-layer.md (this ticket — top to bottom)
2. packages/editor/src/core/resolver/scene.ts — ActiveTextClip
3. packages/editor/src/core/renderer/gpu/layers/VideoLayer.ts — Layer pattern + transform helpers
4. packages/editor/src/core/renderer/gpu/GpuRenderer.ts — registerLayer usage

Then implement TextLayer + TextureRasterizer and register in GpuRenderer.

Hard constraints:
- Synchronous only — no decode, no async, no WebCodecs for text.
- Reuse quad shader — do not add new shaders.
- Do NOT touch resolver, media/video decode, or audio.
- Register layer for scene.texts with zIndex ordering.

Walk the ticket's "Acceptance criteria" section item by item before declaring done.
Add playground smoke text clip. Run typecheck and full test suite.

If you find a reason to go outside scope, stop and surface the question.
```
