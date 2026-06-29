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

`Timeline` reads the engine and playback clock from React context — it has no
`engine` prop. Wrap it in an `EditorContext.Provider` (or use `EditorProvider`
from `@elah/editor`, which does this for you):

```tsx
import { Timeline } from '@elah/timeline'
import { TimelineEngine, PlaybackEngine, EditorContext } from '@elah/core'

const engine = new TimelineEngine({ fps: 30, stage: { width: 1920, height: 1080 } })
const playback = new PlaybackEngine({ fps: 30, getTotalFrames: () => engine.getTotalFrames() })

function App() {
  return (
    <EditorContext.Provider value={{ engine, playback }}>
      <Timeline fps={30} style={{ height: 300 }} />
    </EditorContext.Provider>
  )
}
```

---

## Styling

Import the compiled stylesheet once (plain CSS — Tailwind is **not** required in
your app, and no utility classes leak into your global scope):

```ts
import '@elah/timeline/styles.css'
import '@elah/editor/styles/tokens.css' // --elah-* defaults (standalone use)
```

Colors are driven by `--elah-*` CSS variables. Re-theme by overriding them in your
own `.elah-root` scope — see [design-tokens.md](https://github.com/elahlabs/elah/blob/main/docs/design-tokens.md).

### Per-instance overrides — `classNames`

For one-off styling on a specific timeline, pass `classNames` — a per-slot map of
Tailwind classes. Whatever you pass wins over the built-in classes (`tailwind-merge`).

```tsx
<Timeline
  classNames={{
    root:       'rounded-xl',
    ruler:      'bg-zinc-900',
    rulerTick:  'bg-zinc-700',
    rulerLabel: 'text-zinc-500',
    trackLabel: 'bg-zinc-900',
    lane:       'bg-zinc-950',
    clip:       'rounded-lg shadow-lg',   // shape/shadow (all clip types)
    // per-type clip color — body + accent are separate slots:
    clipVideo:       'from-sky-400 to-sky-600',  // body (gradient or solid bg-*)
    clipVideoAccent: 'text-sky-300',              // stripe + selection + track bar
    playhead:   'text-rose-500',
  }}
/>
```

Conventions:

- **Backgrounds** (ruler, lane, label, clip bodies) take `bg-*` or gradient
  stops (`from-… to-…`; the gradient direction is added for you).
- **Accents** (playhead, clip stripe/selection, track-label bar) paint from
  `currentColor`, so recolor them with a **`text-*`** class.

Slots: `root`, `ruler`, `rulerTick`, `rulerLabel`, `track`, `trackLabel`, `lane`,
`clip`, `clip{Video,Audio,Text,Image}`, `clip{Video,Audio,Text,Image}Accent`,
`playhead`. See the `TimelineClassNames` type for the full list.

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

Attach media drop handlers to any track lane element. `useTimelineDrop(trackId, lane)`
takes the track id and the lane DOM node positionally, and reads the engine from
the `EditorContext` (so it must run inside the provider). It wires the handlers as
a side-effect and returns nothing:

```tsx
import { useRef } from 'react'
import { useTimelineDrop } from '@elah/timeline'

function Lane({ trackId }: { trackId: string }) {
  const laneRef = useRef<HTMLDivElement>(null)
  useTimelineDrop(trackId, laneRef.current)
  return <div ref={laneRef} />
}
```

Dragging a media asset from the library onto the lane resolves drop position to `startFrame` (respects zoom and snap).

---

## Links

- [Website](https://www.elah.dev)
- [GitHub](https://github.com/elahlabs/elah)
- [Full SDK — @elah/editor](https://www.npmjs.com/package/@elah/editor)
- [License](https://github.com/elahlabs/elah/blob/main/LICENSE)
- [Commercial licensing](mailto:contact@elah.dev)
