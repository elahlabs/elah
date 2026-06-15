# @elah/timeline

React timeline UI for the Elah video engine. Renders tracks, clips, ruler, and playhead — and wires up drag, trim, scrub, zoom, and drop gestures into `@elah/core` engine calls.

A consumer of `@elah/core`. Owns no project state — all state lives in the core stores.

[![npm](https://img.shields.io/npm/v/@elah/timeline)](https://www.npmjs.com/package/@elah/timeline)
[![gzip size](https://img.shields.io/badge/gzip-12%20KiB-brightgreen)](../../BUNDLE_STRATEGY.md)
[![license](https://img.shields.io/badge/license-ECL--1.0-blue)](https://github.com/elahlabs/elah/blob/main/LICENSE)

---

## Install

```bash
npm install @elah/timeline @elah/core
```

Peer dependencies: `react`, `react-dom` >= 18.

**Bundle size:** ~12 KiB gzipped (61 KiB raw, `tsc` ESM output). UI layer only — project state lives in `@elah/core`.

---

## Components

| Component | Description |
|---|---|
| `Timeline` | Root surface — tracks, ruler, playhead, gesture wiring |
| `Ruler` | Time ruler — click or drag to scrub |
| `TrackRow` | Single track lane with clip blocks and drop target |
| `ClipBlock` | Individual clip — drag to move, edge-drag to trim |
| `Playhead` | Playhead needle driven by `usePlaybackStore` |

---

## Quick start

```tsx
import { Timeline } from '@elah/timeline'
import { TimelineEngine } from '@elah/core'

const engine = new TimelineEngine({ fps: 30, stage: { width: 1920, height: 1080 } })

function App() {
  return <Timeline engine={engine} style={{ height: 300 }} />
}
```

---

## Hooks

```ts
import { useTracks, usePlayback, useSelection } from '@elah/timeline'

const tracks = useTracks(s => s.tracks)
const { currentFrame, isPlaying } = usePlayback(s => s)
const { selectedClipIds } = useSelection(s => s)
```

---

## Drag & drop

Attach a media drop target to any track lane:

```ts
import { useTimelineDrop } from '@elah/timeline'

const { ref } = useTimelineDrop({ trackId: 'track-1', engine })
```

Dragging a media asset from the library onto the lane resolves drop position to `startFrame` (respects zoom and snap).

---

## Links

- [Website](https://www.elah.dev)
- [GitHub](https://github.com/elahlabs/elah)
- [Full SDK — @elah/editor](https://www.npmjs.com/package/@elah/editor)
- [License](https://github.com/elahlabs/elah/blob/main/LICENSE)
- [Commercial licensing](mailto:contact@elah.dev)
