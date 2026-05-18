# PR-07 onwards · Post-foundation roadmap

> Sketches, not full tickets. After PR-06 lands, plan PR-07 in detail with fresh eyes and create a dedicated `PR-07-*.md` ticket then. This file exists so you know what's coming and can keep the foundation honest.
>
> **Package layout assumed:** single package `@elah/editor`, internally laid out as `core/` + `timeline/` + `editor/` (established in PR-04). All file paths below are under `packages/editor/src/`.

---

## Phase 1 · Real media in, video out (PR-07 → PR-11)

The goal of this phase: **press Play, see a real video file play in the editor**. That's the milestone that turns "engine SDK" into "editor."

### PR-07 — `MediaLibrary.importFiles`

Take `File[]` (from `<input>` or drop), build `MediaAsset`s, register them in `useMediaLibraryStore`.

- Create object URLs.
- Probe metadata via `<video>` / `<audio>` / `<img>` elements (`loadedmetadata` event).
- Generate thumbnails (video: seek + drawImage; image: direct draw). Main thread is fine.
- Optionally extract `sourceFps` via `mediabunny` or `MP4Box.js` (deferrable; default to `project.fps` if unknown).

**Lands in:** `core/media/importFiles.ts` (pure logic) and re-exported from the package barrel.

**Acceptance:** `await importFiles(files)` returns assets; `useMediaLibraryStore.assets` is populated; thumbnails appear asynchronously.

### PR-08 — `<AssetPanel />` UI

A panel that lists `useMediaLibraryStore.order` items as draggable thumbnails. Renders inside `<EditorProvider>` as a sibling of `<Timeline>` and `<Preview>`.

- File `<input>` for browsing.
- Drop zone on the panel itself for drag-from-OS.
- Each thumbnail is `draggable` with `dataTransfer.setData(MEDIA_DRAG_MIME, JSON.stringify({kind:'media-asset', assetId}))`.
- No grid virtualization yet (first 100 assets handled by CSS grid is fine).

**Lands in:** `editor/AssetPanel/` (composition layer — depends on `core/media/`).

**Acceptance:** drop files onto the panel → thumbnails appear; drag a thumbnail and see the OS drag cursor.

### PR-09 — `useTimelineDrop` implementation

Fill in the stub from PR-06 (`timeline/useTimelineDrop.ts`).

- Listen for `dragover` (accept payloads of `MEDIA_DRAG_MIME`).
- Listen for `drop`: parse JSON, resolve `assetId → MediaAsset` via `useMediaLibrary().getAsset`, compute drop frame from `event.clientX - lane.getBoundingClientRect().left + lane.scrollLeft` divided by `zoom`.
- Check track-kind compatibility (video/image on video tracks; audio on audio tracks).
- Call `engine.addClip({ ..., assetId, src: asset.src, startFrame, durationFrames: round(asset.durationSec * project.fps), sourceStartFrame: 0, sourceDurationFrames: same })`.
- Snap to playhead / clip edges if `usePlaybackStore.snapEnabled`.

**Lands in:** `timeline/useTimelineDrop.ts` (body filled in; signature already established by PR-06).

**Acceptance:** drag a thumbnail from `<AssetPanel>` onto a track lane → a clip is created at the drop point with correct duration.

### PR-10 — `<Preview />` + `DomRenderer`

The big one. The first time pixels move.

