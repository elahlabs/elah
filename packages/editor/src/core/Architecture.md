# `@elah/core` Architecture Reference

> **Purpose of this document:** A self-contained cold-start reference for any
> implementation agent working on the engine layer. Load this file and you will
> not need to re-explore `packages/core/src/` from scratch.
>
> **Scope:** the shipped engine — the `@elah/core` package plus the GPU renderer,
> decode pipeline, audio, and export that sit beside it.
>
> **Note:** the codebase is split into four published packages. The `core/X`
> paths below are shorthand for `packages/core/src/X` (the `@elah/core` package).
> React hooks that used to live under `core/` (store hooks, `EditorContext`,
> audio hooks) were extracted into `@elah/react` so `@elah/core` has zero React
> imports — see §2 and §9 for exactly what moved.

---

## 1. Position in the four-package architecture

```
packages/
  core/       (@elah/core)     ← THIS DOCUMENT — runtime; framework-agnostic, zero React
  react/      (@elah/react)    ← React bindings: EditorContext, store hooks, audio hooks
  timeline/   (@elah/timeline) ← timeline UI surface; imports @elah/core + @elah/react
  editor/     (@elah/editor)   ← composition: EditorProvider, hooks, Preview, AssetPanel
```

**Dependency rule (enforced by the package graph):**

```
@elah/core  ←  @elah/react  ←  @elah/timeline  ←  @elah/editor
```

- `@elah/core` may **not** import from `@elah/react`, `@elah/timeline`, or `@elah/editor`.
- `@elah/react` may import from `@elah/core` only.
- `@elah/timeline` may import from `@elah/core` and `@elah/react`, **not** from `@elah/editor`.
- `@elah/editor` may import from all three (and re-exports them).

---

## 2. Directory map

| Folder | Role | Key exports |
|--------|------|-------------|
| `core/types/` | Shared domain types. All time values are integer frame counts. | `Project`, `Track`, `Clip`, `Transform`, `ClipType`, `TrackKind`, `EngineEvent` |
| `core/editor/` | `TimelineEngine` — the authoritative project state machine. Immer mutations, undo/redo history, event emitter. | `TimelineEngine` |
| `core/playback/` | `PlaybackEngine` — frame ticker, RAF loop, transport controls. Reads `currentFrame` from `PlaybackStore` and advances it. | `PlaybackEngine` |
| `core/resolver/` | Pure, deterministic frame resolver. `resolveTimeline(frame, project) → Scene`. No DOM, no React. | `resolveTimeline`, `Scene` (and sub-types) |
| `core/renderer/` | `Renderer` interface + the shipped WebGL2 `GpuRenderer` (`gpu/`): video/image/text layers, `RenderGraph`, context-loss recovery, shared placement helpers. | `Renderer`, `GpuRenderer` |
| `core/media/` | Frame/sample producers. `media/video/` = WebCodecs decode (`StreamingFrameProducer`, `FrameCache`, mediabunny demuxer); `media/audio/` = `AudioPlaybackController`. | `createVideoFrameProvider`, `StreamingFrameProducer`, `AudioPlaybackController` |
| `core/export/` | `exportVideo()` + `ExportWorker` — OffscreenCanvas frame render → mediabunny MP4 mux. | `exportVideo` |
| `core/debug/` | Channel-based `trace()` frame-lifecycle logging (`window.__trace`). | `trace`, `traceEnabled` |
| `core/stores/` | **Vanilla** (`zustand/vanilla`) stores that mirror engine state — no React. Module-level singletons; see §5. | `tracksStore`, `playbackStore`, `selectionStore`, `transitionsStore` |
| `core/assets/` | `MediaLibrary` — in-memory asset registry. Vanilla Zustand store, no React. Drag MIME constant. File import + thumbnail generation. | `mediaLibraryStore`, `importFiles`, `MEDIA_DRAG_MIME`, `MediaAsset` |
| `core/elements/` | Clip factory functions. Pure constructors, no side-effects. | `createVideoClip`, `createAudioClip`, `createTextClip`, `createImageClip` |
| `core/track/` | Track factory. | `createTrack` |
| `core/actions/` | Compound operations (multi-step mutations + engine calls). Currently: `splitClipAtPlayhead`. | `splitClipAtPlayhead` |
| `core/visitor/` | Immer-based project mutation primitives. Used internally by `TimelineEngine`. Not exported publicly. | `addClip`, `removeClip`, `updateClip`, `splitClip`, `cloneClip`, `removeTrack`, `updateTrack` |
| `core/utils/` | Pure helpers: frame math, timecode formatting, snap, ID generation. | `framesToTimecode`, `secondsToFrames`, `framesToSeconds`, `getTotalFrames`, `generateId` |
| `@elah/react`'s `editor-context.ts` | React context + hooks that expose the engines to the component tree. Lives in the separate `@elah/react` package (not under `core/`) so `editor/` and `timeline/` can both import it, and so `@elah/core` stays React-free. | `useEditor`, `useTimelineEngine`, `usePlaybackEngine`, `EditorContext` |

