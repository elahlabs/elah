# GPU Renderer — Implementation Notes

Architectural "why" decisions captured in one place.
Cross-reference with `architecture.md` (diagrams) and `EVOLUTION.md` (history).

---

## Why the synthetic provider fallback still exists

`SyntheticVideoFrameProvider` renders coloured gradient frames without any media
file, `mediabunny` dependency, or browser codec capability. It exists for three
reasons:

1. **Zero-dependency dev mode** — start the playground without any video files.
   All layout, timeline scrubbing, and debug-overlay features work immediately.

2. **jsdom unit tests** — `VideoDecoder` and `EncodedVideoChunk` are browser
   WebCodecs APIs unavailable in jsdom. Vitest suites that test `VideoLayer`,
   `RenderGraph`, `TexturePool`, and golden-frame hashes use the synthetic or
   mock provider so they run without a real browser.

3. **Debugging without media** — when diagnosing renderer issues (shader,
   transform matrix, context loss, debug overlay), isolating the renderer from
   decode complexity is valuable. The synthetic provider renders reliably; a real
   decoder adds async timing, codec errors, and fetch latency as confounders.

Removal trigger: when the test suite is fully Playwright-gated and no jsdom
suite touches the render path. Not planned before Phase 4 (export).

---

## Why `render()` stays synchronous (I1)

1. **Predictable frame budget** — the RAF callback has ~16 ms. Awaiting inside
   `render()` would yield the call stack, allowing other microtasks and layout to
   run before the frame is painted. This breaks the guaranteed-single-RAF-tick
   compositing model.

2. **Export reuse** — the export pipeline steps frames at 1/fps in a Worker and
   calls `render(scene)` directly. An async `render()` would require a
   fundamentally different export API.

3. **Immutable Scene as the diff** — the `scene === lastScene` short-circuit
   (I3) only works when `render()` is a pure, synchronous function of the scene.
   If `render()` were async, two concurrent calls could race.

Async work (decode, upload scheduling) happens out-of-band via
`provider.requestFrame()`, which is fire-and-forget. Render always draws the
last successfully uploaded texture; cache misses are silent.

---

## Why decode is out-of-band

The browser `VideoDecoder` API is inherently async:

- `VideoDecoder.flush()` returns a Promise.
- Demuxer I/O (`fetch`, `EncodedPacketSink.getKeyPacket`) is async.
- `VideoFrame` delivery via `output` callback is asynchronous.

Coupling any of this to `render()` would require `await` inside the render path,
violating I1. Instead, `DecoderBackedVideoFrameProvider`:

1. Accepts `requestFrame(n)` synchronously (fire-and-forget).
2. Runs the async decode pipeline.
3. Deposits the decoded `VideoFrame` into `FrameCache` when ready.
4. On the next render tick, `getCurrent(n)` returns the cached frame (or `null`
   on a first-frame cache miss, which draws the last texture — no flicker).

This is the same model used in production video editors (Freecut, CapCut web):
decode runs ahead of playback on a separate async chain; the render thread
consumes from the cache.

---

## Why audio is intentionally not implemented yet

Audio requires:

1. **A separate clock authority** — `AudioContext.currentTime` is the only
   reliable high-resolution timer that stays synchronised with hardware audio
   output. `performance.now()` drifts relative to audio by 1–5 ms per minute.
   When audio ships, `PlaybackEngine.getFrameAt()` must be disciplined to
   `AudioContext.currentTime`.

2. **An audio scheduler** — WebAudio `AudioBufferSourceNode` scheduling must be
   done 50–100 ms ahead of playback to prevent glitches. This is a non-trivial
   scheduler separate from the RAF loop.

3. **Codec decode** — audio decode also uses WebCodecs (`AudioDecoder`), but
   the scheduler and buffering model is very different from video (no visual
   texture cache; PCM blocks instead of `VideoFrame` objects).

Shipping audio before the clock is disciplined to `AudioContext.currentTime`
would cause audible video/audio drift. This is Phase 2.

---

## Current limitations of the playground importer

1. **No persistence** — assets do not survive a page reload. `MediaAsset.src` is
   an object URL (`blob:`) tied to the current page session. Re-importing after
   reload requires selecting the file again.

2. **No codec capability probe** — the playground accepts any file with a video
   MIME type. If the browser's `VideoDecoder` does not support the codec, the
   error surfaces in the console (`createMediabunnyBackend: video track codec is
   not supported…`). A future `importFiles` extension could call
   `VideoDecoder.isConfigSupported()` before creating the asset.

3. **Single-file blob fetch per provider open** — each call to `backend.open(src)`
   fetches the full blob from the object URL. For large files (> 1 GB), this is
   a significant memory allocation. Mitigation: pass the original `File` via
   `blobResolver` (the parameter already exists) to give mediabunny direct
   access to the file without copying. Deferred to Phase 2.

4. **No multi-track audio** — audio clips appear on the timeline but produce no
   sound. Audio decode is Phase 2.

5. **Object URL lifetime** — object URLs are created when a file is imported and
   are never revoked (the tab holds the blob URL until page close). A production
   implementation would revoke URLs when assets are removed from the library.
   The `removeAsset` action in `MediaLibraryStore` does not currently revoke the
   URL because `MediaAsset` does not store the File handle needed for cleanup.

---

## Why `blobResolver` exists in `createMediabunnyBackend`

mediabunny's `Input` requires a `Blob` (via `BlobSource`), but the
`DemuxerBackend.open(src: string)` API takes a URL string. The default resolver
`fetch(src).blob()` bridges the gap: it fetches the URL (which for object URLs
hits the browser's in-memory blob store) and materialises a Blob.

The explicit `blobResolver` parameter exists so callers who already have the
`File` object (e.g., freshly imported in the playground) can return it directly:

```ts
const fileMap = new Map<string, File>()

importFiles(files).then(({ imported }) => {
  for (const asset of imported) {
    fileMap.set(asset.src, originalFile)
  }
})

const factory = () => createMediabunnyBackend(mediabunny, {
  blobResolver: (src) => {
    const file = fileMap.get(src)
    return file ? Promise.resolve(file) : fetch(src).then(r => r.blob())
  },
})
```

This eliminates the fetch round-trip and avoids the in-memory copy, halving the
memory overhead of opening large video files. Planned for Phase 2.
