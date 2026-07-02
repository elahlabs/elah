# `core/export` — Architecture

How a `Project` becomes an MP4 `Blob`, and why the pipeline is shaped this way.

---

## 1. System overview

Export is a **second consumer of `resolveTimeline`**, not a second renderer. The
live preview and the exporter both turn `(project, frame)` into a `Scene` and
composite it; they differ only in the surface they draw to and the clock that
drives them.

```
                  resolveTimeline(frame, project) → Scene
                          │                     │
              ┌───────────┘                     └────────────┐
              ▼                                               ▼
   live preview (RAF clock)                       export (frame-stepped loop)
   GpuRenderer → WebGL canvas                      ExportWorker → OffscreenCanvas (2D)
   StreamingFrameProducer decode                   mediabunny CanvasSink decode
              │                                               │
        pixels on screen                                MP4 Blob (mediabunny mux)
```

Two threads are involved:

- **Main thread** — `exportVideo()` orchestrates: mixes audio (Web Audio is
  main-thread only), spawns the worker, forwards progress, resolves the `Blob`.
- **Worker thread** — `ExportWorker` does the per-frame render + encode loop on an
  `OffscreenCanvas`, with no DOM access.

## 2. Data flow

```
main: exportVideo(project, options)
  │  renderAudioMix(project)
  │    └─ OfflineAudioContext: decode each clip, schedule, startRendering()
  │       → RenderedAudio { sampleRate, channels: ArrayBuffer[] (planar f32) }
  │  new Worker('./ExportWorker.ts', { type: 'module' })
  │  postMessage({ type:'start', project, options, audio, trace },
  │              transfer: audio.channels)         ─────────────►  worker
  │
  │  ◄───────────────  { type:'progress', frame, totalFrames }   (per frame)
  │  ◄───────────────  { type:'done', buffer }     transfer: [buffer]
  │  ◄───────────────  { type:'error', message }
  │
  └─ new Blob([buffer], { type: 'video/mp4' })
```

Audio PCM and the final MP4 `ArrayBuffer` are **transferred**, not copied, across
the worker boundary (zero-copy; the source buffers detach after posting).

## 3. Rendering flow (per frame, in the worker)

```
for frame in [0, totalFrames):
    scene = resolveTimeline(frame, project)        ── same call the preview makes
    ctx2d.clearRect + fillRect('#000')             ── opaque black background
    items = [...videos, ...images, ...texts] sorted by zIndex
    for item in items:
        ctx.save(); ctx.globalAlpha = opacity
        video → sink.getCanvas(sourceFrame / fps)  then drawMedia()
        image → drawMedia(imageBitmap)
        text  → drawText() via computeTextLayout()
        ctx.restore()
    canvasSource.add(frame / fps, 1 / fps)         ── encode this frame
    postMessage({ progress })
```

`drawMedia()` and `drawText()` call the **same** placement helpers the GPU
renderer uses:

- `resolveDrawRect(transform, stageW, stageH, contentW, contentH)` — object-fit
  contain + transform → pixel rect + rotation.
- `computeTextLayout(ctx, clip, stage)` — wrap, line metrics, alignment, anchor.

So a clip lands on the exact same pixels in export as in preview, because the
geometry is computed by one shared function, not reimplemented.

## 4. Timeline interaction

The worker receives a plain `Project` snapshot and calls `resolveTimeline` itself.
Trim, split, solo, mute, disable, and `zIndex` are all resolved by that pure
function — the export loop has **no awareness of trim geometry**; it only reads
`scene.frame` and each active clip's `sourceFrame`. `getTotalFrames(project.clips)`
sets the loop bound.

## 5. Worker interaction

Message protocol (internal, not public API — see `export/types.ts`):

| Direction     | Message    | Payload                                                                                     |
| ------------- | ---------- | ------------------------------------------------------------------------------------------- |
| main → worker | `start`    | `project`, `options` (with `onProgress`/`signal` stripped), `audio`, enabled trace channels |
| worker → main | `progress` | `frame`, `totalFrames`                                                                      |
| worker → main | `done`     | `buffer: ArrayBuffer` (transferred)                                                         |
| worker → main | `error`    | `message: string`                                                                           |

