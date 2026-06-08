# Before rendering — explore the system end-to-end

> **Goal:** Understand how data flows from gallery upload → drag/drop → timeline → engine → resolver **before** you implement Scene, Renderer, Pool, or DOM lifecycle (study-plan afternoon session).
>
> **Rule:** Every `console.log` and temporary debug UI you add during this walkthrough is scaffolding — remove it before you commit. Same for the debug `<pre>` showing `Scene` JSON.

---

## What you already have vs what's missing

| Works today | Missing (the gap) |
|---|---|
| Upload files in `AssetPanel` | No `<Preview>` / pixel output |
| Drag asset onto timeline | No `DomRenderer` implementation |
| Clips stored in `TimelineEngine` | `Renderer` is only an interface |
| Playhead moves, frame counter updates | Nothing consumes `Scene` at 60 Hz |
| `resolveTimeline(frame, project) → Scene` | `useResolvedScene` exists but nothing renders it |

**The afternoon session fills the right column.** This document is how you earn the left column first.

---

## Step 0 — Run the playground

```bash
cd video-editor
npm run dev
```

Opens `apps/playground`. Confirm the layout:

- **Left:** `AssetPanel` (upload + thumbnails)
- **Right:** `Timeline` (ruler, tracks, playhead)
- **Toolbar:** tracks, clips, Play/Pause, Undo/Redo, zoom, frame counter

**Manual smoke test:**

1. Upload a video via AssetPanel (file input or drop on panel).
2. Click **+ Video Track**.
3. Drag the thumbnail onto the track lane.
4. Press **Play**.

**Observe:** playhead moves, frame counter updates, **no video pixels anywhere**. That's expected — you're about to learn why.

**Optional:** `?lab` in the URL loads `MediaLimitsLab` for browser media experiments (`apps/playground/src/App.tsx`).

---

## Step 1 — Upload entry point

**Read (in order):**

| File | What to find |
|---|---|
| `packages/editor/src/editor/AssetPanel/AssetPanel.tsx` | `<input type="file">`, drop zone, `onDragStart` |
| `packages/editor/src/core/media/importFiles.ts` | `importFiles(File[])` — probe metadata, thumbnails |
| `packages/editor/src/core/media/store.ts` | `useMediaLibraryStore` — `assets`, `order` |
| `packages/editor/src/core/media/types.ts` | `MediaAsset`, `MEDIA_DRAG_MIME`, `DragMediaPayload` |

**Key shape — memorize `MediaAsset`:**

```ts
interface MediaAsset {
  id: string
  kind: 'video' | 'audio' | 'image'
  name: string
  src: string              // blob URL after import
  durationSec: number
  width?, height?, sourceFps?, thumbnailUrl?, byteSize, addedAt
}
```

**Console logs to add:**

```ts
// AssetPanel.tsx — when files are picked or dropped
console.log('[upload] files', files.length, [...files].map(f => f.name))

// importFiles.ts — start
console.log('[importFiles] start', files.length)

// importFiles.ts — before return of each asset
console.log('[importFiles] asset', { id, kind, durationSec, width, height })

// store.ts — after add
console.log('[mediaStore] count', Object.keys(getState().assets).length)
```

**Checkpoint:** *When I drop a file, what exactly lands in the media store?* You should be able to describe `MediaAsset` without opening the file.

---

## Step 2 — Drag payload (AssetPanel → Timeline boundary)

**Read:**

| File | What to find |
|---|---|
| `AssetPanel.tsx` | `MEDIA_DRAG_MIME`, `JSON.stringify({ kind: 'media-asset', assetId })` |
| `packages/editor/src/timeline/useTimelineDrop.ts` | `dragover`, `drop`, frame math, `engine.addClip` |

**MIME constant:** `application/x-elah-media` (`core/media/types.ts`).

**Payload:**

```ts
{ kind: 'media-asset', assetId: string }
```

On drop, `useTimelineDrop` resolves `assetId → MediaAsset`, computes `dropFrame` from pointer position + scroll + zoom, then calls `engine.addClip` with `assetId`, `src`, `startFrame`, `durationFrames`, etc.

