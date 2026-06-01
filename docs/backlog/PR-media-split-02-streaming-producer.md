# PR Split-02 — Push-based `StreamingFrameProducer`

> Standalone ticket. Pick this up cold. Read the whole thing top to bottom; the **copy-paste prompt** at the bottom is what you hand to an AI coding agent.
>
> Companion reading (do not skip):
>
> - **Prerequisite (merged):** [PR-media-split-01-structural-move.md](./PR-media-split-01-structural-move.md)
> - Master plan: `.cursor/plans/media-renderer-split-mvp_c1e1a43a.plan.md` (Session 2 section)
> - [`../packages/editor/src/core/renderer/OPTIMIZATION.md`](../packages/editor/src/core/renderer/OPTIMIZATION.md) §1 — wedged bridge symptom + Bug #3 (per-frame flush)
> - [`../packages/editor/src/core/media/video/VideoDecoderManager.ts`](../packages/editor/src/core/media/video/VideoDecoderManager.ts) — current `_decodeFrame` + flush

---

## Status

🔴 Not started.

**Prerequisite:** [PR-media-split-01-structural-move.md](./PR-media-split-01-structural-move.md) merged.

**Next ticket after merge:** [PR-media-split-03-text-layer.md](./PR-media-split-03-text-layer.md)

---

## Goal

Replace the pull-based `DecoderBackedVideoFrameProvider` with a push-based `StreamingFrameProducer`. Simplify `VideoDecoderManager` so the decoder stays warm across contiguous frames (no per-request `flush()`). Trim `VideoLayer.draw()` to call `setPlayhead()` instead of `requestFrame()` + `prefetch()`.

After this PR, steady playback shows `gotFrame=true` on >90% of ticks and video visibly plays in the playground.

---

## Why this matters

Current logs show the classic wedged-bridge pattern:

```
gotFrame=false  pendingCount=4  cacheSize=6  (repeating every tick)
```

Root cause: `_decodeFrame` in `VideoDecoderManager` does demuxer-seek + decoder-reset + decode + **`await flush()` per request**. WebCodecs cannot deliver 30 fps under that pattern. The cache fills with stale indices forever behind the playhead.

The fix is architectural: **push-based forward streaming** driven by playhead position, not per-frame pull requests.

---

## Frozen surfaces (do not touch unless listed in Scope → In)

- `packages/editor/src/core/renderer/gpu/GpuRenderer.ts`
- `packages/editor/src/core/renderer/gpu/RenderGraph.ts`
- `packages/editor/src/core/renderer/gpu/WebGLContext.ts`
- `packages/editor/src/core/renderer/gpu/ShaderProgram.ts`
- `packages/editor/src/core/renderer/gpu/VideoTexture.ts`
- `packages/editor/src/core/renderer/gpu/TexturePool.ts`
- `packages/editor/src/core/resolver/**`

---

## Scope

**In:**

- New: `packages/editor/src/core/media/video/StreamingFrameProducer.ts`
- Rewrite: `packages/editor/src/core/media/video/VideoDecoderManager.ts` (simplified API)
- Update: `packages/editor/src/core/media/video/VideoFrameProvider.ts` (interface change)
- Update: `packages/editor/src/core/media/video/index.ts` (export new producer)
- Trim: `packages/editor/src/core/renderer/gpu/layers/VideoLayer.ts` `draw()` (~10 lines)
- Adapt tests: `VideoDecoderManager.test.ts`, provider tests
- New: `StreamingFrameProducer.test.ts`
- Keep `DecoderBackedVideoFrameProvider.ts` in repo until follow-up delete (or delete in same PR after soak — prefer keeping 24h then delete)

**Out:**

- TextLayer, ImageLayer, audio (Sessions 3–4)
- Resolver / Scene changes
- Feature flag / A-B toggle (hard cutover)
- Tier 1 quick fix (output buffering without full producer rewrite)

---

## Design

### Target data flow

```mermaid
flowchart LR
  VL[VideoLayer.draw] -->|"setPlayhead(N)"| SFP[StreamingFrameProducer]
  VL -->|"getCurrent(N)"| FC[FrameCache]
  SFP --> FC
  SFP --> VDM[VideoDecoderManager]
  VDM --> DMX[MediabunnyDemuxer]
  VDM -->|"onFrame callback"| SFP
```

### New `VideoFrameProvider` interface

```ts
// packages/editor/src/core/media/video/VideoFrameProvider.ts
export interface VideoFrameProvider {
  /** Sync lookup. Borrowed reference — do not close. */
  getCurrent(sourceFrame: number): VideoFrame | null

  /** Tell the producer where the playhead is. Drives forward decode. */
  setPlayhead(sourceFrame: number, opts?: { lookaheadFrames?: number }): void

  markActive(): void
  markIdle(): void
  dispose(): void
}
```

**Removed from interface:** `requestFrame`, `prefetch`, `pendingCount`.

Mock/Synthetic providers used in tests must implement `setPlayhead` (can no-op or pre-fill cache synchronously).

### `StreamingFrameProducer` responsibilities

- Owns `VideoDecoderManager` + `FrameCache`
- On `setPlayhead(N)`:
  - Update pivot via `cache.setPivot(N)`
  - If `|N - lastPlayhead| > 1` → discontinuity: `manager.reset(keyframeUs)`, clear in-flight state, restart from keyframe
  - Maintain target window `[N, N + lookahead]` (default lookahead ~8 frames)
  - Feed demuxer packets until cache covers the window or cache is full
- **No `_pending` set, no `maxOutstanding`** — backpressure is "cache full"
- `getCurrent(N)` → `cache.get(N)` (sync, never awaits)

