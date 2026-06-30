# @elah/core

Framework-agnostic video timeline engine. No React. No renderer. Just the pure logic layer — project state, playback, frame resolution, and media management.

Used internally by `@elah/timeline` and `@elah/editor`, but can be consumed directly for custom rendering pipelines or headless environments.

[![npm](https://img.shields.io/npm/v/@elah/core)](https://www.npmjs.com/package/@elah/core)
[![gzip size](https://img.shields.io/badge/gzip-41%20KiB-brightgreen)](../../BUNDLE_STRATEGY.md)
[![license](https://img.shields.io/badge/license-ECL--1.0-blue)](https://github.com/elahlabs/elah/blob/main/LICENSE)

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
| `GpuRenderer` | WebGL2 renderer for video, image, and text layers |
| `useTracksStore` | Zustand mirror of project state for React |
| `usePlaybackStore` | Zustand mirror of playback state for React |
| `useSelectionStore` | Zustand mirror of selection state for React |
| `useMediaLibrary` | Media asset library with thumbnail generation |
| `importFiles` | Import local files into the media library |
| `exportVideo` | Export the timeline to MP4 via a web worker |

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
import { createVideoClip, createAudioClip, createTextClip, createImageClip } from '@elah/core'

const clip = createVideoClip({ trackId: 'v1', src: 'video.mp4', startFrame: 0, durationFrames: 90 })
```

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
- [Full SDK — @elah/editor](https://www.npmjs.com/package/@elah/editor)
- [License](https://github.com/elahlabs/elah/blob/main/LICENSE)
- [Commercial licensing](mailto:contact@elah.dev)
