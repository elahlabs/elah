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
`@elah/react`, a runtime dependency pulled in automatically (`@elah/timeline` depends on
`@elah/core@^1.0.0` and `@elah/react@^1.0.0`).

**Version and stability:** 1.0.0. The exported API follows semver, and `@elah/timeline` is
released in lockstep with `@elah/core`, `@elah/react` and `@elah/editor` (all 1.0.0), so keep
the four on the same version. The AI-facing `@elah/core` entries (`@elah/core/spec`, `/html`,
`/ops`, `/icons`) are live in 1.0 and follow semver too; they sit off the `@elah/core` root only so
the root stays small. This package does not import them. See the Stability section of
[CHANGELOG.md](../../CHANGELOG.md).

**Bundle size:** UI layer only (project state lives in `@elah/core`); it adds `clsx` and
`tailwind-merge`. Measured at 1.0.0 with `node scripts/measure-bundle.mjs` (esbuild, minified,
gzipped; `react`, `react-dom`, `lucide-react` and `mediabunny` external):

| App imports | gz |
|---|---|
| Editor app: `EditorProvider`, `Preview`, `Timeline` from `@elah/editor` | 112.0 KiB |
| `@elah/core` engine only (`TimelineEngine`, `resolveTimeline`) | 44.7 KiB |
| `@elah/core` engine + `GpuRenderer` + `exportVideo` | 75.0 KiB |
| `@elah/timeline` barrel with every export kept, plus `clsx` and `tailwind-merge` | 21.6 KiB (14.9 KiB own code) |

The first three are what a real app pays at startup; the last is a worst case no app reaches.
Optional renderer features (effects, generators, sequence clips, roto masks, audio Enhance) load
on first use and are not in those numbers. [BUNDLE_STRATEGY.md](../../BUNDLE_STRATEGY.md)
explains the method and what each row includes.

**Clip types (1.0.0):** the timeline draws every clip type in `@elah/core` — video, audio, text, image, shape, freehand, and the newer adjustment, generator, compound and sequence clips, which appear as labelled blocks. You can move, trim, split, copy and paste them (pasting uses `engine.cloneClip`). A selected clip of any type shows its keyframes in a [keyframe lane](#keyframe-lane). `@elah/editor` still has no editing UI for the newer clip types (no inspector, curve editor, effect stack or compound editor): drive them through the engine, ops or VideoSpec. See [CURRENT_LIMITATIONS.md](../../CURRENT_LIMITATIONS.md).

---

## Components

| Component | Description |
|---|---|
| `Timeline` | The main component — tracks, ruler, playhead, gesture wiring. Drag to move, edge-drag to trim, click or drag the ruler to scrub |
| `KeyframeLane` | The keyframe diamonds along the bottom edge of a selected clip. `Timeline` mounts it for you; see [Keyframe lane](#keyframe-lane) |

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

## Keyframe lane

A selected clip shows its keyframes as diamonds on its bottom edge. This is the open-source
editor's visual keyframe editing; `Timeline` renders it inside the selected `ClipBlock`, so
there is nothing to wire up.

- **Click** a diamond to select it and seek the playhead to it.
- **Drag** to retime it. The grabbed key snaps to the other keys, the clip's first and last
  frame and the playhead when `playbackStore.snapEnabled` is on. The whole drag commits as one
  undo step (`Move keyframes`); **Esc** cancels it.
- **Shift+click** adds a diamond to the selection or takes it out. Dragging a selected diamond
  moves every selected key by the same amount. A plain click on a key that is not selected
  selects it alone.
- A hold keyframe draws as a square; a key a left trim pushed outside the clip draws dimmed at
  the clip edge and cannot be dragged; at a far zoom, keys closer than a few pixels fold into
  one cluster marker (click seeks to its first key, it is not draggable until you zoom in).
- On a locked track you can still select and seek, but not move.

`KeyframeLane` is exported for hosts that lay out their own clip UI. It needs the
`EditorContext` provider and an absolutely positioned parent (it fills the parent's bottom
`KEYFRAME_LANE_HEIGHT` pixels, 14).

```ts
import { KeyframeLane, KEYFRAME_LANE_HEIGHT, type KeyframeLaneProps } from '@elah/timeline'
```

| Prop | Type | Meaning |
|---|---|---|
| `clip` | `Clip` | The clip whose keys to draw. `Keyframe.frame` is clip-relative, so `left = frame * zoom` |
| `zoom` | `number` | Pixels per frame |
| `locked` | `boolean` (optional) | Navigate but do not edit |
| `channels` | `ReadonlyArray<AnyKeyframeChannel>` (optional) | Show only these channels' keys. Omitted, the lane shows the union of every channel the clip keys on |

Which keys are selected lives in `useKeySelectionStore`, a zustand store separate from the clip
selection (`useSelectionStore`). It holds one clip's keys at a time: selecting a key in another
clip replaces the selection, and deselecting the clip clears it.

```ts
import { useKeySelectionStore, keysOf } from '@elah/timeline'

const clipId = useKeySelectionStore(s => s.clipId)       // clip the selected keys belong to, or null
const frames = useKeySelectionStore(s => s.frames)       // ReadonlySet<number> of clip-relative frames
useKeySelectionStore.getState().select(clipId, [12, 30]) // also: toggle, shift(delta), clear
keysOf(clipId)                                           // non-reactive read: the set for that clip, else empty
```

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
`useTimeline()` returns the `TimelineEngine` from context. `useKeySelectionStore` (see
[Keyframe lane](#keyframe-lane)) is the one store this package owns.

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
