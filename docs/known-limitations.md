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

**Status:** Resolved in 1.0.0 for the WebGL2 path; still true for export's 2D fallback  
**Files:** `renderer/gpu/transitions.ts` · `export/ExportWorker.ts` (2D fallback)

### What happened (0.6.0 and earlier)

Preview used a snapshot overlay (`TransitionOverlay`): a frozen copy of the whole
canvas faded away over the live one, so every track that kept playing through the
cut (text, images, a second video lane) double-imaged under its own frozen ghost.

### What happens now

The converged renderer composites the outgoing and incoming clips with one
transition shader, each already drawn with its own effects, transform and blend
into its own target. Nothing is snapshotted, both clips keep playing, and tracks
that play straight through the cut are not touched. `<Preview>` no longer drives
`TransitionOverlay`; the file `packages/editor/src/editor/Preview/TransitionOverlay.tsx`
is unused and still in the tree.

### What is left

Export without WebGL2 in its worker falls back to the old 2D snapshot of the
outgoing clip, which freezes the outgoing frame and draws only fade, wipe and a
left-or-right slide. A project that uses any other transition kind (and any effect,
mask, matte, adjustment clip or 3D tilt) is routed to the GPU path first, and its
export fails fast when the worker cannot create a WebGL2 context.

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
incoming clip may still show a black flash or delayed first frame while its decoder
warms up.

### Workaround

Partly mitigated: `<Preview>` resolves a scene a short horizon ahead and calls
`GpuRenderer.prewarm`, so upcoming video clips open and fill their lookahead before they
become visible. That is a general look-ahead, not a transition-aware scheduler.

Since 1.0.0 no frozen snapshot covers the warmup window: the outgoing clip plays
live under the transition, so a cold incoming decoder can show through, most
visibly on transitions that reveal the incoming clip edge-first (slide, wipe,
whip). The look-ahead above is the only mitigation.

### Real fix (deferred)

A `TransitionScheduler` that sits between `resolveTimeline()` output and the
renderer:
- Reads `scene.transitions[]` and detects approaching transition windows
- Calls `provider.markActive()` on the incoming clip's provider N frames early
  (N = decode lookahead budget, typically ~10 frames)
- Pre-warms the FrameCache for the incoming clip before the transition starts
- Outputs an enriched `ActiveTransitionDescriptor` with phase and properties
  for the renderer to consume

**Prerequisite:** Expose a `warmup(frameHint: number)` method on
`VideoFrameProvider` so the scheduler can signal intent without forcing a seek.


### Perf: main-thread jank during export
The preview RAF loop (`Preview.tsx`) runs full-tilt while an export is in progress — `resolveTimeline` + WebGL render + transition snapshotting every frame competing with the export worker's `postMessage` deserialization. Also: `ShaderProgram.create` calls `getShaderParameter(COMPILE_STATUS)` and `getProgramParameter(LINK_STATUS)` synchronously inside `acquire()`, which forces a GPU driver flush (observed as a 144 ms `getShaderParameter` stall when the first video/image/text clip enters the scene mid-playback). Both contribute to dropped frames and sluggish UI during export. `AudioPlaybackController` also continues running during export since it drives itself off the playback clock independently of the RAF loop.

Root-cause diagnosis (from Chrome DevTools trace): the longest task (163 ms `RunTask` under `requestAnimationFrame`) traces as `tick → render → execute → acquire → _ensurePipeline → ShaderProgram.create → compileShader → getShaderParameter (144 ms)`. The forced-reflow warning in the same trace is mostly browser-extension noise (McAfee WebAdvisor, React DevTools) rather than app code — but `Playhead.tsx` writing `style.left` every frame does dirty layout, making those extension reads expensive.

Planned fixes (scoped, low-risk — implement post-V1):
- Warm every layer's shader pipeline once at `GpuRenderer.mount()` via a `Layer.warmup?(gl)` hook so `acquire()` never blocks. Pair with `KHR_parallel_shader_compile` in `ShaderProgram` to make the deferred status check non-blocking.
- Gate the Preview RAF loop (`if (isExporting) return`) using an `isExporting` flag in `playback.store`; flip it in `exportVideo()` around the audio mix + worker lifetime.
- Switch `Playhead` needle from `style.left` to `style.transform = translateX(…)` (composite-only, never invalidates layout); cache `getBoundingClientRect()` once per drag gesture rather than on every `mousemove`.

⚠️ A prior attempt at these fixes introduced a black-frame regression at clip boundaries (the `_validated` flag in the deferred ShaderProgram path caused `gl.useProgram` to bind an unvalidated program on the first tick, breaking the holdover-texture fallback) and left audio playing during export (AudioPlaybackController is decoupled from the RAF gate). Both need to be addressed together before shipping the perf fix.