---

## 3. Key type relationships

```
TimelineConfig
    │
    ▼ (constructor)
TimelineEngine
    │
    ├── getProject() ──────────────► Project
    │                                   │
    │                              ┌────┴─────┐
    │                           Track[]    clips: Record<trackId, Clip[]>
    │
    └── on('change', handler) ──► Project  (emitted after every mutation)

resolveTimeline(frame: number, project: Project) ──► Scene
                                                         │
                                          ┌──────────────┼──────────────────┐
                                    ActiveVideoClip[]  ActiveAudioClip[]  ActiveTextClip[]
                                    ActiveImageClip[]  SceneTransition[]

Renderer (interface)
    ├── mount(container: HTMLElement)
    ├── resize(cssW, cssH, dpr?)
    ├── render(scene: Scene)           ◄── consumes only Scene; never Project
    └── dispose()
    └── implemented by GpuRenderer (core/renderer/gpu/)
```

**`Clip` fields** worth knowing:

| Field | Meaning |
|-------|---------|
| `startFrame` | Position on the timeline (frame index where the clip starts) |
| `durationFrames` | Length of the clip on the timeline |
| `sourceStartFrame` | Trim in-point into the source asset |
| `sourceDurationFrames` | Full length of the source asset (for trim constraints) |
| `assetId?` | Reference to a `MediaAsset` in the `MediaLibrary` (preferred over raw `src` when set) |
| `transform?` | Normalized spatial transform `{x, y, scale, rotation, anchor}` — undefined means renderer default |

---

## 4. Runtime data-flow diagram

```mermaid
flowchart LR
  subgraph engines ["Engines (constructed by EditorProvider)"]
    TE["TimelineEngine\ncore/editor/"] 
    PE["PlaybackEngine\ncore/playback/"]
  end

  subgraph stores ["Vanilla stores (core/stores/), bound to React by @elah/react"]
    TS["tracksStore → useTracksStore\n.tracks / .clips / .totalFrames"]
    PS["playbackStore → usePlaybackStore\n.currentFrame / .zoom / .isPlaying"]
    SS["selectionStore → useSelectionStore\n.selectedClipIds"]
  end

  subgraph resolver ["Resolver (core/resolver/)"]
    RT["resolveTimeline(frame, project)"]
    SC["Scene"]
  end

  subgraph rendererLayer ["Renderer (core/renderer/)"]
    RI["Renderer interface\n.mount / .resize / .render / .dispose\n→ GpuRenderer"]
  end

  TE -->|"emits 'change' → sync()"| TS
  PE -->|"setCurrentFrame()"| PS
  TE -->|"getProject()"| RT
  PS -->|"currentFrame"| RT
  RT --> SC
  SC --> RI

  subgraph timelineLayer ["timeline/ layer"]
    TS -->|"useTracks()"| TLComp["Timeline UI\nClipBlock / TrackRow"]
    PS -->|"usePlayback()"| TLComp
  end

  subgraph editorLayer ["editor/ layer"]
    TE --> EP["EditorProvider"]
    PE --> EP
    TS --> URS["useResolvedScene"]
    PS --> URS
    RT --> URS
    URS --> PV["Preview"]
    EP --> AP["AssetPanel"]
  end
```

