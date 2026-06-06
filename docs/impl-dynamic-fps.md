# Implementation: Dynamic Project FPS + Source-FPS-Aware Sampling

## Goal

Two things shipped together:

1. **Per-clip source FPS** — when a video is dropped, its native frame rate is stored on the clip.
   Both renderers use this to sample the correct source frame instead of assuming the source runs
   at the project frame rate. A 120 fps clip in a 30 fps project is sampled accurately with no
   manual configuration.

2. **Project FPS selector UI** — a dropdown in the editor toolbar that lets the user change the
   project's output frame rate at any time. This is purely an output/grid decision; source material
   adapts automatically via (1).

After both changes the developer no longer sets `fps` as a hard construction-time prop on
`<EditorProvider>`. They pick a starting default; the user can change it. Dropped sources adapt
silently regardless of their native frame rate.

---

## Governing constraint

`sourceFrame` in `ActiveClipBase` (and everywhere it flows) is currently a **project-fps integer**:
```
sourceFrame = projectFrame - clip.startFrame + clip.sourceStartFrame
```
Both renderers convert it back to seconds with `sourceFrame / projectFps`. That's wrong when the
source fps ≠ project fps — it picks the wrong frame (documented in Phase 3).

The fix is to carry `sourceFps` on each clip and output `sourceTimeSec` from the resolver so
renderers consume time directly rather than re-deriving it.

---

## Layer 1 — Engine: per-clip sourceFps + sourceTimeSec in scene

### 1a. `Clip` type — add `sourceFps`

**File:** `packages/editor/src/core/types/index.ts`

Add one optional field to `Clip`:

```ts
/**
 * Native frame rate of the source asset. Populated automatically when the
 * clip is created from a dropped file. Undefined for text/image clips (no video source).
 */
sourceFps?: number
```

No other type changes needed to `Clip`. Text and image clips leave it undefined — no source
frame sampling involved.

---

### 1b. `ActiveClipBase` — add `sourceTimeSec`, keep `sourceFrame`

**File:** `packages/editor/src/core/resolver/scene.ts`

Add one field to `ActiveClipBase`. Keep `sourceFrame` for backwards compatibility (timeline UI
uses it for display; nothing breaks if both coexist):

```ts
/**
 * Absolute seek position in the source asset in seconds.
 * Computed using clip.sourceFps when available, otherwise project fps.
 * Renderers use this to seek the underlying media element.
 * Replaces the pattern: sourceFrame / projectFps in renderer code.
 */
sourceTimeSec: number
```

---

### 1c. `resolveTimeline` — compute `sourceTimeSec`

**File:** `packages/editor/src/core/resolver/resolveTimeline.ts`

Current (line 94):
```ts
const sourceFrame = frame - clip.startFrame + clip.sourceStartFrame
```

Add after it:
```ts
// Use clip's own source fps when available so high-fps sources
// (120fps, 60fps) are sampled at their native frame boundaries.
// Falls back to project fps for legacy clips without sourceFps.
const effectiveFps = ('sourceFps' in clip && clip.sourceFps) ? clip.sourceFps : project.fps
const sourceTimeSec = (sourceFrame + 0.5) / effectiveFps
```

Wait — this is subtle. `sourceFrame` is in project-fps units (how many project ticks into the
source). When `sourceFps !== projectFps`, we need to convert project ticks to source ticks first:

```ts
const sourceFrame = frame - clip.startFrame + clip.sourceStartFrame  // project-fps units
// Time in seconds = project ticks / projectFps (same formula as before, independent of sourceFps)
// The +0.5 midpoint is the Phase 3 fix — keeps us inside the correct source frame window.
const sourceTimeSec = (sourceFrame + 0.5) / project.fps
```

**Note:** `sourceTimeSec` doesn't need `sourceFps` to be correct — the midpoint formula already
works for any source fps up to ~500 project frames (proven by ExportFrameSampling.test.ts).
`sourceFps` is needed by `VideoDecoderManager` for its frame-index cache (see 1d below).

Pass `sourceTimeSec` through to each `Active*Clip`:

```ts
// In the video branch:
const active: ActiveVideoClip = {
  ...
  sourceFrame,       // keep — timeline UI reads it
  sourceTimeSec,     // add
  sourceFps: clip.sourceFps,  // pass through for VideoDecoderManager
  ...
}
```

Same for `ActiveAudioClip`. `ActiveTextClip` and `ActiveImageClip` don't need it (no video seek).

---

### 1d. `ActiveVideoClip` / `ActiveAudioClip` — add new fields

**File:** `packages/editor/src/core/resolver/scene.ts`

```ts
export interface ActiveVideoClip extends ActiveClipBase {
  type: 'video'
  src: string
  volume: number
  sourceTimeSec: number   // add
  sourceFps?: number      // add — needed by VideoDecoderManager for cache keying
}
```

