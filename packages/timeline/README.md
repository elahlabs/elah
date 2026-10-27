# @elah/timeline

React timeline UI for the Elah video engine. Renders tracks, clips, ruler, and playhead — and wires up drag, trim, scrub, zoom, and drop gestures into `@elah/core` engine calls.

A consumer of `@elah/core`. Owns no project state — all state lives in the core stores.

[![npm](https://img.shields.io/npm/v/@elah/timeline)](https://www.npmjs.com/package/@elah/timeline)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/elahlabs/elah/blob/main/LICENSE)

---

## Install

```bash
npm install @elah/timeline @elah/core @elah/react lucide-react
```

Peer dependencies: `react`, `react-dom` >= 18, `lucide-react` >= 0.400.0 (used directly by
`TrackRow`/`ClipBlock` for clip icons — install it even if nothing else in your app
needs it). Engine/playback context (`EditorContext`, `useTimelineEngine`) comes from
`@elah/react`, a runtime dependency pulled in automatically.

**Bundle size:** UI layer only (project state lives in `@elah/core`); it adds `clsx` and `tailwind-merge`. The 1.0.0 figures are not published yet; [BUNDLE_STRATEGY.md](../../BUNDLE_STRATEGY.md) explains how they are measured.

**Clip types (1.0.0):** the timeline draws every clip type in `@elah/core` — video, audio, text, image, shape, freehand, and the newer adjustment, generator, compound and sequence clips, which appear as labelled blocks. You can move, trim, split, copy and paste them (pasting uses `engine.cloneClip`). There is no editing UI for the newer types here yet.

---

## Components

| Component | Description |
|---|---|
| `Timeline` | The one exported component — tracks, ruler, playhead, gesture wiring. Drag to move, edge-drag to trim, click or drag the ruler to scrub |

The ruler, track rows, clip blocks and playhead are internals of `Timeline`: they are not exported. Restyle them with the `classNames` prop and `--elah-*` variables (below).

---

## Quick start

`Timeline` reads the engine and playback clock from React context — it has no
`engine` prop. Wrap it in an `EditorContext.Provider` from `@elah/react` (or use
`EditorProvider` from `@elah/editor`, which does this for you):

```tsx
import { Timeline } from '@elah/timeline'
import { TimelineEngine, PlaybackEngine } from '@elah/core'
import { EditorContext } from '@elah/react'

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

`EditorContext` supplies the engine pair only — it does **not** wire `engine`
events into the Zustand mirrors the way `<EditorProvider>` does, so a bare
`EditorContext.Provider` like this needs its own `engine.on('change', ...)` →
`tracksStore.sync(...)` wiring (see `@elah/editor`'s `EditorProvider` source) or
the UI won't update. Prefer `EditorProvider` unless you specifically need a
custom store-sync strategy.

The stores `Timeline` reads (`tracksStore`, `playbackStore`, `selectionStore`, ...)
are module-level singletons in `@elah/core` — only one engine's state can be
mirrored into them at a time. Rendering two `<Timeline>` trees backed by two
different engines on the same page will have them fight over the same store; see
[`@elah/core`'s README](https://www.npmjs.com/package/@elah/core) for details.

---

## Styling

Import the compiled stylesheet once (plain CSS — Tailwind is **not** required in
your app, and no utility classes leak into your global scope):

```ts
import '@elah/timeline/styles.css'
import '@elah/editor/styles/tokens.css' // --elah-* defaults (standalone use)
```

`tokens.css` ships in `@elah/editor`, which this package does not depend on: either
`npm install @elah/editor` just for that file, or define the `--elah-*` variables yourself
inside `.elah-root` (see `THEMING.md` in this package).

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
const isPlaying = usePlayback(s => s.isPlaying)
const selectedClipIds = useSelection(s => s.selectedClipIds)
```

These are aliases of `useTracksStore`, `usePlaybackStore` and `useSelectionStore` from `@elah/react`;
keep the selector narrow (`usePlayback(s => s)` re-renders on every frame of playback).
`useTimeline()` returns the `TimelineEngine` from context.

---

## Drag & drop

Attach media drop handlers to any track lane element. `useTimelineDrop(trackId, lane)`
takes the track id and the lane DOM node positionally, and reads the engine from
the `EditorContext` (so it must run inside the provider). It wires the handlers as
a side-effect and returns the lane's drag-over state, `TimelineDropState`:
`'valid'` (compatible drag hovering), `'invalid'` (incompatible kind or locked track)
or `null` (no drag), for highlighting the drop target:

```tsx
import { useState } from 'react'
import { useTimelineDrop } from '@elah/timeline'

function Lane({ trackId }: { trackId: string }) {
  // State, not useRef: the hook needs the node on a render after it mounts.
  const [lane, setLane] = useState<HTMLDivElement | null>(null)
  const dropState = useTimelineDrop(trackId, lane)
  return <div ref={setLane} data-drop={dropState ?? undefined} />
}
```

Dragging a media asset from the library onto the lane resolves drop position to `startFrame` (respects zoom and snap).

### Inserting before the media is probed

`insertMediaAsset(engine, assetId, opts?)` and `insertElement(engine, payload, opts?)` place clips without dragging. For a remote asset
started with core's `beginImportUrl` (which returns a pending asset immediately), insert
the clip with a fallback length, then call `growClipToAssetDuration` once the real
duration is known. It is the companion of `beginImportUrl` for hosts that insert a clip
before its media has been probed:

```ts
import { growClipToAssetDuration } from '@elah/timeline'

// growClipToAssetDuration(engine, clipId, expectedFallbackFrames, newDurationSec)
growClipToAssetDuration(engine, clipId, fallbackFrames, durationSec)
```

It only grows into the gap before the next clip (never creating an overlap) and leaves a
clip alone if the user already trimmed it away from the fallback length.

---

## Zoom and multiple video tracks

The `Timeline` ref exposes `{ engine, playback, fitToWindow, zoomAtAnchor }`.
`zoomAtAnchor(nextZoom)` zooms anchored on the playhead when it is in view, else on the
viewport centre, so a toolbar zoom button or slider never scrolls the playhead away. Use it
instead of a raw `setZoom`.

The timeline renders any number of video tracks; the topmost lane composites on top. Only
clips inside the scrolled viewport (plus a margin) are mounted, so long timelines stay cheap.

---

## Links

- [Website](https://www.elah.dev)
- [GitHub](https://github.com/elahlabs/elah)
- [Full SDK — @elah/editor](https://www.npmjs.com/package/@elah/editor)
- [Headless CLI — @elah/cli](https://www.npmjs.com/package/@elah/cli)
- [License](https://github.com/elahlabs/elah/blob/main/LICENSE)
- [Commercial licensing](mailto:paul@elah.dev)
