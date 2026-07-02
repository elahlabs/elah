# Performance

> The performance _philosophy_ and the concrete techniques the codebase actually
> uses. We do not publish benchmark numbers here — none have been measured under
> controlled conditions, and inventing them would be worse than omitting them.

---

## Philosophy

- **Browser-native, minimal WASM.** Decode is WebCodecs, compositing is WebGL2,
  audio is Web Audio, muxing is mediabunny. The core ships no heavy WASM runtime.
- **Deterministic over clever.** The same `(project, frame)` always resolves to
  the same `Scene` and the same pixels. Determinism is what makes export
  reproducible and tests meaningful; we don't trade it for speculative speedups.
- **Do nothing per frame that can be done once.** The hot path (RAF tick →
  resolve → render) is built around cheap diffs and reference equality.
- **Keep the bundle lean.** Performance includes load time. See
  [`BUNDLE_STRATEGY.md`](./BUNDLE_STRATEGY.md).

---

## Techniques in the code today

### Engine & resolver

- **Integer-frame time model.** All time is integer frames; seconds appear only
  where a media element is seeked. No floating-point drift to reconcile.
- **Structural sharing for history.** `TimelineEngine` mutates via Immer, so undo
  history stores `O(diff)` not `O(project)` — unchanged subtrees are shared by
  reference.
- **Pure resolver.** `resolveTimeline` allocates a flat `Scene` and sorts small
  per-kind arrays by `zIndex`. No DOM, no async, safe to run in a worker.

### Playback clock

- **Anchor-and-integrate.** Position is two scalars (`anchorFrame`,
  `anchorTime`); there is no internal counter accumulating drift.
- **Notify on integer-frame advance only.** A 60 Hz display running a 30 fps
  timeline notifies subscribers ~30×/s, not 60 — no notify storms.
- **Throttled time-update channel.** UI labels subscribe at ~10 Hz instead of
  every frame.

### Renderer

- **Scene reference-equality short-circuit.** `render(scene)` is a no-op when
  `scene === lastScene`, so idle frames cost nothing.
- **Synchronous render tick.** `render()` never awaits; decode/upload happen
  out-of-band. A missed frame draws the last uploaded texture (no flicker, no
  stall inside the tick).
- **Pooled GPU memory.** `TexturePool` is an LRU allocator (default cap 16) keyed
  by texture dimensions/format; textures are reused, not reallocated per clip.
- **One shared quad pipeline.** Video, image, and text layers reuse the same
  `gl_VertexID`-based quad shader (no per-draw VBO) and composite by a single
  global `zIndex` sort.

### Decode pipeline

- **Copy-and-close frame ownership.** Each decoded `VideoFrame` is copied to an
  `ImageBitmap` and closed immediately, returning its slot in the decoder's
  ~16-slot output pool. The cache then holds plain memory, so it can be sized for
  smoothness instead of being bounded by the pool. This is what stopped the
  "freeze after ~16 frames" class of bug
  (`renderer/architecture.md` § 6.5).
- **Push-based lookahead with hysteresis.** The producer feeds the decoder in
  bursts up to a high-water line and waits until the buffer drains past a
  low-water line before the next burst, keeping frames flowing without
  re-feeding packet ranges.
- **Warm decoder across contiguous playback.** No per-frame `flush()`; the
  decoder stays configured while the playhead advances contiguously.
- **Context-loss survivable cache.** Cached frames are `VideoFrame`/`ImageBitmap`
  (plain memory), not GL textures, so a GPU context loss re-uploads from cache
  without re-decoding.

### Export

- **Off the main thread.** Frame rendering and muxing run in a module worker on
  an `OffscreenCanvas`; the UI thread stays responsive.
- **Encoder backpressure respected.** Audio PCM is encoded in ~1-second chunks
  and `await source.add()` applies backpressure instead of buffering the whole
  timeline at once.

---

## Known costs & bottlenecks

These are the places where the current design pays a price — useful to know
before optimizing the wrong thing.

- **Backward seeks are expensive.** A discontinuity cold-starts the decoder from a
  keyframe (see [`CURRENT_LIMITATIONS.md`](./CURRENT_LIMITATIONS.md)).
- **Decode runs on the main thread (off-tick).** It uses `VideoDecoder.output`
  callbacks and microtasks, not a worker. Long GOPs or high resolutions compete
  with the UI for main-thread time.
- **Audio export mixes on the main thread.** `OfflineAudioContext` whole-file
  decode per clip is the current model; long/complex audio timelines are the
  stress case.
- **No cross-clip decode scheduling.** Each provider decodes independently with no
  global priority — the gap the planned scheduler is meant to close.

---

## How to measure

The renderer exposes counters for ad-hoc profiling rather than fabricated
headline numbers:

- `GpuDebugCounters` — cache hit ratio, decode latency, dropped frames,
  outstanding decodes, cache size.
- `GpuRenderer.setDebug(true)` — a DOM overlay polling those counters
  (FPS, render duration, active clips, textures, decoder state).
- `__trace.on('DECODE', 'CACHE_GET', 'DRAW', …)` in the console — channel-based
  frame-lifecycle logging (see `core/debug/trace.ts`).
- The playground's Playwright suite hashes `gl.readPixels` output to assert frame
  stability and determinism.

If you add a performance claim to the docs, back it with a repeatable measurement
and say how it was taken.
