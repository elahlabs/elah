# PR-06 · Render contract + drag plumbing seams

**Status:** 🔴 Not started
**Risk:** Low (types-and-hooks only; no logic)
**Estimated effort:** 1–2 hours
**Blocks:** PR-08 (Gallery), PR-09 (DnD), PR-10 (Preview renderer)

---

## Goal

Lay the final "empty seats" the gallery, DnD, and renderer PRs will fill. This is a small, types-and-stubs PR that closes out the foundation phase. After it merges, every subsequent PR is fill-in-the-blank.

## Why this PR matters

Three abstractions that the next three feature PRs need to import from a stable home:

1. **`Renderer` interface** — what every renderer (DOM, Canvas, GPU, export) implements.
2. **`useResolvedScene` hook** — a memoized React hook that turns the current frame into a `Scene`. The preview component reads from this.
3. **`useTimelineDrop` hook stub** — the contract for the timeline's drop target. Body is `TODO: PR-09`; the signature exists so the gallery PR can wire to it confidently.

Locking the seams now means PR-08, PR-09, and PR-10 can be picked up in any order or even in parallel.

## Scope

| File | Change |
|---|---|
| `packages/timeline/src/core/renderer/types.ts` (new) | `Renderer` interface |
| `packages/timeline/src/core/renderer/useResolvedScene.ts` (new) | React hook |
| `packages/timeline/src/ui/useTimelineDrop.ts` (new) | Drop hook signature + stub |
| `packages/timeline/src/index.ts` | Export all three |

## Acceptance criteria

- [ ] `Renderer` interface:
  ```ts
  export interface Renderer {
    mount(container: HTMLElement): void
    render(scene: Scene): void
    dispose(): void
  }
  ```
- [ ] `useResolvedScene(frameOverride?: number): Scene` — reads the timeline engine from `useTimelineEngine()`, reads the playhead frame from `usePlaybackStore` (or `frameOverride` if passed), calls `resolveTimeline`, and memoizes on `(frame, project)` identity.
- [ ] The hook re-resolves whenever either input changes; when both are reference-equal to the previous call, it returns the previous `Scene` reference (allowing downstream `useEffect` deps to skip).
- [ ] `useTimelineDrop(trackId: string, lane: HTMLElement | null): void` — exported with a JSDoc explaining future behavior. Body is a no-op with a `// TODO: PR-09` comment. **It must not throw, even if called.**
- [ ] All three are exported from `packages/timeline/src/index.ts`.
- [ ] `npx tsc --noEmit` clean.
- [ ] `npm run test` — all tests still pass.
- [ ] No playground or component behavior changes.

## Out of scope

- **No actual `DomRenderer` implementation** — that's PR-10.
- **No actual drop logic** — that's PR-09.
- **No `MediaLibrary` integration** in `useResolvedScene` — the optional `resolveAsset` parameter from PR-04 (if implemented) is wired here only if it doesn't expand scope; otherwise leave it for PR-10.
- **No `Preview` component.**

## Implementation notes

### `Renderer` interface

```ts
// packages/timeline/src/core/renderer/types.ts
import type { Scene } from '../resolver/scene'

/**
 * Contract every renderer implements. The renderer reads only the Scene;
 * it never touches Project, Track, Clip, MediaLibrary, or the engines.
 *
 * Implementations:
 *   - DomRenderer  (PR-10)  — <video> stack + DOM text + audio elements
 *   - CanvasRenderer (later) — drawImage from <video> to 2D canvas
 *   - GpuRenderer (later)   — WebGL/WebGPU texture pipeline
 *   - ExportRenderer (later) — Worker + VideoEncoder
 */
export interface Renderer {
  /** Attach the renderer to a DOM element. May be called once per instance. */
  mount(container: HTMLElement): void
  /** Render a single scene. Idempotent: calling with the same scene is a no-op. */
  render(scene: Scene): void
  /** Tear down. After dispose, mount/render must not be called. */
  dispose(): void
}
```

### `useResolvedScene`

```ts
// packages/timeline/src/core/renderer/useResolvedScene.ts
import { useMemo, useRef } from 'react'
import { useTimelineEngine } from '../../ui/editor-context'
import { useTracksStore } from '../../stores/tracks.store'
import { usePlaybackStore } from '../../stores/playback.store'
import { resolveTimeline } from '../resolver/resolveTimeline'
import type { Scene } from '../resolver/scene'

/**
 * Returns a memoized Scene for the current frame (or `frameOverride` if given).
 *
 * Re-resolves only when frame or the underlying project changes. When both
 * inputs are identical to the previous call, returns the previous Scene by
 * reference so downstream `useEffect` deps skip naturally.
 *
 * Reads the engine from EditorProvider context. Must be used inside the provider.
 */
export function useResolvedScene(frameOverride?: number): Scene {
  const engine = useTimelineEngine()
  const storeFrame = usePlaybackStore((s) => s.currentFrame)
  // Subscribe to the project mirror so we re-render when tracks change shape.
  // useTracksStore.tracks reference changes whenever the project changes,
  // which is the cheapest "project changed" signal we have.
  useTracksStore((s) => s.tracks)

  const frame = frameOverride ?? storeFrame
  const project = engine.getProject()

  const last = useRef<{ frame: number; project: typeof project; scene: Scene } | null>(null)

  return useMemo(() => {
    if (
      last.current &&
      last.current.frame === frame &&
      last.current.project === project
    ) {
      return last.current.scene
    }
    const scene = resolveTimeline(frame, project)
    last.current = { frame, project, scene }
    return scene
  }, [frame, project])
}
```

