# `timeline`

The timeline **UI surface**: the React components and hooks that render tracks,
clips, the ruler, and the playhead, and that turn user gestures into engine
mutations. It is a *consumer* of `core/` — it owns no project state and no
playback clock.

> Layering rule: `@elah/timeline` may import from `@elah/core`, **not** from
> `@elah/editor`. See the `@elah/editor` package's
> [`core/Architecture.md`](../../../editor/src/core/Architecture.md).

---

## Purpose

- Render the editable timeline (tracks, clips, ruler, playhead) from the Ring 1
  Zustand mirrors.
- Translate pointer gestures (drag, trim, split, drop, scrub, zoom) into
  `TimelineEngine` / `PlaybackEngine` calls.
- Expose a small public hook + component API for host apps.

## Components

| Component | Role |
|---|---|
| `Timeline` | The root surface. Renders tracks + ruler + playhead; owns gesture wiring. Forwards a `TimelineRef` exposing `.engine`. |
| `Ruler` | Time ruler; click/drag to scrub (seeks via the playback store). |
| `TrackRow` | One track lane; hosts its clips and the per-lane drop target. |
| `ClipBlock` | A single clip; drag to move, edge-drag to trim, select. |
| `Playhead` | The playhead needle; positioned from `usePlaybackStore.currentFrame`. |
| `TransitionChip` / `TransitionPicker` | Render and edit transitions between clips (rendered by `TrackRow`). |

## Public API

`@elah/timeline` is independently installable and exports these directly — `@elah/editor` merely re-exports the same names for convenience, it does not own them:

```ts
import {
  Timeline, type TimelineProps, type TimelineRef,
  useTimeline,            // engine handle from context
  useTracks, usePlayback, useSelection,  // Ring 1 hooks
  useTimelineDrop,        // attach a media-drop target to a lane
  ELEMENT_DRAG_MIME, type DragElementPayload, type ElementKind,
} from '@elah/timeline'
// or, equivalently, from '@elah/editor' if you're already using the full SDK
```

- `Timeline` must run inside an `EditorContext` provider — either `<EditorProvider>`
  from `@elah/editor`, or a bare `EditorContext.Provider` from `@elah/react` supplying
  `{ engine, playback }`. `useEditor()` throws otherwise. The `fps` prop only sets
  the ruler/scale; the engine and clock always come from context. `ref.current.engine`
  and `ref.current.playback` expose them.
- `useTracks()` / `usePlayback()` / `useSelection()` are the granular React hooks
  over the `core/stores/` mirrors — prefer them over raw store access.

## Drag & drop

- **Media → timeline:** `useTimelineDrop` reads `MEDIA_DRAG_MIME` (from
  `core/assets/`), resolves the dragged asset, and calls `engine.addClip` with
  `assetId` + `src`. Drop X → `startFrame` (respects zoom); snap-to-playhead /
  clip-edges when `usePlaybackStore.snapEnabled`.
- **Element → timeline:** `ELEMENT_DRAG_MIME` + `DragElementPayload` carry a
  to-be-created element kind (e.g. text) for drops from an elements palette.

## Internal flow

```
gesture (drag / trim / drop / scrub)
   → engine.moveClip / trimClip / addClip   |   playbackStore.setCurrentFrame
        → TimelineEngine.commit()            |        → PlaybackEngine.seek()
        → emit('change') → useTracksStore.sync()
        → React selectors fire → ClipBlock / TrackRow re-render
```

Live drag uses `engine.previewClip()` (no history) during the gesture and
`commitInteraction()` on release, so a whole drag folds into one undo entry.

## Dependencies

- `@elah/core`'s `core/stores/` (Ring 1 vanilla mirrors), `core/assets/` (drag
  MIME), `core/utils/` (frame math, snap).
- `@elah/react`'s `useTimelineEngine` (engine access via `EditorContext`) — see
  [`engine-context.ts`](../engine-context.ts).
- React only — no renderer, no decode.

## Current limitations

- No on-canvas resize/rotate gizmos for video/image clips (those live in the
  preview overlay for text only). See
  [`../../../../../CURRENT_LIMITATIONS.md`](../../../../../CURRENT_LIMITATIONS.md).
- No clip thumbnails / filmstrips or audio waveforms on the timeline yet.

## Future direction

Clip thumbnails + waveforms and multi-select gestures. (Transitions have landed —
they render as `TransitionChip`s between adjacent clips, edited via
`TransitionPicker`.)