---

## 5. Store contracts

Each store below is a **vanilla** Zustand store (`zustand/vanilla`) defined in
`@elah/core`, and a **module-level singleton** — one instance per JS realm,
shared by every engine `<EditorProvider>` wires up. `@elah/react` exports a
React-bound version of each (`useTracksStore`, `usePlaybackStore`,
`useSelectionStore`) that wraps the same underlying store — `useTracksStore ===
tracksStore` bound to a hook, not a separate copy of the state. Because the
store is a singleton, only one active `TimelineEngine`/`PlaybackEngine` pair
can be mirrored into it at a time; see §9 and the root READMEs' "one active
project per page" notes.

### `tracksStore` / `useTracksStore` (`core/stores/tracks.store.ts`)

Mirrors `Project` from the engine into React. **Never mutate directly** — always go through the engine.

| Field | Type | Description |
|-------|------|-------------|
| `tracks` | `Track[]` | Reference changes on every engine `'change'` event |
| `clips` | `Record<string, Clip[]>` | Indexed by `trackId` |
| `totalFrames` | `number` | Computed max end frame across all clips |
| `canUndo` / `canRedo` | `boolean` | Engine history state |
| `sync(project, meta)` | method | Called by `<EditorProvider>` in its engine `'change'` listener |

The `tracks` reference replacement on every `sync()` call is the cheapest "project mutated" signal. `useResolvedScene` subscribes to it via `useTracksStore((s) => s.tracks)` purely for this trigger.

### `playbackStore` / `usePlaybackStore` (`core/stores/playback.store.ts`)

Partially persisted to `localStorage` key `myeditor-playback`. Persisted fields: `zoom`, `volume`, `muted`, `playbackRate`, `loop`, `snapEnabled`.

| Field | Description |
|-------|-------------|
| `currentFrame` | Current playhead position (integer frames) |
| `currentFrameEpoch` | Monotonically incremented counter; detects repeat seeks to the same frame |
| `isPlaying` | Transport state |
| `zoom` | Pixels per frame (timeline zoom level) |
| `snapEnabled` | Snap-to-grid toggle |

### `selectionStore` / `useSelectionStore` (`core/stores/selection.store.ts`)

Holds `selectedClipIds: string[]`. Not mirrored from the engine — selection is a pure UI concern.

---

## 6. `TimelineEngine` event model

The engine is a typed event emitter. Listeners registered with `.on(event, handler)` are called synchronously after each mutation.

| Event | Payload | When fired |
|-------|---------|------------|
| `'change'` | `Project` | After **every** mutation (broadest trigger) |
| `'track:added'` | `Track` | After `addTrack()` |
| `'track:removed'` | `string` (trackId) | After `removeTrack()` |
| `'clip:added'` | `Clip` | After `addClip()` |
| `'clip:removed'` | `{ clipId, trackId }` | After `removeClip()` |
| `'clip:updated'` | `Clip` | After `updateClip()`, `moveClip()`, `trimClip()` |
| `'clip:split'` | `{ leftId, rightId, trackId }` | After `splitClip()` |
| `'transition:added'` | `Transition` | After `addTransition()` |
| `'transition:removed'` | `string` (transitionId) | After `removeTransition()` |
| `'history:change'` | `{ canUndo, canRedo }` | After any mutation or undo/redo |

`<EditorProvider>` subscribes to `'change'` and calls `tracksStore.getState().sync()`. That is the only bridge between the engine and the stores.

---

## 7. `resolveTimeline` guarantees