**Console logs:**

```ts
// AssetPanel.tsx — onDragStart
console.log('[drag:start]', payload)

// useTimelineDrop.ts — drop (before addClip)
console.log('[drop]', {
  assetId, asset: asset?.name,
  dropFrame, durationFrames, trackId, trackKind
})
```

**Checkpoint:** *What must cross the AssetPanel → Timeline boundary, and why each field?*  
`durationSec` → `durationFrames`; `src` → clip can play later; `assetId` → dedupe source metadata.

---

## Step 3 — Engine mutation (one funnel)

**Read:**

| File | What to find |
|---|---|
| `packages/editor/src/core/editor/TimelineEngine.ts` | `addClip`, `commit`, `getProject`, events |
| `packages/editor/src/core/visitor/add.ts` | Immer draft: insert clip, sort, no overlap |
| `packages/editor/src/core/stores/tracks.store.ts` | `sync(project)` after `engine.on('change')` |
| `packages/editor/src/editor/EditorProvider.tsx` | `engine.on('change') → syncTracks` |

**Flow:**

```
drop → engine.addClip(options)
     → commit() — Immer produce, history push
     → emit('change')
     → EditorProvider syncTracks()
     → useTracksStore.sync()
     → React re-render (ClipBlock, TrackRow, …)
```

**Console logs:**

```ts
// TimelineEngine.addClip or commit
console.log('[engine] addClip', { trackId, type, startFrame, durationFrames, assetId })

// commit — after produce
console.log('[engine] commit', { version, clipCount })

// tracks.store sync
console.log('[tracksStore] sync', project.version)
```

**Checkpoint:** *Where does mutation become visible to React?* Count the layers: engine → event → store → selector → component.

**Architecture rule (Ring 0 → Ring 1):** Components never write `Project` directly. Everything goes through `TimelineEngine.commit()`. See `video-editor/ARCHITECTURE.md` §2.

---

## Step 4 — Playback clock

**Read:**

| File | What to find |
|---|---|
| `packages/editor/src/core/playback/PlaybackEngine.ts` | anchor-and-integrate, `getFrameAt()`, rAF sampler |
| `packages/editor/src/core/stores/playback.store.ts` | `togglePlayPause`, `setCurrentFrame`, `currentFrameEpoch` |
| `packages/editor/src/editor/EditorProvider.tsx` | **Engine ↔ store bridge** (both directions) |

**Bridge lives in `EditorProvider.tsx`, not `Timeline.tsx`:**

1. **Engine → Store** (`playback.subscribe`): updates `currentFrame` only when integer frame changed; syncs `isPlaying`.
2. **Store → Engine** (`usePlaybackStore.subscribe`): play/pause/seek/rate/loop from UI back into engine.

**Echo guard (prevents infinite loop):**

```ts
// Store → Engine: only seek when epoch changed AND frames differ
if (state.currentFrameEpoch !== prev.currentFrameEpoch &&
    state.currentFrame !== playback.currentFrame) {
  playback.seek(state.currentFrame)
}
```

Ruler scrub: `Ruler.onSeek` → `setCurrentFrame` → store epoch bump → engine `seek`.

**Console logs:**

```ts
// PlaybackEngine — transport only (not every RAF tick)
console.log('[clock] play')
console.log('[clock] pause')
console.log('[clock] seek', frame, 'epoch', this._epoch)

// Throttled during play (e.g. every 30 frames)
console.log('[clock] tick', snapshot.currentFrame)

// EditorProvider — bridge
console.log('[bridge] engine→store', snapshot.currentFrame)
console.log('[bridge] store→engine seek', state.currentFrame)
```

**Checkpoint:** *Click the ruler — why doesn't play/pause loop forever?* Point to the epoch + equality guards in `EditorProvider.tsx`.

**Checkpoint:** *What does the clock emit that nothing consumes for pixels?* `currentFrame` + `resolveTimeline` → `Scene` with no renderer.

**Deep dive (optional):** `01-playback-clock-architecture.md`, `docs/backlog/update-clock-fucntion.md`.

---

