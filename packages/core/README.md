# @elah/core

Framework-agnostic video timeline engine. No React. No renderer. Just the pure logic layer — project state, playback, frame resolution, and media management.

Used internally by `@elah/react`, `@elah/timeline`, and `@elah/editor`, but can be consumed directly for custom rendering pipelines or headless environments.

React hooks are **not** in this package — they live in [`@elah/react`](https://www.npmjs.com/package/@elah/react), which wraps the stores below for component use.

[![npm](https://img.shields.io/npm/v/@elah/core)](https://www.npmjs.com/package/@elah/core)
[![gzip size](https://img.shields.io/badge/gzip-41%20KiB-brightgreen)](../../BUNDLE_STRATEGY.md)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/elahlabs/elah/blob/main/LICENSE)

---

## Install

```bash
npm install @elah/core
```

**Bundle size:** ~41 KiB gzipped (218 KiB raw, `tsc` ESM output). Core runtime deps: `immer` (~9 KiB gz) + `zustand` (<1 KiB gz). The media toolchain (`mediabunny`) is lazy-imported by the export pipeline and demuxer, so it stays out of the main bundle until you actually decode or export — see [`lazyExport`](./src/export/lazyExport.ts).

---

## What's inside

| Module | Description |
|---|---|
| `TimelineEngine` | Manages project state — tracks, clips, undo/redo |
| `PlaybackEngine` | Frame-accurate playback clock |
| `resolveTimeline` | Pure function — project → active scene at a given frame |
| `GpuRenderer` | WebGL2 renderer for video, image, text, shape, and freehand layers |
| `AudioPlaybackController` | Multi-track audio mixer on the playback clock |
| `tracksStore` | Vanilla Zustand store mirroring project state — bind it with `useTracksStore` from `@elah/react` |
| `playbackStore` | Vanilla Zustand store mirroring playback state — bind it with `usePlaybackStore` from `@elah/react` |
| `selectionStore` | Vanilla Zustand store for clip selection — bind it with `useSelectionStore` from `@elah/react` |
| `transitionsStore` | Vanilla Zustand store mirroring transitions — bind it with `useTransitionsStore` from `@elah/react` |
| `mediaLibraryStore` | Media asset registry (vanilla store) — bind it with `useMediaLibrary` from `@elah/react` |
| `importFiles` / `importUrl` / `importBlob` | Import local files, remote URLs, or blobs into the media library |
| `exportVideo` | Export the timeline to MP4 via a web worker |

These stores are **vanilla** (`zustand/vanilla`) — no React, subscribable from anywhere (`store.getState()`, `store.subscribe()`). They are also **module-level singletons**: one `tracksStore`, one `playbackStore`, etc. per JS realm. `@elah/editor`'s `<EditorProvider>` wires each `TimelineEngine`/`PlaybackEngine` instance it creates into these same shared stores, so only **one active project per page** is supported today — mounting two `<EditorProvider>` (or two manually-wired engines) at once will have them overwrite each other's state in the stores. Multiple independent editors on one page need separate tabs/iframes/windows until scoped stores land.

---

## Quick start

```ts
import { TimelineEngine, PlaybackEngine, resolveTimeline } from '@elah/core'

const engine = new TimelineEngine({ fps: 30, stage: { width: 1920, height: 1080 } })
const playback = new PlaybackEngine({ fps: 30, getTotalFrames: () => engine.getTotalFrames() })

// Add a track, then a clip onto it. addClip takes a single typed
// options object (a discriminated union keyed on `type`) and returns the Clip.
const track = engine.addTrack('video')
engine.addClip({ trackId: track.id, type: 'video', src: 'video.mp4', startFrame: 0, durationFrames: 90 })

// Resolve the scene at frame 15 — pure (frame, project) → Scene.
const scene = resolveTimeline(15, engine.getProject())
```

---

## Clip factories

Standalone builders that return a fully-normalized `Clip` object (rounded frames, default volume/opacity, generated id) without an engine — useful for headless pipelines that feed `resolveTimeline` directly. When you have an engine, prefer `engine.addClip(options)` instead, which builds the clip and records an undo entry.

```ts
import {
  createVideoClip,
  createAudioClip,
  createTextClip,
  createImageClip,
  createShapeClip,
  createFreehandClip,
} from '@elah/core'

const clip = createVideoClip({ trackId: 'v1', src: 'video.mp4', startFrame: 0, durationFrames: 90 })
const rect = createShapeClip({
  trackId: 'el1',
  startFrame: 0,
  durationFrames: 90,
  shape: { shapeKind: 'rect', shapeFill: '#22d3ee' }, // 'rect' | 'circle' | 'triangle'
})

const title = createTextClip({
  trackId: 'el1',
  startFrame: 0,
  durationFrames: 90,
  text: { content: 'Frame accurate' },
  textAnimation: { in: 'slide', out: 'fade', durationFrames: 12, direction: 'up', easing: 'ease-out' },
  animations: [{
    property: 'transform.scale',
    keyframes: [{ frame: 0, value: 0.9 }, { frame: 12, value: 1 }],
  }],
})
```

Text presets (`fade`, `slide`, `pop`, `typewriter`, and looping `pulse`) and
custom property channels are evaluated at integer frames relative to the clip.
`resolveTimeline` emits only the resolved content, opacity, and transform, so
preview, seeking, and export use the same deterministic result.

---

## Export

```ts
import { exportVideo } from '@elah/core'

const blob = await exportVideo(engine.getProject(), {
  videoBitrate: 8_000_000,
  onProgress: ({ frame, totalFrames }) => console.log(frame, '/', totalFrames),
})
```

---

## Links

- [Website](https://www.elah.dev)
- [GitHub](https://github.com/elahlabs/elah)
- [React bindings — @elah/react](https://www.npmjs.com/package/@elah/react)
- [Full SDK — @elah/editor](https://www.npmjs.com/package/@elah/editor)
- [Headless CLI — @elah/cli](https://www.npmjs.com/package/@elah/cli)
- [License](https://github.com/elahlabs/elah/blob/main/LICENSE)
- [Commercial licensing](mailto:paul@elah.dev)