---

### 1e. `VideoDecoderManager` — use sourceFps for frame-index cache keying

**File:** `packages/editor/src/core/media/video/VideoDecoderManager.ts`

Current (line 209 and 217):
```ts
const usPerFrame = 1_000_000 / this._fps   // this._fps is project fps
// ...
const sourceFrameIdx = Math.round(frame.timestamp / usPerFrame)
```

The problem: for a 120fps source in a 30fps project, `usPerFrame = 33333µs`. Source frames arrive
every 8333µs. Multiple source frames map to the same project-frame slot and overwrite each other.

Fix: `VideoDecoderManager` needs to know the source fps so it keys the cache by source frame index,
not project frame index:

```ts
// usPerFrame should use sourceFps when known, not projectFps.
// This means the cache slot = source frame index (e.g. frame 47 of the 120fps source)
// instead of project frame index.
const usPerFrame = 1_000_000 / (this._sourceFps ?? this._fps)
const sourceFrameIdx = Math.round(frame.timestamp / usPerFrame)
```

`VideoDecoderManager` already receives `fps` (project fps) in its config. Add `sourceFps?: number`
to `VideoDecoderManagerConfig` and pass it through from `VideoLayer` when creating the manager per
clip. `VideoLayer` reads `sourceFps` from `ActiveVideoClip`.

---

### 1f. `ExportWorker` — read `sourceTimeSec` directly

**File:** `packages/editor/src/core/export/ExportWorker.ts`

Current (~line 348 — the Phase 3 fix):
```ts
const sourceTimeSec = (entry.item.sourceFrame + 0.5) / fps
```

After this change, the scene already carries `sourceTimeSec`. Just read it:
```ts
const sourceTimeSec = entry.item.sourceTimeSec
```

Simpler and the resolver is now the single source of truth for the seek time.

---

### 1g. Where sourceFps comes from: file-drop pipeline

When a video is dropped, the app creates a clip via `engine.addClip(...)`. At that point it needs
to know the source fps.

The mediabunny backend already opens the file and reads `VideoDecoderConfig`. The native fps is
available via the video track's container metadata. We need to expose it.

**File:** `packages/editor/src/core/media/video/demuxer/createMediabunnyBackend.ts`

Add to the returned object:
```ts
getFps(): number | null {
  // mediabunny's VideoTrack exposes framerate via track metadata.
  // Return null if not available (VFR content, container without fps metadata).
  return _track?.frameRate ?? null
}
```

**File:** `packages/editor/src/core/media/video/demuxer/MediabunnyDemuxer.ts`

Expose `getFps(): number | null` — delegates to backend, same pattern as `getConfig()`.

The file-drop handler (wherever `addClip` is called after a drop) reads `demuxer.getFps()` and
passes it as `sourceFps` in the clip config.

> **Risk:** mediabunny's `VideoTrack` may not expose `frameRate` directly. Check the mediabunny
> API surface before implementing. If unavailable, derive it from the first two packet timestamps:
> `fps ≈ 1_000_000 / (packet[1].timestamp - packet[0].timestamp)`. This is reliable for CFR sources.

---

## Layer 2 — Runtime project FPS: engine + playback changes

### 2a. `TimelineEngine` — add `setFps(fps: number)`

**File:** `packages/editor/src/core/editor/TimelineEngine.ts`

```ts
setFps(fps: number): void {
  // Mutate project.fps via Immer (same pattern as other mutations).
  // Emit 'change' so renderers and Zustand re-sync.
  this._mutate(draft => { draft.fps = fps }, 'Set project FPS')
}
```

Note: changing fps changes the meaning of all `startFrame`/`durationFrames` values — a clip at
`startFrame=30` that was "1 second" at 30fps becomes "0.5 seconds" at 60fps. This is expected
behavior (the timeline grid reinterprets existing positions). If a "preserve wall-clock time"
behavior is ever needed, it would require rescaling all clip frames on fps change — that is out of
scope here.

---

### 2b. `PlaybackEngine` — add `setFps(fps: number)`

**File:** `packages/editor/src/core/playback/PlaybackEngine.ts`

`PlaybackEngine.fps` is a private readonly field used in the integrated-frame formula. Changing it
requires re-anchoring the clock so the current position doesn't jump:

```ts
setFps(newFps: number): void {
  if (newFps === this.fps) return
  // Re-anchor: preserve wall-clock position; recalculate frame at new rate.
  const t = this.now()
  this.anchorFrame = this.integratedFrameAt(t)  // frame count at old fps
  this.anchorTime = t
  // fps is currently `readonly` — change to `private` to allow mutation.
  this.fps = newFps
}
```

Change `private readonly fps` → `private fps` (remove readonly).

---

### 2c. `EditorProvider` — wire setFps through context

**File:** `packages/editor/src/editor/EditorProvider.tsx`