## Step 5 — Resolver (what the renderer will eat)

**Read:**

| File | What to find |
|---|---|
| `packages/editor/src/core/resolver/scene.ts` | `Scene`, `ActiveVideoClip`, `ActiveAudioClip`, … |
| `packages/editor/src/core/resolver/resolveTimeline.ts` | rules: inclusion, source mapping, mute/solo, zIndex |
| `packages/editor/src/core/resolver/resolveTimeline.test.ts` | executable spec — read the cases |
| `packages/editor/src/editor/useResolvedScene.ts` | `useMemo` + `resolveTimeline(frame, project)` |

**`Scene` at frame F tells you:**

- Which clips are **active** (half-open: `startFrame <= F < startFrame + duration`)
- Each clip's **`sourceFrame`** inside the media file
- **`zIndex`**, **`opacity`**, volume (for audio)

**It does NOT:** touch DOM, seek `<video>`, or know about React.

**Console log:**

```ts
// resolveTimeline.ts — end of function
console.log('[resolve]', frame, {
  v: scene.videos.length,
  a: scene.audios.length,
  t: scene.texts.length,
  i: scene.images.length,
})
```

**Temporary debug UI (playground only):**

In `apps/playground/src/App.tsx`:

```tsx
import { useResolvedScene } from '@elah/editor'

// inside App:
const scene = useResolvedScene()

// render somewhere visible:
<pre style={{ fontSize: 10, maxHeight: 120, overflow: 'auto' }}>
  {JSON.stringify(scene, null, 2)}
</pre>
```

Press Play and watch `scene.videos[0].sourceFrame` increment. **This is the renderer's input contract.**

**Checkpoint:** *At frame 142, what does the Scene say?* Example: "Show clip `c1` at `sourceFrame` 12, `zIndex` 1000."

---

## Step 6 — Confirm the renderer void

**Read:**

| File | What to find |
|---|---|
| `packages/editor/src/core/renderer/types.ts` | `Renderer { mount, render, dispose }` — **interface only** |
| `packages/editor/src/index.ts` | exports `useResolvedScene`, no `Preview`, no `DomRenderer` |

**Planned contract:**

```ts
interface Renderer {
  mount(container: HTMLElement): void
  render(scene: Scene): void
  dispose(): void
}
```

**Checkpoint:** *If I had a `DomRenderer` today, who calls `render(scene)` 60×/sec?*

| Path | Pros | Cons |
|---|---|---|
| **A.** `<Preview>` uses `useResolvedScene()` in `useEffect` | Easy to wire in React | React may coalesce updates; not frame-accurate |
| **B.** Renderer subscribes to `playback.subscribe()`, calls `resolveTimeline` itself | Frame-accurate, bypasses React | More wiring in `Preview` mount |

`ARCHITECTURE.md` §6 recommends **B** for the DomRenderer MVP. Start with A if you need to see pixels fast; migrate to B when you notice stutter.

---

## Step 7 — Draw one full lifecycle

Before writing renderer code, document one path on paper or in a section below.

**Template:**

```
[upload video.mp4]
  AssetPanel.onDrop / file input
    → importFiles([file])
      → MediaAsset { id, src: blob:…, durationSec, kind: 'video' }
        → useMediaLibraryStore

[drag asset onto track t1 @ ~300px, zoom=10]
  AssetPanel onDragStart → MEDIA_DRAG_MIME payload
    → useTimelineDrop.onDrop
      → dropFrame = …
      → engine.addClip({ trackId, assetId, src, startFrame, durationFrames, … })
        → commit → emit('change')
          → tracks.store.sync → ClipBlock appears

[press Play]
  toolbar togglePlayPause
    → playback.store → EditorProvider → playback.play()
      → rAF → notify({ currentFrame })
        → playback.store.setCurrentFrame
          → useResolvedScene → resolveTimeline(frame, project)
            → Scene { videos: [{ id, sourceFrame, zIndex, … }] }
              → (nothing renders pixels — GAP)
```

**Done when:** you can draw this without opening the codebase.

---

## Step 8 — Design the renderer (paper only)

