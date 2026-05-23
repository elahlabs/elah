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

## Current renderer implementations

| Folder | Status | Description |
|---|---|---|
| `gpu/` | Usable | WebGL2 GPU compositor — `Scene → VideoLayer → VideoFrameProvider → VideoTexture → quad draw` |
| `dom/` | Future | `<video>` stack + DOM text + `<img>` (no canvas) |
| `canvas2d/` | Future | `drawImage` from `<video>` onto a 2D canvas |
| `export/` | Future | Off-main-thread Worker + `VideoEncoder` pipeline |

All implementations share the same `Renderer` interface and consume the same `Scene` shape. Swapping one for another requires no changes to `PlaybackEngine`, `resolveTimeline`, or any React component.

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

## Adding a new renderer

1. Create a sub-folder (e.g. `dom/`).
2. Export a class that `implements Renderer` from `core/renderer/types.ts`.
3. The class may import from `core/resolver/scene.ts` and `core/types` only — no engine, no React.
4. Wire it up in a React shell (the only place that knows about both a renderer and a playback engine). The playground's `GpuPreview.tsx` is a working example: it owns the RAF loop, resolves the scene each tick, and calls `renderer.render(scene)`.