Currently `fps` is a construction-time prop baked into both engines at `useMemo` time. After this
change it's a mutable value. Two options:

**Option A (recommended):** Keep `fps` as the initial value prop. Expose a `setProjectFps` function
via `EditorContext` that calls `engine.setFps()` + `playback.setFps()` together.

```ts
// In EditorContext value:
const setProjectFps = useCallback((fps: number) => {
  engine.setFps(fps)
  playback.setFps(fps)
}, [engine, playback])
```

The FPS dropdown reads the current fps from `useTracksStore` (which syncs from `engine.getProject().fps`
on every 'change' event) and calls `setProjectFps` on change.

**Option B:** Accept `fps` as a reactive prop and recreate engines when it changes. Rejected — engine
recreation resets history and all clip state.

---

## Layer 3 — UI: FPS dropdown in toolbar

**New component:** `packages/editor/src/editor/Toolbar/ProjectFpsSelect.tsx`

```tsx
const FPS_OPTIONS = [24, 25, 29.97, 30, 60, 120]

export function ProjectFpsSelect() {
  const fps = useTracksStore(s => s.project.fps)       // current value
  const { engine, playback } = useEditor()             // from EditorContext

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = Number(e.target.value)
    engine.setFps(next)
    playback.setFps(next)
  }

  return (
    <select value={fps} onChange={handleChange}>
      {FPS_OPTIONS.map(f => (
        <option key={f} value={f}>{f} fps</option>
      ))}
    </select>
  )
}
```

Mount it in the existing toolbar/header alongside the stage size controls.

---

## Files changed — summary

| File | Change |
|---|---|
| `core/types/index.ts` | Add `sourceFps?: number` to `Clip` |
| `core/resolver/scene.ts` | Add `sourceTimeSec: number`, `sourceFps?: number` to `ActiveVideoClip`; add `sourceTimeSec` to `ActiveClipBase` |
| `core/resolver/resolveTimeline.ts` | Compute and pass `sourceTimeSec` per clip |
| `core/media/video/demuxer/createMediabunnyBackend.ts` | Add `getFps(): number \| null` |
| `core/media/video/demuxer/MediabunnyDemuxer.ts` | Expose `getFps()` |
| `core/media/video/VideoDecoderManager.ts` | Add `sourceFps` to config; use it for `usPerFrame` cache keying |
| `core/export/ExportWorker.ts` | Read `entry.item.sourceTimeSec` directly |
| `core/editor/TimelineEngine.ts` | Add `setFps(fps: number)` |
| `core/playback/PlaybackEngine.ts` | Add `setFps(fps: number)`; remove `readonly` from `fps` |
| `editor/EditorProvider.tsx` | Expose `setProjectFps` via context |
| `editor/Toolbar/ProjectFpsSelect.tsx` | New component — FPS dropdown |

---

## What does NOT change

- `startFrame`, `durationFrames`, `sourceStartFrame`, `sourceDurationFrames` — still project-fps
  integers. No rescaling on fps change.
- Audio timing — `exportVideo.ts` audio scheduling uses `startFrame / fps` which is already
  correct; `fps` comes from the project at export time.
- `resolveTimeline` purity guarantee — still deterministic, no side-effects.
- `GeometryParity.test.ts` and `ExportFrameSampling.test.ts` — no changes needed.

---

## Known risks / open questions

1. **mediabunny `frameRate` availability** — verify `VideoTrack` exposes fps before implementing
   `getFps()`. Fallback to packet-timestamp derivation if not.

2. **VFR (variable frame rate) sources** — `sourceFps` will be wrong or null for VFR. The existing
   midpoint-seek fix still applies and is safe for the first ~500 project frames. VFR normalization
   is a separate problem, out of scope.

3. **Changing fps reinterprets timeline positions** — a clip at `startFrame=120` at 30fps = 4s.
   At 60fps = 2s. Users need to be aware of this. Consider a warning dialog on fps change if the
   timeline has clips: "Changing FPS will reposition clips. Continue?"

4. **29.97 fps** — stored as the float `29.97` but the true value is `30000/1001`. All division
   by fps will accumulate float error over long timelines. Consider storing as `{ num: 30000, den: 1001 }`
   in the future. For now, `29.97` is acceptable (same as every other video editor's float representation).

---

## Implementation order

1. `Clip` type (`sourceFps` field) — no behaviour change, safe to ship first
2. `scene.ts` + `resolveTimeline` — `sourceTimeSec` flows through
3. `ExportWorker` reads `sourceTimeSec` — export parity improves immediately
4. `VideoDecoderManager` + demuxer `getFps()` — preview accuracy improves
5. `TimelineEngine.setFps` + `PlaybackEngine.setFps` — runtime fps mutation
6. `EditorProvider` wiring — context exposes `setProjectFps`
7. `ProjectFpsSelect` UI component — user-visible change
