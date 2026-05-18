# PR-05 · `EditorProvider` and engine lift

**Status:** 🔴 Not started
**Risk:** Medium-High (refactors `Timeline.tsx` and `App.tsx` simultaneously)
**Estimated effort:** 3–4 hours
**Blocks:** PR-08 (AssetPanel as Timeline sibling), PR-10 (Preview as Timeline sibling)
**Depends on:** PR-04 (package rename to `@elah/editor` + `core/` / `timeline/` / `editor/` layering must be merged first)

---

## Goal

Lift `TimelineEngine` and `PlaybackEngine` out of `Timeline.tsx` and into a top-level `<EditorProvider>` in the **`editor/` composition layer**. Expose them via context hooks (`useTimelineEngine()`, `usePlaybackEngine()`). After this PR, `<Timeline>`, `<AssetPanel>`, and `<Preview>` can all be **siblings** that consume the same engines — without ref gymnastics.

This is also the PR that populates the `editor/` layer for the first time. Before this PR the folder exists but is empty; after this PR it owns the composition shell.

## Why this PR matters

Today, both engines are instantiated *inside* the `<Timeline>` component (`packages/editor/src/timeline/Timeline.tsx`, in `useMemo` calls). This means:

- If `<Timeline>` unmounts (fullscreen preview, panel rearrange), playback dies.
- The `<AssetPanel>` (PR-08) and `<Preview>` (PR-10) can't get to the engines except through `TimelineRef` prop drilling.
- The two sync effects (engine→store, store→engine, persisted init) live in `Timeline.tsx` and would have to move if you ever rendered a Preview without a Timeline.

The prior two attempts (Oxide-Editor, render-kit) collapsed at exactly this point — gallery + preview + timeline needed each other and ended up tangled because there was no shared provider.

## Layering

The provider belongs in the **editor composition layer**. The timeline layer must not depend on the editor layer (PR-04 dependency rule: `core → timeline → editor`). So `<Timeline>` reads from the context but does **not** import the provider — only the context hooks, which live in `editor/` and are surfaced through the package barrel.

