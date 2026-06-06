# `core/renderer`

Renderer abstraction layer. Defines the contract every renderer must honour and hosts concrete renderer implementations as sub-folders.

---

## What lives here

| Path | Role |
|---|---|
| `types.ts` | `Renderer` interface — the only public contract |
| `gpu/` | WebGL2 GPU renderer — end-to-end video pipeline + debug tooling |

---

## The `Renderer` interface (`types.ts`)

```
mount(container: HTMLElement): void
resize(cssWidth, cssHeight, dpr?): void
render(scene: Scene): void
dispose(): void
```

Every concrete renderer implements exactly these four methods. The interface is intentionally minimal so renderers stay interchangeable without touching callers.

**Hard rules that every implementation must respect:**

- Reads **only** the `Scene` it receives. Never imports `Project`, `Track`, `Clip`, `TimelineEngine`, `PlaybackEngine`, or any Zustand store.
- `render(scene)` is **synchronous**. Async work (decoding, uploading) fires out-of-band; the caller is never blocked.
- `render(scene)` is **idempotent on equal references** — if `scene === lastScene` return immediately.
- `resize` updates the physical canvas; `Scene.stage` is the logical coordinate space.

---

## Renderer implementations

| Folder | Status | Description |
|---|---|---|
| `gpu/` | ✅ Shipped | WebGL2 GPU compositor — `Scene → RenderGraph → VideoLayer/ImageLayer/TextLayer → VideoTexture → quad draw` |
| (WebGPU) | ⚪ Future | A WebGPU backend behind the same interface, for shader effects/transitions |

`gpu/` is the only `Renderer` implementation. There is **no** DOM or Canvas2D
renderer — the textured-quad path already generalizes to image and text.

**Export is not a `Renderer`.** It lives in [`../export/`](../export/) and
draws to a 2D `OffscreenCanvas` in a worker, reusing this folder's *placement*
helpers (`gpu/layers/drawRect.ts`, `gpu/layers/textLayout.ts`) so preview and
export stay pixel-aligned without a GPU context in the worker. See
[`../export/Architecture.md`](../export/Architecture.md).

Any future implementation shares the same `Renderer` interface and consumes the
same `Scene`. Swapping one in requires no changes to `PlaybackEngine`,
`resolveTimeline`, or any React component.

`GpuRenderer` is exported from the package root as `@elah/editor`:

```ts
import { GpuRenderer, resolveTimeline } from '@elah/editor'

const renderer = new GpuRenderer({ maxTextures: 16 })
renderer.mount(containerEl)
renderer.setDebug(true) // optional dev overlay
renderer.render(resolveTimeline(currentFrame, project))
```

See [`gpu/README.md`](./gpu/README.md) for the full GPU pipeline architecture and module map.

---

## Wiring a real decoder (Phase 1)

By default `GpuRenderer` uses `SyntheticVideoFrameProvider` (browser) or
`MockVideoFrameProvider` (jsdom). To enable real `VideoDecoder`-backed decode via
the mediabunny library:

```ts
import * as mediabunny from 'mediabunny'
import { GpuRenderer, resolveTimeline, createMediabunnyBackend } from '@elah/editor'

const renderer = new GpuRenderer({
  maxTextures: 16,
  // Factory is called once per unique src; each call returns a fresh backend.
  demuxerFactory: () => createMediabunnyBackend(mediabunny, {
    // Optional: provide a Blob/File directly to avoid a fetch round-trip.
    // Omitting this falls back to fetch(src).blob() which works for object URLs.
    // blobResolver: (src) => myFileMap.get(src) ?? fetch(src).then(r => r.blob()),
  }),
  maxOutstandingDecodes: 4, // cap in-flight decodes per provider (default 4)
})
renderer.mount(containerEl)
renderer.render(resolveTimeline(currentFrame, project))
```

`mediabunny` is NOT a required dependency of `@elah/editor`. The package stays
lean; callers opt in. Omitting the `demuxerFactory` falls back to
`SyntheticVideoFrameProvider` (visual development mode — no media files required).

For the playground, the wiring is in `apps/playground/src/createPlaygroundDemuxerFactory.ts`.

For tests or custom backends, inject any `DemuxerFactory`:

```ts
import { GpuRenderer } from '@elah/editor'
import type { DemuxerBackend, DemuxerFactory } from '@elah/editor'

const myBackend: DemuxerBackend = {
  async open(src) { /* ... */ },
  getConfig() { return { codec: 'vp8', codedWidth: 640, codedHeight: 360 } },
  async *packets([startUs, endUs]) { /* yield EncodedVideoChunk objects */ },
  async seekToKeyframe(timeUs) { /* ... */ },
  dispose() { /* ... */ },
}

const renderer = new GpuRenderer({ demuxerFactory: () => myBackend })
```

---

## Adding a new renderer

1. Create a sub-folder (e.g. `dom/`).
2. Export a class that `implements Renderer` from `core/renderer/types.ts`.
3. The class may import from `core/resolver/scene.ts` and `core/types` only — no engine, no React.
4. Wire it up in a React shell (the only place that knows about both a renderer and a playback engine). The playground's `GpuPreview.tsx` is a working example: it owns the RAF loop, resolves the scene each tick, and calls `renderer.render(scene)`.