> **Note:** the `useTracksStore((s) => s.tracks)` selector is purely to subscribe; the value is unused. This guarantees the hook re-runs when the project changes (since `useTracksStore` is sync'd from engine events). Alternative implementations using `useSyncExternalStore` directly on the engine are fine but heavier.

### `useTimelineDrop` stub

```tsx
// packages/timeline/src/ui/useTimelineDrop.ts
import { useEffect } from 'react'

/**
 * Listen for media drag-drop events on a timeline lane and create clips.
 *
 * Implementation deferred to PR-09. Until then this hook is a documented
 * no-op so the gallery PR can wire up to a stable import.
 *
 * @param trackId  The id of the track this lane represents.
 * @param lane     The DOM element to listen on (e.g. the lane's content div).
 */
export function useTimelineDrop(trackId: string, lane: HTMLElement | null): void {
  useEffect(() => {
    // TODO: PR-09 — listen for `MEDIA_DRAG_MIME` payloads on `lane`,
    // compute drop frame from x-offset and zoom, and call engine.addClip.
    void trackId
    void lane
  }, [trackId, lane])
}
```

The `void trackId; void lane;` lines suppress unused-arg lints while keeping the signature stable.

### Public API

```ts
// packages/timeline/src/index.ts — add
export type { Renderer } from './core/renderer/types'
export { useResolvedScene } from './core/renderer/useResolvedScene'
export { useTimelineDrop } from './ui/useTimelineDrop'
```

## Verification

1. `npx tsc --noEmit` — clean.
2. `npm run test` — all tests pass.
3. In a temp test file or browser console after `npm run dev`, confirm:
   ```ts
   import { useResolvedScene } from '@myeditor/timeline'
   // Render a child of EditorProvider that calls useResolvedScene(0)
   // → returns a Scene object with the expected shape.
   ```
4. Confirm `useTimelineDrop('t1', null)` doesn't throw.
5. Confirm `Renderer` is in the published types.

---

## Copy-paste prompt for the implementation agent

```text
You are working on @myeditor/timeline. Your job is to add three stable
"empty seats" that the next feature PRs will fill: a Renderer interface,
a useResolvedScene hook, and a useTimelineDrop hook stub.

REPO: d:/opensource/ReferenceProjects/MyEditorPackage

HARD CONSTRAINTS:
- Do NOT implement an actual renderer.
- Do NOT implement actual drop logic.
- Do NOT add a Preview component.
- Do NOT change any existing behavior.
- No new runtime dependencies.

================================================================
TASK 1 — Renderer interface
================================================================
File: packages/timeline/src/core/renderer/types.ts (new)

  import type { Scene } from '../resolver/scene'

  export interface Renderer {
    mount(container: HTMLElement): void
    render(scene: Scene): void
    dispose(): void
  }

Add JSDoc explaining the contract:
- reads only Scene; never touches Project / Track / Clip
- mount may be called once per instance
- render is idempotent for identical scenes
- after dispose, no further calls allowed

================================================================
TASK 2 — useResolvedScene hook
================================================================
File: packages/timeline/src/core/renderer/useResolvedScene.ts (new)

Signature:
  export function useResolvedScene(frameOverride?: number): Scene

Implementation:
- import useTimelineEngine from '../../ui/editor-context'
- import useTracksStore from '../../stores/tracks.store'
- import usePlaybackStore from '../../stores/playback.store'
- import resolveTimeline from '../resolver/resolveTimeline'
- import type { Scene } from '../resolver/scene'

- Subscribe to useTracksStore((s) => s.tracks) (unused value) so the hook
  re-renders when the project changes.
- Read storeFrame = usePlaybackStore((s) => s.currentFrame).
- Read engine = useTimelineEngine(); project = engine.getProject().
- frame = frameOverride ?? storeFrame.
- useRef<{frame, project, scene}> for memoization.
- useMemo over [frame, project]: if previous call's frame and project are
  identical (by reference), return previous scene; else call
  resolveTimeline and cache.
- Return the Scene.

================================================================
TASK 3 — useTimelineDrop stub
================================================================
File: packages/timeline/src/ui/useTimelineDrop.ts (new)

Signature:
  export function useTimelineDrop(trackId: string, lane: HTMLElement | null): void

Implementation:
  useEffect(() => {
    // TODO: PR-09 — listen for MEDIA_DRAG_MIME payloads on `lane`,
    // compute drop frame from x-offset and zoom, call engine.addClip.
    void trackId
    void lane
  }, [trackId, lane])

JSDoc must explain:
- Listens for media drag-drop on a timeline lane and creates clips.
- Implementation deferred to PR-09.
- Until then this hook is a documented no-op.

================================================================
TASK 4 — Update public API
================================================================
File: packages/timeline/src/index.ts

Add:
  export type { Renderer } from './core/renderer/types'
  export { useResolvedScene } from './core/renderer/useResolvedScene'
  export { useTimelineDrop } from './ui/useTimelineDrop'

================================================================
VERIFICATION
================================================================
1. npx tsc --noEmit  → clean
2. npm run test     → all tests pass (no test changes needed)
3. npm run dev      → no UI changes; playground works as before
4. From any descendant of <EditorProvider>, `useResolvedScene()` returns
   a Scene object. Sanity-check by adding a temporary
   console.log(useResolvedScene()) in App.tsx (and removing it before
   committing).

================================================================
DELIVERABLE
================================================================
A commit titled:
  renderer: add Renderer interface, useResolvedScene, and useTimelineDrop stub

================================================================
NON-GOALS
================================================================
- No DomRenderer implementation. PR-10.
- No drop-handler body. PR-09.
- No Preview component. PR-10.
- No package splits. Everything lives in @myeditor/timeline.
- Do not add memoization beyond the single useRef in useResolvedScene.
```