### Simplified `VideoDecoderManager`

Replace `requestFrame(sourceFrame): Promise<VideoFrame>` + per-call `_decodeFrame` flush with:

```ts
/** Feed packets for a time range. Returns immediately; frames arrive via onFrame. */
feed(timeRangeUs: [number, number]): void

/** Seek demuxer to keyframe + reset/configure decoder. */
reset(toKeyframeUs: number): Promise<void>

/** Called from decoder output callback for each emitted frame. */
onFrame: ((frame: VideoFrame, sourceFrameIdx: number) => void) | null

/** Explicit drain — dispose only. */
drain(): Promise<void>
```

Rules:

- Decoder stays **warm** across contiguous `feed()` calls
- **No `await flush()`** between contiguous feeds
- `reset()` only on discontinuity or dispose
- Map `frame.timestamp` → source frame index: `Math.round(timestamp / usPerFrame)`

### `VideoLayer.draw()` trim

Replace the cache-miss block in `VideoLayer.ts` (currently ~lines 266–275):

```ts
// BEFORE (remove)
} else {
  provider.requestFrame(item.sourceFrame)
  const pendingCount = provider.pendingCount ?? 0
  const maxPrefetch = ...
  if (pendingCount < ...) {
    provider.prefetch(item.sourceFrame + 1, maxPrefetch)
  }
}

// AFTER
provider.setPlayhead(item.sourceFrame)
const frame = provider.getCurrent(item.sourceFrame)
if (frame === null) {
  // keep last texture — no flicker
  ...
}
```

Call `setPlayhead` **before** `getCurrent` so the producer can fill the cache for this tick and upcoming ticks.

### Factory update

`createVideoFrameProvider()` should return `StreamingFrameProducer` when `demuxerFactory` is provided (replacing `DecoderBackedVideoFrameProvider`).

---

## Acceptance criteria

1. `StreamingFrameProducer.ts` exists and implements `VideoFrameProvider`.
2. `VideoDecoderManager` exposes `feed`, `reset`, `onFrame`, `drain` — no per-request flush on contiguous paths.
3. `VideoLayer.draw()` uses `setPlayhead` + `getCurrent`; no `requestFrame` / `prefetch` calls.
4. **Playground:** press Play → video visibly plays at ~30 fps within ~500 ms of clip activation.
5. **`[GPU-TRACE]`:** `gotFrame=true` on >90% of ticks during steady playback (after warm-up).
6. No `VideoFrame was garbage collected without being closed` warnings in DevTools during 30 s playback.
7. **Tests — `StreamingFrameProducer.test.ts`:**
   - 30 contiguous `setPlayhead(N)` → 30 frames in cache within 200 ms (avg latency < 10 ms per frame after warm-up)
   - Backward seek of 60 frames → one demuxer seek, target frame in cache within 200 ms
   - Rapid forward scrub (jumps of 30) → no leaked VideoFrames
8. `GoldenFrameHash.test.ts` still passes (hashes unchanged or updated with documented reason).
9. Full vitest suite green; typecheck clean.

---

## Out of scope

- TextLayer, audio, transitions
- ImageLayer
- Removing `[GPU-TRACE]` logs (optional cleanup in separate PR)
- Multi-track anything

---

## Implementation notes

- Read OPTIMIZATION.md §1 decision tree — your trace logs should move from "wedged" to "steady-state playback."
- `frame.clone()` before `VideoTexture.upload()` must remain — do not regress I10 ownership.
- Discontinuity threshold: `|Δplayhead| > 1` matches existing provider behavior.
- Keep `strictNoOutput: true` in production path.
- Update `MockVideoFrameProvider` / `SyntheticVideoFrameProvider` to implement `setPlayhead` for tests that use them via `VideoLayer`.

---

## Verification

1. **Unit tests:** `npm test -- --run StreamingFrameProducer VideoDecoderManager GoldenFrameHash`
2. **Full suite:** `npm test --workspace=packages/editor`
3. **Manual:** playground Play 30 s, scrub backward 50+ frames, scrub forward. Video should recover after each scrub.
4. **Console filter:** `[GPU-TRACE]` — confirm `gotFrame=true` dominates during play.

---

## Copy-paste prompt for an implementation agent

```
You are implementing a backlog ticket for the @elah/editor repo.

Ticket: docs/backlog/PR-media-split-02-streaming-producer.md
Prerequisite: docs/backlog/PR-media-split-01-structural-move.md MUST be merged first.

Read in this order before writing any code:
1. docs/backlog/PR-media-split-02-streaming-producer.md (this ticket — top to bottom)
2. packages/editor/src/core/renderer/OPTIMIZATION.md §1 (wedged bridge + Bug #3)
3. packages/editor/src/core/media/video/VideoDecoderManager.ts — current _decodeFrame + flush
4. packages/editor/src/core/renderer/gpu/layers/VideoLayer.ts — draw() cache-miss path

Then implement the push-based StreamingFrameProducer and simplified VideoDecoderManager.

Hard constraints:
- Hard cutover — no feature flag. createVideoFrameProvider returns StreamingFrameProducer when demuxerFactory is set.
- VideoFrameProvider interface: getCurrent, setPlayhead, markActive, markIdle, dispose ONLY.
- No per-request flush on contiguous decode paths.
- VideoLayer.draw: setPlayhead before getCurrent; remove requestFrame/prefetch.
- Do NOT touch resolver, GpuRenderer compositing core, or add TextLayer/audio.
- frame.clone() before upload must remain.

Walk the ticket's "Acceptance criteria" section item by item before declaring done.
Run typecheck and full test suite; both must pass. Manually verify playground playback.

If you find a reason to go outside scope, stop and surface the question.
```