- `<Preview />` is a portrait-aspect container (read `project.stage` for aspect; for MVP, hard-code or read once).
- Instantiates a `DomRenderer` in `useEffect` and calls `mount(containerEl)`.
- Subscribes to `useResolvedScene()`.
- `DomRenderer`:
  - Maintains a pool of `<video>` elements keyed by clip id (or `assetId` for shared decoders).
  - On each `render(scene)`: reconcile active clips. For each in `scene.videos`:
    - If element doesn't exist, create + append to container.
    - Set `currentTime = sourceFrame / fps` if the diff is larger than ~1 frame; otherwise let it play freely.
    - Set CSS opacity / transform from `transform` (if present).
  - For each in `scene.audios`: same, but `<audio>` elements; gain via Web Audio.
  - For each in `scene.texts`: absolutely-positioned `<div>` with `style.transform`.
  - On clips no longer in scene: pause + `display: none` (don't remove; pool).
- Audio plays through a shared `AudioContext` (see PR-12 for proper anchoring).

**Lands in:** `editor/Preview/Preview.tsx` and `editor/renderer/DomRenderer.ts`. `DomRenderer` implements the `Renderer` interface from `core/renderer/types.ts`. May import from `core/`; must not pull from `timeline/`.

**Acceptance:** add a video clip from the asset panel, press Play → the video plays in the Preview pane. Audio plays.

### PR-11 — Wire `<EditorSDK />` into the playground

Introduce `<EditorSDK />` as the top-level shell (`editor/EditorSDK.tsx`) and use it in `App.tsx`:

```tsx
<EditorSDK>
  <AssetPanel />
  <Timeline />
  <Preview />
</EditorSDK>
```

`<EditorSDK>` is a thin wrapper around `<EditorProvider>` + a default layout. Fix any layout issues at the playground level.

**Acceptance:** the demo app is now a working three-pane editor using the composition pattern.

---

## Phase 2 · Editing polish (PR-12 → PR-16)

### PR-12 — AudioContext clock anchoring

Replace `performance.now()` in `PlaybackEngine` with an `AudioContext.currentTime`-grounded clock (Freecut's `Clock._now()` pattern). Eliminates audio-video drift.

### PR-13 — Selection → Preview integration

Clicking a clip in the timeline selects it; the Preview shows a transform gizmo (corners + rotation handle) over the selected clip. Drags emit `transform` updates via `engine.updateClip`.

### PR-14 — Text overlay editing UI

A panel for editing text content, font, color, alignment. Per-clip transform via the gizmo from PR-13.

### PR-15 — Snap improvements

Snap to: playhead, clip edges (start / end of any clip), grid (every N frames). UI for enable/disable. Lift from `utils/snap.ts`.

### PR-16 — Multi-clip selection + batch drag

Hold Shift to multi-select clips; drag moves the whole group. Engine `batch()` makes this one undo entry.

---

## Phase 3 · Features (PR-17+)

In rough priority order — but reorder freely based on what users actually need:

- **Transitions** between adjacent clips (crossfade first; `Scene.transitions` already reserved).
- **Effects** (filters: brightness, contrast, blur). Likely a Canvas/WebGL renderer at this point.
- **Animations** on text overlays (slide-in, fade, typewriter). Add keyframe types now planned in glossary.
- **Export pipeline** — `VideoEncoder` (WebCodecs) + `mediabunny` for muxing. Runs in a Worker.
- **Project persistence** — IndexedDB; serialize `Project` + `MediaLibrary` (using OPFS for asset blobs).
- **Project loading** — open a previously-saved project; re-link missing assets.
- **Keyboard shortcuts panel** — discoverable shortcut list.
- **Templates** — start a project from a template (intro/outro reels, lower-thirds).
- **Captions** — auto-generated or imported SRT, mapped to text clips on a caption track.

Plan each as a dedicated `PR-NN-*.md` ticket when it's next up.

---

## Phase 4 · Performance and scale (when measured)

Don't do these until profiling proves the need.

- **Memoize `resolveTimeline`** on `(frame, project)` reference identity.
- **Binary-search clip activation** (`pickActiveClip`) when clips per track exceed ~200.
- **Worker-based thumbnail generation** when import freezes the UI.
- **WebGL/WebGPU renderer** when DOM compositing becomes the bottleneck (4K, many overlays).
- **Virtualized timeline rows** when track count exceeds ~50.
- **Web Worker for resolver in export path** — already pure, just needs the runner.

---

## Phase 5 · Package extraction (when forced — not now)

The single package `@elah/editor` is **already internally layered** into `core/` + `timeline/` + `editor/` (PR-04). That layering is the architecture. External package extraction is a separate decision, and the current direction is to **defer it** until real pressure exists.

Extract into separate npm packages **only when** at least one is true:

1. A non-React consumer ships (Node CLI, worker-only export pipeline, Electron preload).
2. Build time crosses a threshold that bothers contributors (~5s+ steady).
3. Independent adoption: a downstream app wants `timeline` without `editor`, or `core` without React.
4. A renderer needs its own dependency graph (e.g. `@mediabunny/*` for export) that the rest of the package shouldn't carry.

When the time comes, the layered folder names map directly to package names:

- `@elah/core`    ← `core/`     (types, engine, playback, resolver, stores, actions, media, utils)
- `@elah/timeline` ← `timeline/` (Timeline UI + hooks + drop)
- `@elah/editor`  ← `editor/`   (EditorProvider, EditorSDK, AssetPanel, Preview, useResolvedScene, DomRenderer)
- `@elah/player`   — future, if a non-React player runtime is needed
- `@elah/renderer` — future renderers (GPU, export)

Because the layering is enforced from PR-04 onwards (dependency rule: `core → timeline → editor`), the extraction itself is a mechanical move-files-and-update-imports operation. Until then, **do not pre-split**. Premature extraction was the failure mode of `Oxide-Editor` and `render-kit`.

> When extraction does happen, add a CI rule that fails the build on cross-package imports outside declared deps (Freecut-style). Until extraction, review-enforce the layering and consider an ESLint `no-restricted-imports` boundary rule once the layout stabilizes.

---

## What never makes the cut

- A plugin system without two consumers.
- An event bus that isn't `engine.on(...)`.
- A second state library.
- A "core types" library that's used by one consumer.
- A WASM module that hasn't been profiled to need it.
- Splitting `@elah/editor` into multiple packages before the criteria above are met.
- Exposing raw `useEditorStore.setState(...)` as the recommended API instead of named hooks (`useAssets`, `usePlayback`).

See [`ARCHITECTURE.md` § 9](../../ARCHITECTURE.md#9-what-this-architecture-rejects-anti-patterns).