Wait — that creates a loop: `timeline/` would need to import the context hook from `editor/`. Resolve it by putting the **context itself** in `core/` (it's just a React context value type + a `useContext` wrapper, no React runtime logic). The **provider** stays in `editor/`. This keeps the dependency direction clean:

- `core/editor-context.ts` — context object, `useEditor()`, `useTimelineEngine()`, `usePlaybackEngine()` hooks.
- `editor/EditorProvider.tsx` — `<EditorProvider>` component that wires engines and supplies the context value.

`timeline/Timeline.tsx` imports the hooks from `core/`; `apps/playground` imports `<EditorProvider>` from the package barrel.

## Scope

| File | Change |
|---|---|
| `packages/editor/src/core/editor-context.ts` (new) | React context + `useEditor()` / `useTimelineEngine()` / `usePlaybackEngine()` hooks |
| `packages/editor/src/editor/EditorProvider.tsx` (new) | Owns engine instances + sync effects; supplies context value |
| `packages/editor/src/editor/index.ts` (new) | Barrel for the composition layer |
| `packages/editor/src/timeline/Timeline.tsx` | Stop instantiating engines; consume from context via `useTimelineEngine()` / `usePlaybackEngine()`; keep `TimelineRef` for back-compat |
| `packages/editor/src/timeline/engine-context.ts` | Keep `useTimeline()` for back-compat (alias to `useTimelineEngine`) |
| `packages/editor/src/index.ts` | Export `EditorProvider`, `useEditor`, `useTimelineEngine`, `usePlaybackEngine` under the `// --- Editor: composition ---` section |
| `apps/playground/src/App.tsx` | Wrap `<Timeline>` in `<EditorProvider>` |

## Acceptance criteria

- [ ] `<EditorProvider fps stage>` instantiates `TimelineEngine` and `PlaybackEngine` exactly once (per provider instance, in a `useMemo`).
- [ ] All three sync effects move into `EditorProvider`:
  - Engine → Zustand store (frame snapshot, with the "only on change" guard).
  - Zustand store → Engine (with persisted-state init at top, and echo guard).
  - Tracks engine `change` / `history:change` → `useTracksStore.sync(...)`.
- [ ] `EditorProvider` calls `playback.destroy()` and `engine.off(...)` on unmount.
- [ ] Context + hooks live in `core/editor-context.ts`; the provider lives in `editor/EditorProvider.tsx`. `timeline/` imports only the hooks (from `core/`), never the provider.
- [ ] `useTimelineEngine(): TimelineEngine` and `usePlaybackEngine(): PlaybackEngine` hooks work from any descendant.
- [ ] `useTimeline()` (existing export) continues to work — alias `useTimelineEngine()`.
- [ ] `<Timeline>` no longer instantiates engines; it reads them from context via the new hooks. The component is roughly **50–80 lines shorter**.
- [ ] `TimelineRef` still has `{ engine, playback }`; values are read from context inside the component and exposed via `useImperativeHandle`.
- [ ] `App.tsx` wraps everything in `<EditorProvider fps={30}>`; all existing toolbar interactions still work (add tracks, add clips, play/pause, undo/redo, zoom).
- [ ] Dependency rule check: no file in `core/` or `timeline/` imports from `editor/`.
- [ ] `npx tsc --noEmit` clean.
- [ ] `npm run test` — all tests still pass (no test changes needed).
- [ ] Playground smoke test: every existing keyboard shortcut and toolbar button still works.

## Out of scope

- **Do not move the Zustand stores.** They keep their `core/stores/` location from PR-04.
- **Do not change the public API of `TimelineEngine` or `PlaybackEngine`.**
- **Do not change the schema.** This is a pure refactor of where state lives.
- **Do not introduce `MediaLibrary` into `EditorProvider`** — that's PR-08+. Keep the provider focused on the two engines.
- **No prop drilling cleanup** beyond what's necessary for the lift itself.
- **Do not add `<EditorSDK>` / `<AssetPanel>` / `<Preview>` shells.** Those land in later PRs.

## Implementation notes

### Context shape (lives in `core/`)

```tsx
// packages/editor/src/core/editor-context.ts
import { createContext, useContext } from 'react'
import type { TimelineEngine } from './editor/TimelineEngine'
import type { PlaybackEngine } from './playback/PlaybackEngine'

export interface EditorContextValue {
  engine: TimelineEngine
  playback: PlaybackEngine
}

export const EditorContext = createContext<EditorContextValue | null>(null)

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext)
  if (!ctx) throw new Error('useEditor must be used inside <EditorProvider>')
  return ctx
}

export const useTimelineEngine = (): TimelineEngine => useEditor().engine
export const usePlaybackEngine = (): PlaybackEngine => useEditor().playback
```

### Provider (lives in `editor/`)

```tsx
// packages/editor/src/editor/EditorProvider.tsx
import { useEffect, useMemo, type ReactNode } from 'react'
import { TimelineEngine } from '../core/editor/TimelineEngine'
import { PlaybackEngine } from '../core/playback/PlaybackEngine'
import { useTracksStore } from '../core/stores/tracks.store'
import { usePlaybackStore } from '../core/stores/playback.store'
import { EditorContext } from '../core/editor-context'

export interface EditorProviderProps {
  fps: number
  stage?: { width: number; height: number }
  defaultTrackHeight?: number
  maxHistorySize?: number
  children: ReactNode
}

export function EditorProvider({
  fps,
  stage,
  defaultTrackHeight,
  maxHistorySize,
  children,
}: EditorProviderProps) {
  const engine = useMemo(
    () => new TimelineEngine({ fps, stage, defaultTrackHeight, maxHistorySize }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const playback = useMemo(
    () => new PlaybackEngine({
      fps,
      getTotalFrames: () => useTracksStore.getState().totalFrames,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // Engine 'change' / 'history:change' → tracks store mirror
  useEffect(() => {
    const sync = () => useTracksStore.getState().sync(engine.getProject(), {
      canUndo: engine.canUndo(),
      canRedo: engine.canRedo(),
    })
    engine.on('change', sync)
    engine.on('history:change', sync)
    sync()
    return () => {
      engine.off('change', sync)
      engine.off('history:change', sync)
    }
  }, [engine])

  // Engine → store (only on actual change)
  useEffect(() => {
    return playback.subscribe((snapshot) => {
      const pb = usePlaybackStore.getState()
      if (snapshot.currentFrame !== pb.currentFrame) {
        pb.setCurrentFrame(snapshot.currentFrame)
      }
      if (snapshot.isPlaying && !pb.isPlaying) pb.play()
      else if (!snapshot.isPlaying && pb.isPlaying) pb.pause()
    })
  }, [playback])

  // Store → engine, with persisted-state init at the top
  useEffect(() => {
    const s0 = usePlaybackStore.getState()
    playback.setPlaybackRate(s0.playbackRate)
    playback.setLoop(s0.loop)
    if (s0.isPlaying) playback.play()

    return usePlaybackStore.subscribe((state, prev) => {
      if (state.isPlaying !== prev.isPlaying) {
        if (state.isPlaying) playback.play()
        else playback.pause()
      }
      if (
        state.currentFrameEpoch !== prev.currentFrameEpoch &&
        state.currentFrame !== playback.currentFrame
      ) {
        playback.seek(state.currentFrame)
      }
      if (state.playbackRate !== prev.playbackRate) {
        playback.setPlaybackRate(state.playbackRate)
      }
      if (state.loop !== prev.loop) {
        playback.setLoop(state.loop)
      }
    })
  }, [playback])

  // Cleanup
  useEffect(() => () => playback.destroy(), [playback])

  const value = useMemo(() => ({ engine, playback }), [engine, playback])

  return (
    <EditorContext.Provider value={value}>
      {children}
    </EditorContext.Provider>
  )
}
```

### `Timeline.tsx` slimming

Replace the engine/playback instantiation and the three sync effects with a single hook call:

```tsx
export const Timeline = memo(forwardRef<TimelineRef, TimelineProps>(function Timeline(
  { fps = 30, className, style },
  ref,
) {
  const { engine, playback } = useEditor()
  useImperativeHandle(ref, () => ({ engine, playback }), [engine, playback])

  // ... keep tracks/zoom/scroll/keyboard hooks and JSX as-is ...
}))
```

`fps` becomes informational only — the actual fps now lives on the engine (and `useTracksStore.getState().fps`, if you need to read it from outside). Existing `<Timeline fps={30} />` usages keep working because we no longer rely on the prop for instantiation, just for things like ruler tick density.

> **If you have time:** consider removing `fps` from `<Timeline>` props entirely and reading it from `engine.getProject().fps`. But this is **optional** — keeping the prop preserves back-compat.

### Back-compat for `useTimeline()`

```ts
// packages/editor/src/timeline/engine-context.ts
import { useTimelineEngine } from '../core/editor-context'
export const useTimeline = useTimelineEngine  // back-compat alias
```

Or, delete the old context file entirely and re-export from `core/editor-context.ts`. Either is acceptable — keep imports working.

### Playground update

```tsx
// apps/playground/src/App.tsx (top of return)
return (
  <EditorProvider fps={FPS} stage={{ width: 1080, height: 1920 }}>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* existing toolbar */}
      <Timeline ref={timelineRef} fps={FPS} style={{ flex: 1 }} />
    </div>
  </EditorProvider>
)
```

The `ref` keeps working; `engine()` helper in App.tsx still works because `TimelineRef` is unchanged.

## Verification

1. `npx tsc --noEmit` — clean.
2. `npm run test` — all tests pass.
3. `npm run dev` and confirm every existing flow:
   - Add a video / audio / text track.
   - Add clips of each type.
   - Drag clips to move them.
   - Trim clips with handles.
   - Press Space → playhead advances.
   - Click ruler → playhead seeks.
   - Ctrl+Z / Ctrl+Y → undo/redo works.
   - `S` while a clip is selected → split.
4. From any descendant of `<EditorProvider>`, calling `useTimelineEngine()` returns the same instance as before.
5. Unmount `<Timeline>` (e.g. temporarily comment it out and remount) — `playback` and `engine` survive across the unmount because they live in the provider.

---

## Copy-paste prompt for the implementation agent

```text
You are working on @elah/editor (the single package in the monorepo).
PR-04 has merged: src/ is laid out as core/ + timeline/ + editor/.
Your job is to lift TimelineEngine and PlaybackEngine out of <Timeline>
and into a new <EditorProvider> in the editor/ composition layer.
This is a pure refactor — no behavior changes, no schema changes, no
new abstractions.

REPO: d:/opensource/ReferenceProjects/MyEditorPackage

HARD CONSTRAINTS:
- Behavior must be identical after this PR. Every keyboard shortcut, every
  toolbar action, every drag must produce the same result.
- Do NOT change TimelineEngine or PlaybackEngine class APIs.
- Do NOT move Zustand stores or rename them.
- Do NOT introduce MediaLibrary into the provider (that comes later).
- Do NOT add new packages.
- Honor the layering: core/ must not import from timeline/ or editor/;
  timeline/ must not import from editor/. The context object + hooks go
  in core/editor-context.ts; only the <EditorProvider> component goes
  in editor/EditorProvider.tsx.
- The diff should be smaller in net lines than the lines moved.

================================================================
TASK 1 — Create core/editor-context.ts
================================================================
File: packages/editor/src/core/editor-context.ts (new)

Export:
  interface EditorContextValue { engine: TimelineEngine; playback: PlaybackEngine }
  EditorContext (createContext<EditorContextValue | null>(null))
  useEditor(): throws if used outside provider
  useTimelineEngine(): TimelineEngine
  usePlaybackEngine(): PlaybackEngine

================================================================
TASK 2 — Create editor/EditorProvider.tsx
================================================================
File: packages/editor/src/editor/EditorProvider.tsx (new)

Owns:
- TimelineEngine instance (via useMemo, [])
- PlaybackEngine instance (via useMemo, []) — getTotalFrames reads
  useTracksStore.getState().totalFrames
- Sync effect 1: engine 'change' / 'history:change' → useTracksStore.sync
- Sync effect 2: playback.subscribe → usePlaybackStore (only when frame
  actually changed)
- Sync effect 3: usePlaybackStore.subscribe → playback (with persisted-state
  init at the top, before the .subscribe call: setPlaybackRate, setLoop,
  conditional play)
- Cleanup effect: playback.destroy() on unmount

Move all three sync effects from Timeline.tsx into here, IDENTICAL logic.

Props: { fps: number; stage?: {width;height}; defaultTrackHeight?: number;
         maxHistorySize?: number; children: ReactNode }

================================================================
TASK 3 — Slim down Timeline.tsx
================================================================
File: packages/editor/src/timeline/Timeline.tsx

Remove:
- useMemo for `engine`
- useMemo for `playback`
- All three playback sync useEffects
- The cleanup useEffect for playback.destroy()
- The engine event-sync useEffect (it's now in the provider)

Replace with:
  const { engine, playback } = useEditor()

Keep:
- useImperativeHandle exposing { engine, playback }
- All other hooks (tracks, zoom, scroll, keyboard shortcuts) unchanged
- All JSX unchanged

================================================================
TASK 4 — Preserve useTimeline() for back-compat
================================================================
File: packages/editor/src/timeline/engine-context.ts

Make useTimeline an alias of useTimelineEngine:

  import { useTimelineEngine } from '../core/editor-context'
  export const useTimeline = useTimelineEngine

(Or delete the old file and re-export from core/editor-context. Either
works, but ensure `import { useTimeline } from '@elah/editor'` keeps
working.)

================================================================
TASK 5 — Update the public API
================================================================
File: packages/editor/src/index.ts

Under the existing `// --- Editor: composition ---` section header, add:
  export { EditorProvider } from './editor/EditorProvider'
  export type { EditorProviderProps } from './editor/EditorProvider'
  export {
    useEditor,
    useTimelineEngine,
    usePlaybackEngine,
  } from './core/editor-context'

================================================================
TASK 6 — Update the playground
================================================================
File: apps/playground/src/App.tsx

Wrap the existing return JSX with <EditorProvider fps={FPS}>...</EditorProvider>.

No other App.tsx changes. timelineRef and all toolbar buttons continue
to work unchanged because TimelineRef still exposes { engine, playback }.

================================================================
VERIFICATION
================================================================
1. npx tsc --noEmit  → clean
2. npm run test     → all tests pass (no test changes needed)
3. npm run dev      → manually verify EVERY existing interaction:
   - Add video/audio/text tracks
   - Add clips of each type
   - Drag to move clips
   - Trim with handles
   - Space: play/pause
   - Ruler click: seek
   - Ctrl+Z / Ctrl+Y: undo/redo
   - 'S' on selected clip: split
   - Ctrl+scroll: zoom

If any of these doesn't work identically, fix it before declaring done.

================================================================
DELIVERABLE
================================================================
A commit titled:
  ui: lift TimelineEngine and PlaybackEngine into EditorProvider

================================================================
NON-GOALS
================================================================
- No behavior changes.
- No API changes on TimelineEngine / PlaybackEngine.
- No MediaLibrary work.
- No schema changes.
- No package splits.
- No <EditorSDK>, <AssetPanel>, or <Preview> shells — later PRs.
- Do not "improve" unrelated code while you're in there.
```
