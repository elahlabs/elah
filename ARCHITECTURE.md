# Architecture

> The design principles, layer boundaries, and data flow of the editor engine. This is the canonical reference; everything else (roadmap, PR backlog) descends from this document.

---

## Table of contents

1. [Design principles](#1-design-principles)
2. [The three-ring state model](#2-the-three-ring-state-model)
3. [Time, frames, and the playback clock](#3-time-frames-and-the-playback-clock)
4. [The data model](#4-the-data-model)
5. [The timeline resolver](#5-the-timeline-resolver)
6. [The render abstraction](#6-the-render-abstraction)
7. [Data flow end-to-end](#7-data-flow-end-to-end)
8. [What lives where (package boundaries)](#8-what-lives-where-package-boundaries)
9. [What this architecture rejects (anti-patterns)](#9-what-this-architecture-rejects-anti-patterns)

---

## 1. Design principles

These principles are **load-bearing**. Every decision in the codebase traces back to one of them.

### P1. Engine first, framework second.

The core of the editor — `TimelineEngine`, `PlaybackEngine`, `resolveTimeline` — has zero React imports. It runs in Node, in a Web Worker, in a CLI, or under WASM. React is a *consumer* of the engine, not its host.

### P2. Time is integer frames.

`currentFrame: number` is the unit. Clips have `startFrame`, `durationFrames`, `sourceStartFrame`, `sourceDurationFrames`. Seconds exist only at the rendering boundary (`videoEl.currentTime = sourceFrame / fps`). This eliminates floating-point drift after splits, trims, and moves.

### P3. One mutation funnel.

Every change to project state goes through `TimelineEngine.commit()`. Visitors (`add`, `remove`, `update`, `split`, `clone`) apply Immer drafts; `commit` records history, fires events, and replaces the project reference. No side-channel writes are permitted.

### P4. Pure resolution.

`resolveTimeline(frame, project) → Scene` is a pure function. Same inputs always produce the same `Scene`. No DOM access, no React, no Zustand. This is what makes the engine testable, exportable, worker-safe, and renderer-agnostic.

### P5. Renderers are dumb.

A renderer takes a `Scene` and produces pixels. It does not ask the engine what time it is; it does not look up clips by id; it does not know what a `Project` is. Anything a renderer needs is in the `Scene`.

### P6. Small surface area.

No plugin systems. No event buses. No dependency injection. No micro-packages. Add abstraction only when the second copy of a pattern is hurting.

---

## 2. The three-ring state model

State is organized in three concentric rings. The rule is **outer rings read inner rings, never the reverse**.

```
                ┌──────────────────────────────────────┐
                │   Ring 0 — Engine state              │
                │   (immutable, owned by classes)      │
                │                                      │
                │   • TimelineEngine.project           │
                │   • PlaybackEngine.clock             │
                │   • MediaLibrary.assets   (planned)  │
                └──────────────┬───────────────────────┘
                               │ events: 'change', 'tick', 'history:change'
                               ▼
                ┌──────────────────────────────────────┐
                │   Ring 1 — Reactive mirror           │
                │   (Zustand stores that sync from R0) │
                │                                      │
                │   • useTracksStore                   │
                │   • usePlaybackStore                 │
                │   • useMediaLibraryStore  (planned)  │
                └──────────────┬───────────────────────┘
                               │ selectors / subscribe
                               ▼
                ┌──────────────────────────────────────┐
                │   Ring 2 — UI / transient state      │
                │   (Zustand stores for UI-only data)  │
                │                                      │
                │   • useSelectionStore                │
                │   • drag state, panel state, etc.    │
                └──────────────────────────────────────┘
```

### Why this works

- **Ring 0 is the source of truth.** History, batching, events all live here. Replays are deterministic.
- **Ring 1 is the React boundary.** Components subscribe with granular selectors. Engine events trigger a single `sync()` that updates the mirror.
- **Ring 2 is throwaway.** UI state (which clip is selected, is the drag handle being dragged) lives separately so it never pollutes the project history.

### Forbidden patterns

- Components writing directly to Ring 0.
- Ring 0 reading from Ring 1 or Ring 2.
- Engine state living in `useState` / `useRef` instead of Ring 0.

---

## 3. Time, frames, and the playback clock

### Why frames

Storing time as floating-point seconds creates cumulative error: after enough splits/moves/trims, two clips that should be flush can be 0.0000003s apart, and the renderer chooses arbitrarily which one wins at the join frame. Integer frames eliminate this entirely.

### The `PlaybackEngine` contract

`PlaybackEngine` owns the RAF loop and emits snapshots:

```ts
interface PlaybackSnapshot {
  currentFrame: number
  isPlaying: boolean
  playbackRate: number
  loop: boolean
}

class PlaybackEngine {
  play(): void
  pause(): void
  seek(frame: number): void
  setPlaybackRate(rate: number): void
  setLoop(loop: boolean): void
  subscribe(fn: (s: PlaybackSnapshot) => void): () => void
  destroy(): void
  // getters: currentFrame, currentTime, isPlaying, playbackRate, loop
}
```

Internals worth knowing:

- **Sub-frame accumulator.** RAF elapsed time × fps may not be a whole number. We accumulate fractional frames so timing doesn't drift.
- **Elapsed clamp (250ms).** If the tab is backgrounded for 30 seconds, we don't fast-forward 900 frames on resume.
- **No notify-on-no-op.** `seek()` returns early when frame is unchanged; subscriber storms are explicitly avoided.

### The clock ↔ Zustand bridge

`Timeline.tsx` wires two effects:

1. **Engine → Store:** every snapshot updates `usePlaybackStore` (only when the frame actually changed, to avoid an epoch storm).
2. **Store → Engine:** every store change (toolbar play, ruler scrub, persisted state) is dispatched into the engine.

This dual-sync is the trickiest piece of plumbing in the codebase. The reason it doesn't loop infinitely:

- Engine pushes frame `X` → `store.currentFrame = X`.
- Store listener checks `state.currentFrame !== playback.currentFrame` → equal → no echo seek.

Persistence (`zustand/persist`) restores `loop` and `playbackRate` on mount, and the store→engine effect pushes those into the engine **before** subscribing (otherwise the engine would silently start with defaults). See `Timeline.tsx` for the implementation.

### Why not anchor to `AudioContext.currentTime`?

Eventually we should. `AudioContext.currentTime` is the hardware audio clock; anchoring playback to it eliminates audio-video drift by definition. Today we use `performance.now()` because we don't yet have audio in the playback path. This is a deliberate deferral. See [`ROADMAP.md`](./ROADMAP.md).

---

## 4. The data model

```ts
interface Project {
  id: string
  fps: number                                       // integer (24, 30, 60)
  stage: { width: number; height: number }          // planned (PR-03), default 1080×1920
  tracks: Track[]
  clips: Record<string /* trackId */, Clip[]>       // sorted by startFrame, no overlap
  version: number
}

interface Track {
  id: string
  name: string
  kind: 'video' | 'audio' | 'text'
  order: number                                     // 0 = topmost in UI = front-most in render
  height: number                                    // px, UI hint
  locked: boolean                                   // UI-only; no engine effect
  disabled: boolean                                 // skip entirely
  muted: boolean                                    // audio→silent, video stays visible
  solo: boolean                                     // exclude other tracks of same kind
}

interface Clip {
  id: string
  trackId: string
  type: 'video' | 'audio' | 'text' | 'image'
  name: string

  // Timeline placement
  startFrame: number
  durationFrames: number

  // Source trim window
  sourceStartFrame: number
  sourceDurationFrames: number

  // Media reference
  src?: string                                      // direct URL (today)
  assetId?: string                                  // planned (PR-04) — MediaLibrary key
  content?: string                                  // text clips only

  // Compositing
  volume?: number                                   // 0..1
  opacity?: number                                  // 0..1
  transform?: Transform                             // planned (PR-03), normalized 0..1

  // Flags
  locked?: boolean
  disabled?: boolean
}
```

### Invariants

- `clips[trackId]` is **always sorted by `startFrame` ascending** and **never has overlap** within a track.
- `startFrame >= 0`, `durationFrames >= 1`.
- For media clips: `durationFrames <= sourceDurationFrames` (text clips are exempt).
- `sourceStartFrame + durationFrames <= sourceDurationFrames`.
- These invariants are enforced inside `TimelineEngine` mutation methods. `moveClip` and `trimClip` are getting tightened in PR-01.

### Why two coordinate systems

- **Timeline frame** — where on the timeline the clip lives.
- **Source frame** — what part of the source media plays.

This separation is what makes trims, splits, and slips possible without re-encoding. A split simply creates two clips with the same `src`, adjusted `startFrame` and `sourceStartFrame`.

---

## 5. The timeline resolver

`resolveTimeline(frame, project) → Scene` is the most important function in the codebase.

### Contract

```ts
function resolveTimeline(frame: number, project: Project): Scene

interface Scene {
  frame: number
  videos: ActiveVideoClip[]
  audios: ActiveAudioClip[]
  texts: ActiveTextClip[]
  images: ActiveImageClip[]
  transitions: SceneTransition[]   // empty until transitions exist
}

interface ActiveClipBase {
  id: string
  trackId: string
  name: string
  sourceFrame: number              // exact frame inside source to display
  opacity: number
  zIndex: number                   // higher = closer to viewer
  // transform?: Transform         // planned (PR-03)
}
```

### Rules

1. **Time inclusion** — clip active iff `startFrame <= frame < startFrame + durationFrames`. Half-open interval; adjacent clips don't both fire at the seam.
2. **Source mapping** — `sourceFrame = (frame - clip.startFrame) + clip.sourceStartFrame`. Pure arithmetic; the only place trim semantics live.
3. **Skip rules:**
   - `track.disabled === true` → skip entire track.
   - `clip.disabled === true` → skip clip.
   - `track.muted === true` and type ∈ {video, audio} → emit clip with `volume = 0`.
4. **Solo** — if any track of kind `K` has `solo === true`, only solo tracks of kind `K` contribute. Image clips piggyback on video solo.
5. **Z-index** — `zIndex = (maxOrder - track.order) * 1000`. So `track.order = 0` (topmost in UI) has the highest zIndex (front-most on screen). Arrays are sorted ascending: lower zIndex first, last element on top.

The `* 1000` multiplier reserves room for sub-layer offsets (e.g. text "above its track" can add `+100` later).

### Determinism

`resolveTimeline` has no side effects, no DOM access, no React, no Zustand. Same `(frame, project)` always produces a structurally-equal `Scene`. This is what makes it:

- Unit-testable without a DOM.
- Worker-safe (export can run in a Web Worker).
- Memoizable (future optimization — `Project` reference equality from Immer makes this nearly free).
- Renderer-agnostic.

### What renderers see

A `DomRenderer` consumes `Scene.videos`, looks up `<video>` elements by clip id (managing its own pool), and seeks each one to `sourceFrame / fps`. A `CanvasRenderer` draws `<video>` frames onto a canvas. A `GpuRenderer` uploads the same data to GPU textures. **None of them imports `Project` or `Clip` directly.**

---

## 6. The render abstraction

```ts
interface Renderer {
  mount(container: HTMLElement): void
  render(scene: Scene): void
  dispose(): void
}
```

That's it. Three methods. Renderers are interchangeable — at any time, swap a `DomRenderer` for a `GpuRenderer` and nothing else changes.

### MVP renderer: DOM

The first implementation will be a `DomRenderer` that:

- Maintains a pool of `<video>` elements keyed by clip id.
- Seeks each active video to `sourceFrame / fps`.
- Manages a single `AudioContext` for `<audio>` mixing.
- Renders text clips as absolutely-positioned `<div>`s with computed transforms.
- Listens directly to `PlaybackEngine.subscribe` so it never re-renders through React.

### Future renderers

- `CanvasRenderer` — `drawImage(video, ...)` to a 2D canvas for per-frame effects.
- `GpuRenderer` — WebGL/WebGPU texture pipeline for shader effects and transitions.
- `ExportRenderer` — runs in a Worker, frame-by-frame, into a `VideoEncoder` (WebCodecs) or `mediabunny` encoder.

All four would implement the same `Renderer` interface and consume the same `Scene`.

---

## 7. Data flow end-to-end

### Mutation flow (user edits a clip)

```
User clicks "Add Clip" ──► engine.addClip({...})
                                  │
                            commit() — Immer produce
                                  │
                            ┌─────┴─────┐
                            ▼           ▼
                       project       history entry
                       replaced      pushed
                                  │
                            emit('change')
                                  │
                       useTracksStore.sync() — Ring 1 updated
                                  │
                       React selectors fire → UI re-renders
```

### Playback flow (a single RAF tick)

```
RAF tick ──► PlaybackEngine.tick(timestamp)
                  │
            advance _frame
                  │
            notify(snapshot)
                  │
       ┌──────────┴──────────┐
       ▼                     ▼
 store mirror sync     <Preview> subscriber  (planned)
       │                     │
 React UI re-paints    resolveTimeline(frame, project)
 (playhead, scrubber)        │
                             ▼
                       DomRenderer.render(scene)
                             │
                       <video>.currentTime = sourceFrame / fps
                       <audio>.gain.value = volume
                       <text>.style.transform = compose(transform)
```

### Seek flow (user clicks the ruler)

```
Ruler click ──► usePlaybackStore.setCurrentFrame(frame)
                          │
              store → engine effect
                          │
                  playback.seek(frame)
                          │
                  notify(snapshot)
                          │
              echo guard: store.currentFrame === playback.currentFrame
                          │
                       no loop
                          │
                  Preview re-renders at new frame
```

---

## 8. What lives where (package boundaries)

Today everything is in one package: `@myeditor/timeline`. This is **intentional** — premature package splits create import-resolution overhead, build orchestration complexity, and version-skew bugs. The boundaries below are *logical* and will only become *physical* if and when they need to.

| Logical area | Path inside `packages/timeline/src/` | Status |
|---|---|---|
| Types | `types/` | ✅ |
| Engine | `core/editor/`, `core/track/`, `core/visitor/`, `core/elements/` | ✅ |
| Playback | `core/playback/` | ✅ |
| Resolver | `core/resolver/` | ✅ |
| State mirrors | `stores/` | ✅ |
| UI primitives | `ui/` | ✅ |
| Utilities | `utils/` | ✅ |
| Actions | `actions/` | ✅ |
| Media library | `core/media/` | 🟡 PR-04 |
| Renderer interface | `core/renderer/` | 🟡 PR-06 |
| Renderer implementation | TBD (`packages/renderer-dom/` later) | ⚪ post-foundation |

**Rule of thumb:** if a file logically belongs to a layer but doesn't have peers yet, it lives in `packages/timeline/src/core/<layer>/`. When a layer accumulates 3+ files and gains its own dependencies, *then* extract it into its own package.

---

## 9. What this architecture rejects (anti-patterns)

This is the "no-go list." Every entry is here because we've seen it sink editor projects.

### A1. The single source of truth that isn't.

Bad: project data in Redux, history in a class, current frame in a hook. Three sources, one truth, infinite bugs.

Good: project lives in `TimelineEngine`, period. Stores mirror it. Components read from stores. No exceptions.

### A2. The renderer that knows about the project.

Bad: `<Preview>` imports `Project`, walks `project.tracks`, decides what to draw.

Good: `<Preview>` calls `resolveTimeline(frame, project)` and renders the resulting `Scene`. The renderer never knows what a `Track` is.

### A3. The component that owns the playback clock.

Bad: `<Timeline>` has the `useEffect` with `requestAnimationFrame`. Unmount it and playback dies.

Good: `PlaybackEngine` lives at app level (or in an `EditorProvider`, planned in PR-05). Any number of consumers subscribe.

### A4. The "pure" function with side effects.

Bad: a resolver that "happens to" mutate a cache, or seek a `<video>` element, or call `setState`.

Good: `resolveTimeline` returns plain data. Callers do side effects. Period.

### A5. The plugin system that has zero plugins.

Bad: adding a `Plugin` interface, a `PluginRegistry`, a `PluginContext` before there is a single thing that needs to be pluggable.

Good: keep the surface area small. The day you need plugins, add the abstraction. Not before.

### A6. The micro-package monorepo.

Bad: `@app/types`, `@app/utils`, `@app/frames`, `@app/snap`, `@app/id`. Each its own `package.json`. Each a build step.

Good: one package until proven otherwise. Folders for organization, not packages.

### A7. The hidden global.

Bad: `window.__editor = engine` so any component can grab it.

Good: `EditorProvider` + hooks (`useTimelineEngine()`, `usePlaybackEngine()`). Explicit dependency graph.

### A8. The float-seconds time model.

Bad: `clip.start = 1.5`, `clip.duration = 3.2`, `currentTime = 4.7`. Splits compound rounding errors.

Good: `clip.startFrame: 45`, `clip.durationFrames: 96`, `currentFrame: 141`. Integer math is exact.

### A9. The "we'll add tests later."

Bad: no tests on `resolveTimeline` because "it's only used by the renderer."

Good: the resolver runs 60 times per second. Bugs are invisible without tests. Tests *are* the spec.

### A10. The 800-line file with a TODO at the top.

Bad: one mega-component that "we'll refactor when it gets bigger."

Good: extract before it's painful. The cost of refactoring scales superlinearly with file size.

---

## See also

- [`ROADMAP.md`](./ROADMAP.md) — the sequenced PR plan that gets us from here to a working editor.
- [`docs/glossary.md`](./docs/glossary.md) — terminology in one place.
- [`docs/backlog/`](./docs/backlog/) — self-contained tickets for each foundation PR.
