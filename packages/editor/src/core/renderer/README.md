# `core/renderer`

Renderer abstraction layer. Defines the contract every renderer must honour and hosts concrete renderer implementations as sub-folders.

---

## What lives here

| Path | Role |
|---|---|
| `types.ts` | `Renderer` interface — the only public contract |
| `gpu/` | WebGL2 GPU renderer — Phase 1 foundation + Phase 2 texture pipeline |

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

## Planned renderer implementations

| Folder | Status | Description |
|---|---|---|
| `gpu/` | In progress | WebGL2 GPU compositor — MVP video rendering |
| `dom/` | Future | `<video>` stack + DOM text + `<img>` (no canvas) |
| `canvas2d/` | Future | `drawImage` from `<video>` onto a 2D canvas |
| `export/` | Future | Off-main-thread Worker + `VideoEncoder` pipeline |

All implementations share the same `Renderer` interface and consume the same `Scene` shape. Swapping one for another requires no changes to `PlaybackEngine`, `resolveTimeline`, or any React component.

---

## Adding a new renderer

1. Create a sub-folder (e.g. `dom/`).
2. Export a class that `implements Renderer` from `core/renderer/types.ts`.
3. The class may import from `core/resolver/scene.ts` and `core/types` only — no engine, no React.
4. Wire it up in `editor/Preview/` (the only place that knows about both a renderer and a playback engine).
