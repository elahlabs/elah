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

## KB-002 — (template)

**Status:**  
**Files:**

### What happens

### Workaround

### Real fix (deferred)