- **Pure and deterministic** — same `(frame, project)` always produces structurally equal output.
- **No side-effects** — safe in tests, Web Workers, WASM export pipelines.
- **No DOM, no React, no Zustand** — plain data in, plain data out.
- Respects `track.disabled`, `clip.disabled`, `track.muted`, `track.solo`.
- Output arrays are sorted ascending by `zIndex`; index 0 = furthest back, last = front.
- `zIndex` is derived from `track.order` × 1000, leaving room for future sub-layer offsets.

---

## 8. `MediaLibrary` (`core/assets/`)

In-memory registry of source assets. Not yet persisted (IndexedDB/OPFS arrives in Phase 3).

- `importFiles(files, opts?)` — takes `File[]`, creates object URLs, probes metadata via `<video>` / `<audio>` / `<img>`, registers `MediaAsset`s in the store, and generates thumbnails asynchronously on the main thread (`thumbnailUrl` patched via `updateAsset`)
- `mediaLibraryStore` (`@elah/core`) — vanilla Zustand store for granular subscriptions and imperative access (`addAsset`, `removeAsset`, `updateAsset`, `getAsset`)
- `useMediaLibrary()` / `useMediaLibraryStore` (`@elah/react`) — React hook for reading assets in insertion order (`getAsset`, ordered `assets` list), and the React-bound store
- `MEDIA_DRAG_MIME = 'application/x-elah-media'` — MIME type placed on `dataTransfer` when dragging from `AssetPanel`
- `DragMediaPayload = { kind: 'media-asset'; assetId: string }` — JSON-encoded payload

**Import flow:**

```
File[] → importFiles()
  ├─ infer kind from MIME (video/audio/image; skip unknown)
  ├─ URL.createObjectURL(file) → asset.src
  ├─ probe metadata (duration, width, height)
  ├─ addAsset() — returns immediately (no thumbnailUrl yet)
  └─ scheduleThumbnail() — fire-and-forget; updateAsset({ thumbnailUrl }) when ready
```

`sourceFps` extraction (mediabunny / MP4Box.js) and audio waveform peaks are deferred to later PRs.

---

## 9. What is NOT in `core/`

Knowing what is absent is as important as knowing what is present:

| Concern | Lives in |
|---------|----------|
| `EditorContext`, `useEditor`, `useTimelineEngine`, `usePlaybackEngine` | `@elah/react` |
| `useTracksStore`, `usePlaybackStore`, `useSelectionStore`, `useTransitionsStore`, `useMediaLibraryStore`, `useMediaLibrary` (React-bound stores) | `@elah/react` |
| `useAudioMixer`, `useTrackLevels`, `useMasterVolume` (audio hooks) | `@elah/react` |
| Any React import at all | not in `@elah/core` — zero React in its module graph |
| `<Timeline>` component, `<ClipBlock>`, `<TrackRow>`, `<Ruler>`, `<Playhead>` | `@elah/timeline` |
| `useTracks`, `usePlayback`, `useSelection` hooks (public API) | `@elah/timeline` (`src/hooks/`) |
| `useTimeline`, `useTimelineDrop` drop handler | `@elah/timeline` (`src/`) |
| `<EditorProvider>` | `@elah/editor` (`src/editor/`) |
| `useResolvedScene` | `@elah/editor` (`src/editor/`) |
| `<Preview>` component (mounts the renderer + RAF) | `@elah/editor` (`src/editor/Preview/`) |
| `<AssetPanel>`, `<ElementsPanel>`, `<SourcePanel>` components | `@elah/editor` (`src/editor/`) |

---

## 10. What's next for `core/`

The engine, renderer, decode pipeline, audio, and export have all landed. The
next architectural layer is a **scheduler / media-coordination** system above the
frame providers (predictive caching, reverse-scrub strategy, cross-clip decode
prioritization). See [`ROADMAP.md`](../../../../ROADMAP.md) and
[`CURRENT_LIMITATIONS.md`](../../../../CURRENT_LIMITATIONS.md). It is expected to
sit between `core/renderer/` and `core/media/video/` without changing the
`VideoFrameProvider` interface.