Create `video-editor/docs/notes/renderer-design.md` (or a section in this file) and answer:

### 8.1 Scene → DOM mapping

| `Scene` field | DOM action |
|---|---|
| `videos[]` | `<video>` per active clip, `currentTime = sourceFrame / fps` |
| `audios[]` | `<audio>` or Web Audio graph (later) |
| `texts[]` | `<div>` with `content`, positioned with transform |
| `images[]` | `<img src=…>` |

Renderer reads **only** `Scene`. Never `Project`, `Clip`, or `Track`. See `05-dom-renderer-design.md` and `07-video-element-pooling.md`.

### 8.2 Pool

When a clip leaves `scene.videos` (ended or seeked away):

- Destroy `<video>`? **No** — return to pool (decode cache is expensive).
- Same clip returns later? **Reuse** pooled element by `clip.id`.

Read `07-video-element-pooling.md` before implementing `VideoPool.ts`.

### 8.3 DOM lifecycle (manual reconciliation)

Each `render(scene)`:

1. Diff previous scene clip ids vs current.
2. **Appeared** → acquire from pool, mount, seek.
3. **Persisted** → update `currentTime` / opacity only.
4. **Disappeared** → return to pool (don't destroy unless pool cap exceeded).

Same idea as React reconciliation, but you own it to avoid 60 Hz React re-renders.

### 8.4 Subscription

Choose A or B from Step 6. Write down which you'll build first and what triggers `render(scene)`.

---

## Step 9 — Implementation order (next session, not today)

Only after Steps 0–8:

| Order | File | Role |
|---|---|---|
| 1 | `core/renderer/DomRenderer.ts` | Implements `Renderer`, no React |
| 2 | `core/renderer/VideoPool.ts` | Reuse `<video>` elements |
| 3 | `editor/Preview/Preview.tsx` | Mounts renderer, feeds scenes |
| 4 | `apps/playground/src/App.tsx` | `<Preview>` sibling of AssetPanel + Timeline |

**Read first:** `05-dom-renderer-design.md`, `07-video-element-pooling.md`, `video-editor/ARCHITECTURE.md` §§5–7.

**Do not start Step 9 until Step 7 diagram and Step 8 answers exist.**

---

## Quick reference — file map

```
apps/playground/src/App.tsx          ← dev shell, toolbar, layout

editor/
  EditorProvider.tsx                 ← engines + store bridges
  AssetPanel/AssetPanel.tsx          ← upload, drag source
  useResolvedScene.ts                ← Scene for current frame

timeline/
  Timeline.tsx                       ← ruler, tracks, playhead
  useTimelineDrop.ts                 ← drop → addClip
  Playhead.tsx, Ruler.tsx, TrackRow.tsx, ClipBlock.tsx

core/
  media/importFiles.ts, store.ts, types.ts
  editor/TimelineEngine.ts
  playback/PlaybackEngine.ts
  resolver/resolveTimeline.ts, scene.ts
  renderer/types.ts                  ← interface only (empty seat)
  stores/playback.store.ts, tracks.store.ts
```

---

## Study-plan mapping

| study-plan.md afternoon focus | Covered in step |
|---|---|
| Scene | Step 5 |
| Renderer | Steps 6, 8 |
| Pool | Step 8.2 → implement Step 9.2 |
| DOM lifecycle | Step 8.3 → implement Step 9.1 |

---

## Checklist before you code the renderer

- [ ] Ran playground; uploaded, dragged, played; confirmed no Preview pixels
- [ ] Traced upload → `MediaAsset` in store
- [ ] Traced drag MIME → `useTimelineDrop` → `addClip`
- [ ] Traced `commit` → `tracks.store.sync` → UI update
- [ ] Found engine↔store bridge in `EditorProvider.tsx`; explained echo guard
- [ ] Watched live `Scene` JSON while playing (temporary debug UI)
- [ ] Located empty `Renderer` interface
- [ ] Drew full lifecycle diagram (Step 7)
- [ ] Answered four design questions (Step 8)
- [ ] Removed all temporary `console.log`s and debug UI

When all boxes are checked, you're ready for the afternoon implementation session.
