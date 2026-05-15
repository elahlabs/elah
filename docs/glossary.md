# Glossary

> Terms used throughout the codebase, in one place. If a term shows up in code and isn't here, add it.

---

### Active clip

A clip that is "playing" at the current frame. Output of `resolveTimeline`. Comes in four flavors: `ActiveVideoClip`, `ActiveAudioClip`, `ActiveTextClip`, `ActiveImageClip`. See [`packages/timeline/src/core/resolver/scene.ts`](../packages/timeline/src/core/resolver/scene.ts).

### Asset

A piece of media (video file, audio file, image) imported into the editor. Lives in `MediaLibrary` (planned, PR-04). Distinct from a **clip**: a single asset can be used by many clips. Modeled as `MediaAsset`.

### `assetId`

The reference from a `Clip` to its source `MediaAsset` in the library. Planned for PR-04. Today clips use a free-floating `src: string` URL.

### Batch

A `TimelineEngine.batch(recipe, description?)` transaction that groups multiple mutations into a single undo entry. Nested batches collapse into the outermost.

### Clip

A single placed media segment on a track. Has `startFrame`, `durationFrames`, `sourceStartFrame`, `sourceDurationFrames`. Distinct from an **asset** (the underlying file). See [`packages/timeline/src/types/index.ts`](../packages/timeline/src/types/index.ts).

### Commit

`TimelineEngine.commit(recipe, description)` — the one function through which every mutation passes. Applies Immer, records history, fires `'change'` and `'history:change'` events.

### `currentFrame`

The playhead position, in integer frames. Owned by `PlaybackEngine`; mirrored into `usePlaybackStore.currentFrame` for React.

### `currentFrameEpoch`

A monotonically increasing counter in `usePlaybackStore` that bumps on every explicit `setCurrentFrame` call. Used by subscribers (e.g. the playhead DOM writer) to detect scrub events even when the frame number is unchanged. After PR-02 of the engine fixes, this no longer bumps on every RAF tick — only on user-driven scrubs.

### Echo guard

The check `state.currentFrame !== playback.currentFrame` in the store→engine subscription that prevents an infinite loop between the two playback state mirrors. See [`packages/timeline/src/ui/Timeline.tsx`](../packages/timeline/src/ui/Timeline.tsx).

### Engine

Shorthand for `TimelineEngine` — the framework-agnostic class that owns the `Project` and is the only legal source of mutations.

### Frame

The unit of time. Always an integer. `frame = seconds × fps`. The engine never uses floating-point seconds internally.

### Frame accumulator

Sub-integer fractional frames accumulated between RAF ticks in `PlaybackEngine`, so that elapsed time × fps doesn't drift due to integer truncation.

### MediaLibrary

The store of imported media `MediaAsset`s. Planned for PR-04. One asset → many clips.

### Project

The whole timeline document: `fps`, `stage`, `tracks`, `clips`. Immutable; replaced wholesale on every commit.

### `resolveTimeline`

The pure function `(frame, project) → Scene`. The single bridge between data and rendering. See [`packages/timeline/src/core/resolver/resolveTimeline.ts`](../packages/timeline/src/core/resolver/resolveTimeline.ts).

### Renderer

Anything that consumes a `Scene` and produces pixels (or audio). Implements the `Renderer` interface from PR-06: `mount(container)`, `render(scene)`, `dispose()`.

### Ring (R0 / R1 / R2)

The three layers of state in the codebase. See [`ARCHITECTURE.md` § 2](../ARCHITECTURE.md#2-the-three-ring-state-model).

- **R0** — Engine state. Immutable. Class-owned. Source of truth.
- **R1** — Reactive mirror. Zustand stores synced from R0.
- **R2** — UI/transient state. Selection, drag handles, etc.

### Scene

The output of `resolveTimeline`. A plain-data object listing every active clip at a given frame, with `sourceFrame`, `opacity`, `zIndex`. Renderers consume only this.

### Solo

A track flag that, when enabled on any track of a given kind, excludes all other tracks of that kind from the resolved scene. Image clips piggyback on video solo.

### Source frame

The frame inside the **source asset** (the original media file) that corresponds to the current timeline frame for an active clip. Computed by the resolver: `sourceFrame = (currentFrame - clip.startFrame) + clip.sourceStartFrame`. This is the value a renderer hands to `<video>.currentTime / fps`.

### `sourceStartFrame` / `sourceDurationFrames`

The trim window into the source asset. `sourceStartFrame` is the first frame of the source that this clip uses; `sourceDurationFrames` is the *total length of the source asset* (used as an upper bound when extending the trim). The clip's actual playing range is `[sourceStartFrame, sourceStartFrame + durationFrames)`.

### Stage

The output composition canvas — width × height. Planned for PR-03 as `Project.stage`. Default `{ width: 1080, height: 1920 }` (portrait 9:16).

### Subscriber storm

Pathological behavior where one state change triggers many downstream re-renders that re-trigger the original change, etc. Avoided in this codebase by (a) the echo guard, (b) only calling `setCurrentFrame` when the frame actually changed, (c) Ring 0 → Ring 1 sync at engine-event granularity, not per-state.

### Timeline

Two meanings, both used:
1. The `<Timeline />` React component — the UI surface.
2. The conceptual data structure (tracks + clips ordered in time). Often called "the timeline" colloquially; pedantically that's the `Project`.

### Track

A horizontal lane in the timeline. Has a `kind` (`video` | `audio` | `text`) and an `order` (0 = topmost in UI). Holds clips. See [`packages/timeline/src/types/index.ts`](../packages/timeline/src/types/index.ts).

### Transform

The position/scale/rotation/anchor of a clip on the stage. Stored as normalized `0..1` coordinates so it's resolution-independent. Planned for PR-03 as `Clip.transform?`.

### Transition

A descriptor for a crossfade / cut / wipe between adjacent clips. Reserved as `Scene.transitions: SceneTransition[]` but not yet implemented.

### Visitor

A pure function that takes an Immer `Draft<Project>` and applies a single mutation type: `addClip`, `removeClip`, `updateClip`, `splitClip`, `cloneClip`, `removeTrack`, `updateTrack`. Called by `TimelineEngine` inside `commit`. See [`packages/timeline/src/core/visitor/`](../packages/timeline/src/core/visitor/).

### Zustand mirror

A Ring 1 store (`useTracksStore`, `usePlaybackStore`) that mirrors engine state for React consumption. Updated by `sync()` calls fired from engine events. Never the source of truth.

### z-index

In the resolver: `(maxOrder - track.order) * 1000`. Higher zIndex = closer to viewer = renders on top. The `* 1000` reserves space for sub-layer offsets (e.g. text +100 above its track).
