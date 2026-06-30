# `core/export`

Render a `Project` to an MP4 `Blob`, off the main thread, frame-by-frame.

Export reuses the same timeline resolution as live playback — it does **not**
have its own scene system or rendering path. A worker steps `resolveTimeline`
over every frame, draws to an `OffscreenCanvas` using the renderer's shared
placement helpers, and muxes the result with mediabunny.

---

## Purpose

- Produce a deterministic MP4 from the current project: same project → same bytes.
- Keep the UI responsive during export (all heavy work runs in a worker).
- Avoid a second source of truth: preview and export composite identically.

## Responsibilities

- `exportVideo(project, options)` — public entry; spawns the worker, mixes audio,
  resolves the finished `Blob`, forwards progress.
- `ExportWorker.ts` — off-main-thread frame render + encode loop.
- Audio mix on the main thread (the Web Audio API is unavailable in workers).

## Public API

```ts
import { exportVideo } from '@elah/core'
import type { ExportOptions, ExportProgress, ExportVideoCodec, ExportAudioCodec } from '@elah/core'

const blob = await exportVideo(project, {
  videoCodec: 'avc',        // 'avc' | 'vp9' | 'vp8'   (default 'avc')
  audioCodec: 'aac',        // 'aac' | 'opus'          (default 'aac')
  videoBitrate: 8_000_000,  // bits/s (default 8 Mbps)
  audioBitrate: 128_000,    // bits/s (default 128 kbps)
  onProgress: ({ frame, totalFrames }) =>
    console.log(`${Math.round((frame / totalFrames) * 100)}%`),
})

const url = URL.createObjectURL(blob) // type: 'video/mp4'
```

`exportVideo` resolves with a `Blob`, or rejects if the worker errors or the
project has no clips.

## Internal flow

```
exportVideo(project, options)            [main thread]
  ├─ renderAudioMix(project)             OfflineAudioContext → planar PCM
  ├─ new Worker(ExportWorker, module)
  └─ postMessage({ project, options, audio, trace }, [audio buffers])  ← transfer

ExportWorker.runExport()                 [worker thread]
  ├─ open one mediabunny CanvasSink per unique video src
  ├─ load one ImageBitmap per unique image src
  ├─ create OffscreenCanvas + CanvasSource + Mp4Output (BufferTarget)
  ├─ encode the received audio PCM (AudioSampleSource, ~1s chunks)
  ├─ for frame in [0, totalFrames):
  │     scene = resolveTimeline(frame, project)
  │     renderFrame(ctx2d, scene, …)     draw video/image/text by zIndex
  │     canvasSource.add(frame / fps, 1 / fps)
  │     postMessage({ progress })
  ├─ output.finalize()
  └─ postMessage({ done, buffer }, [buffer])   ← transfer ArrayBuffer back
```

See [`Architecture.md`](./Architecture.md) for the full data flow, the worker
message protocol, and the rationale.

## Dependencies

- **mediabunny** — used *inside the worker only* (`CanvasSink`, `CanvasSource`,
  `Mp4Output`, `AudioSampleSource`). The package's public entry never statically
  imports it; the worker is a separate module graph the bundler code-splits, and
  `lazyExport` defers even `exportVideo` itself behind a dynamic import.
- **Browser APIs** — `OffscreenCanvas` (worker render target), `OfflineAudioContext`
  (main-thread mix), `createImageBitmap`.
- **`resolveTimeline`** + **`renderer/gpu/layers/drawRect.ts`** &
  **`textLayout.ts`** — shared with the live renderer.

## Current limitations

- Audio mixing runs on the main thread with one `OfflineAudioContext`, whole-file
  decoding each clip. Functional, not yet hardened for very long or
  many-clip timelines. See [`CURRENT_LIMITATIONS.md`](../../../../../CURRENT_LIMITATIONS.md).
- Single worker, sequential frames — no parallel/distributed export yet.
- Frames are drawn with the 2D canvas path (shared *placement*, not the GPU draw
  calls); GPU-specific effects would need an `OffscreenCanvas` WebGL export path.

## Future direction

- Stabilize audio export (streaming decode, backpressure across clips).
- Optional WebGL `OffscreenCanvas` export to share GPU effects with preview.
- Distributed export: N workers over frame ranges, one mux (the deterministic
  `(project, frame) → pixels` contract already allows this).