`onProgress` and `signal` are stripped before posting (neither is
structured-cloneable); progress is reconstructed on the main thread from
`progress` messages, and an aborted `signal` terminates the worker directly. Trace
channels are forwarded because the worker has no `window`/`localStorage` to read
`__trace` from — `exportVideo` snapshots `getEnabledChannels()` and the worker
seeds them via `enableChannels()`.

## 6. Audio mixing & mediabunny integration

**Mix (main thread).** `renderAudioMix` builds an `OfflineAudioContext` sized to
the timeline, decodes each active (non-muted, non-disabled) audio clip with
`decodeAudioData`, schedules it with `start(when, offset, duration)` derived from
the clip's frames, applies per-clip gain, and renders to planar Float32 PCM.

**Encode (worker).** mediabunny does the muxing:

- `CanvasSink(videoTrack)` — decodes each unique source video; `getCanvas(timeSec)`
  returns the frame to composite.
- `CanvasSource(offscreenCanvas, { codec, bitrate })` — encodes each composited
  frame via `add(timestampSec, durationSec)`.
- `AudioSampleSource({ codec, bitrate })` — encodes the mixed PCM, fed in ~1-second
  `f32-planar` chunks so `await source.add()` applies encoder backpressure.
- `Mp4Output` + `BufferTarget` — `start()` → frame/audio loop → `finalize()` →
  `bufferTarget.buffer` is the MP4.

## 7. Why this architecture

- **Reuse timeline resolution.** `resolveTimeline` is pure and worker-safe, so the
  exporter calls it directly. There is exactly one definition of "what is visible
  at frame N" for both preview and export.
- **Reuse placement, not the draw path.** The worker draws with the 2D canvas API
  (no WebGL context needed in a worker for the common case) but shares the
  geometry helpers (`resolveDrawRect`, `computeTextLayout`). Shared _math_ keeps
  the two paths pixel-aligned without forcing a GPU context into the worker.
- **No export-specific scene system.** Adding one would create a second source of
  truth that silently drifts from preview. The `Scene` is the contract.
- **No heavy WASM pipeline.** Decode is mediabunny's `CanvasSink` (WebCodecs under
  the hood); mux is mediabunny; the bundle stays lean and the import only loads
  when an app actually exports (see [`BUNDLE_STRATEGY.md`](../../../../../BUNDLE_STRATEGY.md)).
- **Deterministic & frame-stepped.** No RAF, no real-time clock: the loop advances
  frames explicitly, so the same project produces the same bytes — a prerequisite
  for golden tests and future distributed export.

## 8. Cache & scheduling strategy

Export is **pull-based and sequential**: one frame is fully rendered and encoded
before the next begins, gated by `await canvasSource.add(...)` and the audio
chunk backpressure. There is no predictive frame cache here — mediabunny's
`CanvasSink` owns video decoding internally, keyed by source time. Assets are
opened once up front: one `CanvasSink` per unique video `src`, one `ImageBitmap`
per unique image `src`.

## 9. Known bottlenecks

- **Audio mix is main-thread, whole-file.** Each clip is fully decoded into the
  `OfflineAudioContext`; long/many-clip timelines are the stress case.
- **Sequential single worker.** Throughput is one frame at a time on one core.
- **Per-frame `sink.getCanvas(timeSec)`.** Random-access decode cost depends on the
  source GOP structure; large seeks within a clip are not specially optimized.

## 10. Planned improvements

- Harden audio export (streaming decode, cross-clip backpressure, edge codecs).
- Optional WebGL `OffscreenCanvas` export path to share GPU effects with preview.
- Distributed export: partition frames across N workers, concatenate encoded
  chunks — the deterministic contract already permits it.
- Cancellation: an `AbortSignal` (`options.signal`) already aborts an export by
  terminating the worker and rejecting the promise; the remaining work is
  cooperative cancel _between frames_ with clean in-worker resource teardown.

> Tracing: enable `EXPORT`, `EXPORT_ASSETS`, `EXPORT_AUDIO`, `EXPORT_MUX`,
> `EXPORT_FRAMES` via `__trace.on(...)` in the console before exporting. The main
> thread and worker both route through the same channels (`core/debug/trace.ts`).
