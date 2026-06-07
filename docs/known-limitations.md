# Known Bugs & Trade-offs

Tracks intentional workarounds, deferred root fixes, and their consequences.
Each entry records what was done, why it was done, and what the real fix is.

---

## KB-001 — fps mismatch: 24fps video on 30fps project skips frame indices

**Status:** Workaround in place  
**Files:** `FrameCache.ts` · `StreamingFrameProducer.ts`

### What happens

`VideoDecoderManager` computes `sourceFrameIdx = Math.round(frame.timestamp / usPerFrame)`
where `usPerFrame = 1_000_000 / project_fps`.

When the video is encoded at a different fps than the project (e.g. 24fps video, 30fps project):

```
Math.round(125000 / 33333) = Math.round(3.75) = 4   → index 3 never written
Math.round(291666 / 33333) = Math.round(8.75) = 9   → index 8 never written
Math.round(458333 / 33333) = Math.round(13.75) = 14 → index 13 never written
```

Pattern: one skipped cache slot every `project_fps / gcd(project_fps, video_fps)` frames.
For 24/30: skips at 3, 8, 13, 18, ... (every 5 project frames, 1 slot missing).

### Workaround

`FrameCache.get(sourceFrame, maxLookback=2)` — if the exact key is absent,
returns the largest cached key ≤ sourceFrame within 2 slots.

Called from `StreamingFrameProducer.getCurrent()` with `maxLookback=2`.

**Effect:** Frames 3, 8, 13 now return the frame stored at index 2, 7, 12 respectively
(the last real video frame before that project-timeline position). This is semantically
correct: a 24fps video on a 30fps timeline should repeat frames at those positions anyway.

**Risk:** `maxLookback=2` is hardcoded. For extreme fps mismatches (e.g. 10fps video on
30fps project) the gap could be wider than 2 and the workaround would silently fail
(cache miss again). Unlikely in practice but not impossible.

### Real fix (deferred)

Thread the container's native fps through the demuxer → VDM → SFP pipeline.
Use `video_fps` for the `timestamp → sourceFrameIdx` math in `VideoDecoderManager.ts:210`,
and translate `project_frame → video_frame` at the VideoLayer boundary.

This gives every decoded frame a unique, correct integer index with no gaps, and makes
the frame-repeat behavior explicit in the translation layer rather than implicit in cache
lookup fallback.

**Prerequisite:** Confirm `MediabunnyDemuxer` exposes the container fps in its config
callback, then pass it as a separate field through `VideoDecoderManager` options.

---

## KB-002 — Transitions freeze through-playing tracks in multi-track compositions

**Status:** Known design constraint of snapshot overlay approach  
**Files:** `TransitionOverlay.tsx` (preview) · export canvas draw loop

### What happens

The WebGL canvas composites all active tracks into one flat image. The snapshot
captured at transition start freezes the entire canvas — including text, image,
and video tracks that are playing continuously through the cut point.

During the transition window:
- Overlay: outgoing clip + all through-playing tracks, frozen, fading away
- Canvas: incoming clip + all through-playing tracks, live, underneath

Through-playing tracks double-image: a frozen ghost on the overlay sits over the
live version on the canvas. Visually broken for any composition with more than
one active track at a transition point.

### Workaround

Enforce transitions only on the primary video track, with no other tracks active
at the cut point — or accept the artifact for simple single-track edits (the
common consumer case).

### Real fix (deferred — V2 / commercial)

Per-track canvas rendering: each track renders to its own `<canvas>` element.
Transitions only affect the relevant track's canvas via CSS. Through-playing
tracks are unaffected. Requires architectural shift from single-compositor WebGL
to per-track 2D canvases fed by the existing ImageBitmap decode pipeline.

**Prerequisite:** Audit export path to confirm per-track canvas draw order can
replicate current zIndex-sorted compositing before committing to the redesign.

---

## KB-003 — No transition scheduler: decode warmup not pre-signalled

**Status:** Known gap, deferred  
**Files:** `resolveTimeline.ts` · `StreamingFrameProducer.ts` · `VideoLayer.ts`

### What happens

The resolver is a pure function called per-frame with no lookahead. It has no
mechanism to signal the decoder that a transition is approaching. The incoming
clip's `VideoFrameProvider` is not marked active until the frame it first appears
in the scene — which is the same frame the transition starts.

On that first frame, `setPlayhead()` is called for the incoming clip for the
first time. The decoder begins from cold: no pre-decoded frames in FrameCache.
The `_holdoverTexture` from VideoLayer patches the outgoing clip side, but the
incoming clip may still show a black flash or delayed first frame if the snapshot
overlay doesn't cover it in time.

### Workaround

The snapshot overlay masks the incoming clip's decode warmup window — the
outgoing clip's frozen frame hides the canvas during the transition start. This
makes the warmup invisible for the fade case. Slide/wipe transitions that reveal
the incoming clip edge-first may still expose a partial black frame.

### Real fix (deferred)

A `TransitionScheduler` that sits between `resolveTimeline()` output and the
overlay renderer:
- Reads `scene.transitions[]` and detects approaching transition windows
- Calls `provider.markActive()` on the incoming clip's provider N frames early
  (N = decode lookahead budget, typically ~10 frames)
- Pre-warms the FrameCache for the incoming clip before the transition starts
- Outputs an enriched `ActiveTransitionDescriptor` with phase and properties
  for the overlay to consume

**Prerequisite:** Expose a `warmup(frameHint: number)` method on
`VideoFrameProvider` so the scheduler can signal intent without forcing a seek.
