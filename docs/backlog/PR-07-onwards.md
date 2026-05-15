# PR-07 onwards · Post-foundation roadmap

> Sketches, not full tickets. After PR-06 lands, plan PR-07 in detail with fresh eyes and create a dedicated `PR-07-*.md` ticket then. This file exists so you know what's coming and can keep the foundation honest.

---

## Phase 1 · Real media in, video out (PR-07 → PR-11)

The goal of this phase: **press Play, see a real video file play in the editor**. That's the milestone that turns "engine SDK" into "editor."

### PR-07 — `MediaLibrary.importFiles`

Take `File[]` (from `<input>` or drop), build `MediaAsset`s, register them in `useMediaLibraryStore`.

- Create object URLs.
- Probe metadata via `<video>` / `<audio>` / `<img>` elements (`loadedmetadata` event).
- Generate thumbnails (video: seek + drawImage; image: direct draw). Main thread is fine.
- Optionally extract `sourceFps` via `mediabunny` or `MP4Box.js` (deferrable; default to `project.fps` if unknown).

**Acceptance:** `await importFiles(files)` returns assets; `useMediaLibraryStore.assets` is populated; thumbnails appear asynchronously.

### PR-08 — `<MediaGallery />` UI

A panel that lists `useMediaLibraryStore.order` items as draggable thumbnails.

- File `<input>` for browsing.
- Drop zone on the gallery itself for drag-from-OS.
- Each thumbnail is `draggable` with `dataTransfer.setData(MEDIA_DRAG_MIME, JSON.stringify({kind:'media-asset', assetId}))`.
- No grid virtualization yet (first 100 assets handled by CSS grid is fine).

**Acceptance:** drop files onto the gallery → thumbnails appear; drag a thumbnail and see the OS drag cursor.

### PR-09 — `useTimelineDrop` implementation

Fill in the stub from PR-06.

- Listen for `dragover` (accept payloads of `MEDIA_DRAG_MIME`).
- Listen for `drop`: parse JSON, resolve `assetId → MediaAsset`, compute drop frame from `event.clientX - lane.getBoundingClientRect().left + lane.scrollLeft` divided by `zoom`.
- Check track-kind compatibility (video/image on video tracks; audio on audio tracks).
- Call `engine.addClip({ ..., assetId, src: asset.src, startFrame, durationFrames: round(asset.durationSec * project.fps), sourceStartFrame: 0, sourceDurationFrames: same })`.
- Snap to playhead / clip edges if `usePlaybackStore.snapEnabled`.

**Acceptance:** drag a thumbnail from the gallery onto a track lane → a clip is created at the drop point with correct duration.

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

**Acceptance:** add a video clip from the gallery, press Play → the video plays in the Preview pane. Audio plays.

### PR-11 — Wire `<Preview />` into the playground

Add `<Preview />` as a sibling of `<Timeline />` and `<MediaGallery />` inside `<EditorProvider>` in `App.tsx`. Fix any layout issues.

**Acceptance:** the demo app is now a working three-pane editor.

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

## Phase 5 · Package split (when forced)

Currently everything lives in `@myeditor/timeline`. Split into separate packages **only when**:

1. The build time exceeds ~5s.
2. A renderer needs its own dependency graph (e.g. `@mediabunny/*` for export).
3. Multiple downstream apps need different subsets.

When the time comes:
- `@myeditor/core` — types + frame math + id (peer-less).
- `@myeditor/engine` — `TimelineEngine` + visitors + stores.
- `@myeditor/playback` — `PlaybackEngine` + clock.
- `@myeditor/resolver` — `resolveTimeline` + Scene.
- `@myeditor/media` — MediaLibrary.
- `@myeditor/renderer-dom`, `@myeditor/renderer-gpu`, `@myeditor/export`.
- `@myeditor/ui` — `<Timeline>`, `<EditorProvider>`, `<MediaGallery>`, `<Preview>`.

Add a CI script (Freecut-style) that fails the build on cross-package imports outside declared deps.

---

## What never makes the cut

- A plugin system without two consumers.
- An event bus that isn't `engine.on(...)`.
- A second state library.
- A "core types" library that's used by one consumer.
- A WASM module that hasn't been profiled to need it.

See [`ARCHITECTURE.md` § 9](../../ARCHITECTURE.md#9-what-this-architecture-rejects-anti-patterns).
