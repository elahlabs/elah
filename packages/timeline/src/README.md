# `timeline`

`@elah/timeline` 1.0.0, released in lockstep with `@elah/core`, `@elah/react` and
`@elah/editor`. Its exported API (`index.ts`) follows semver; anything not exported from
`index.ts` is internal and free to change.

The timeline **UI surface**: the React components and hooks that render tracks,
clips, the ruler, and the playhead, and that turn user gestures into engine
mutations. It is a *consumer* of `core/` — it owns no project state and no
playback clock.

> Layering rule: `@elah/timeline` may import from `@elah/core`, **not** from
> `@elah/editor`, and it does not import the `@elah/core/spec`, `/html`, `/ops` or `/icons`
> subpath entries. See the `@elah/editor` package's
> [`core/Architecture.md`](../../editor/src/core/Architecture.md).

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
| `ClipBlock` | A single clip; drag to move, edge-drag to trim, select. Draws a filmstrip (video/image) or waveform (audio) from the asset, and a labelled block for adjustment, generator, compound and sequence clips. Mounts `KeyframeLane` while selected. |
| `KeyframeLane` | Keyframe diamonds along the bottom edge of the selected clip: click to select + seek, drag to retime, Shift+click to multi-select. Exported. |
| `Playhead` | The playhead needle; positioned from `usePlaybackStore.currentFrame`. |
| `TransitionChip` / `TransitionPicker` | Render and edit transitions between clips (rendered by `TrackRow`). |
| `AudioDropDialog` | Modal asking how to place a dropped video that carries audio; mounted once inside `Timeline`, driven by `audioDropDialog.store`. |

### File map (non-component modules)

| File | Role |
|---|---|
| `keySelection.store.ts` | `useKeySelectionStore` (`clipId`, `frames`, `select` / `toggle` / `shift` / `clear`) and `keysOf(clipId)`. Exported. |
| `insertAsset.ts` | `insertMediaAsset`, `insertElement`, `growClipToAssetDuration`: the placement path behind drops and gesture-free inserts. Exported. |
| `useTimelineDrop.ts` | Lane drop target; resolves the payload and calls `insertAsset`. |
| `elementDrag.ts` | `ELEMENT_DRAG_MIME`, `DragElementPayload`. |
| `visible-window.ts` | Horizontal clip virtualisation window for `TrackRow`. |
| `zoomAnchor.ts`, `contentWidth.ts`, `trackCompat.ts` | Zoom-anchor, content-width and track-compatibility helpers, kept as re-exports from `@elah/core` so internal import sites stay put. |
| `classNames.ts`, `cn.ts`, `clipSlot.ts`, `theme.ts` | The `classNames` slot API, class merging, and the deprecated `timelineTheme` facade. |

## Public API

`@elah/timeline` is independently installable and exports these directly — `@elah/editor` merely re-exports the same names for convenience, it does not own them:

```ts
import {
  Timeline, type TimelineProps, type TimelineRef,
  useTimeline,            // engine handle from context
  useTracks, usePlayback, useSelection,  // Ring 1 hooks
  useTimelineDrop,        // attach a media-drop target to a lane
  insertMediaAsset, insertElement, growClipToAssetDuration,  // place clips without a drag
  KeyframeLane, KEYFRAME_LANE_HEIGHT, type KeyframeLaneProps,
  useKeySelectionStore, keysOf, type KeySelectionState,      // key selection
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
- `useKeySelectionStore` is the only store this package owns. It is separate from the
  clip selection and scoped to one clip: selecting a key in another clip replaces the
  selection, and a module-level subscription to `useSelectionStore` (`@elah/react`) clears
  it when its clip is deselected. `keysOf(clipId)` is a non-reactive read.

## Drag & drop

- **Media → timeline:** `useTimelineDrop` reads `MEDIA_DRAG_MIME` (from
  `core/assets/`), resolves the dragged asset, and places it through
  `insertMediaAsset` (which calls `engine.addClip`). Drop X → `startFrame` (respects
  zoom); snap-to-playhead / clip-edges when `usePlaybackStore.snapEnabled`.
- **Element → timeline:** `ELEMENT_DRAG_MIME` + `DragElementPayload` carry a
  to-be-created element kind (e.g. text) for drops from an elements palette; the drop
  goes through `insertElement`.

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

Keyframe drags follow the same shape inside `KeyframeLane`:

```
pointerdown on a diamond  -> useKeySelectionStore.select / toggle  (stopPropagation: no clip drag)
pointermove               -> moveKeysAtFrames(gestureStartClip, frames, delta) -> engine.previewClip()
pointerup                 -> engine.commitInteraction('Move keyframes') -> keySelection.shift(delta)
Esc / pointercancel       -> engine.cancelInteraction()
click without travel      -> playbackStore.setCurrentFrame(clip.startFrame + frame)
```

Invariants: `Keyframe.frame` is clip-relative, so the lane renders inside `ClipBlock` and rides
its transform during a clip drag or trim; every preview is computed against the clip as it was
at gesture start, not the previewed one; the moving set is resolved once at pointerdown; a
lone key stops one frame short of its neighbours (`keyDragRange`) while a selected set is
bounded only by the clip.

## Dependencies

- `@elah/core`'s `core/stores/` (Ring 1 vanilla mirrors), `core/assets/` (drag
  MIME), `core/utils/` (frame math, snap).
- `@elah/core`'s keyframe helpers (`keyFrameUnion`, `keySnapFrames`, `keyDragRange`,
  `moveKeysAtFrames`, `channelKeys`, `keyFrameSwatches`) for `KeyframeLane`.
- `@elah/react`'s `useTimelineEngine` (engine access via `EditorContext`) and its
  store hooks — see [`engine-context.ts`](./engine-context.ts).
- Runtime deps `clsx` and `tailwind-merge`; peers `react`, `react-dom`, `lucide-react`.
- React only — no renderer, no decode.

## Current limitations

- No on-canvas resize/rotate gizmos for video/image clips (those live in the
  preview overlay for text only). See
  [`CURRENT_LIMITATIONS.md`](../../../CURRENT_LIMITATIONS.md).
- No editing UI for adjustment, generator, compound and sequence clips: the timeline
  draws, moves, trims, splits and pastes them (as labelled blocks, on `elements` lanes),
  but `@elah/editor` has no inspector for them.
- The keyframe lane itself has no key deletion or per-key value editing, and clustered keys
  at a far zoom cannot be dragged until you zoom in.
- Clip selection is single-click; only keys have a Shift+click multi-select.

## Future direction

Multi-select gestures for clips. (Transitions have landed — they render as
`TransitionChip`s between adjacent clips, edited via `TransitionPicker`. So have clip
filmstrips and waveforms, and the keyframe lane.)
