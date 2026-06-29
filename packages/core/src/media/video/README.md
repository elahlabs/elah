# `core/media/video`

WebCodecs-backed video decode. Turns a source URL into decoded frames the
renderer can upload, behind a **synchronous, push-based** interface so the render
tick never blocks on decode.

> The deep pipeline (sequence diagrams, frame lifecycle, context-loss recovery,
> the "freeze after ~16 frames" bug and its fix) lives in
> [`../../renderer/architecture.md` § 6](../../renderer/architecture.md). This
> README is the module map + contract; that doc is the why.

---

## Purpose

- Decode video ahead of the playhead and hand the renderer a frame *now*, or
  `null` on a miss — never an `await` inside `render()`.
- Survive a GPU context loss without re-decoding (cached frames are plain memory,
  not GL textures).
- Share one decoder across every clip that uses the same `src`.

## The contract — `VideoFrameProvider`

```ts
interface VideoFrameProvider {
  getCurrent(sourceFrame): VideoFrame | ImageBitmap | null  // sync; borrowed ref or null
  setPlayhead(sourceFrame, opts?): void                     // fire-and-forget; drives decode
  markIdle(): void
  markActive(): void
  dispose(): void
}
```

`VideoLayer` calls `setPlayhead(N)` then `getCurrent(N)` every tick. The provider
decodes forward internally; the render path issues no individual frame requests.

## Modules

| File | Role |
|---|---|
| `VideoFrameProvider.ts` | The interface + `createVideoFrameProvider()` factory + `Mock` / `Synthetic` dev providers |
| `StreamingFrameProducer.ts` | **The production provider.** Push-based; owns a `VideoDecoderManager` + `FrameCache<ImageBitmap>` |
| `VideoDecoderManager.ts` | One `VideoDecoder` + demuxer per source. State machine: `Idle → Opening → Ready ⇄ Decoding ⇄ Resetting → Draining`. API: `feed(rangeUs)`, `reset(keyframeUs)`, `drain()`, `onFrame` |
| `FrameCache.ts` | LRU cache keyed by source frame, pivot-relative eviction. **Owns** every stored frame; `get()` returns a borrowed reference |
| `demuxer/MediabunnyDemuxer.ts` | `DemuxerBackend` / `DemuxerFactory` types + adapter |
| `demuxer/createMediabunnyBackend.ts` | Bridges `open(src)` to mediabunny `Input + BlobSource`; `isMediabunnyCompatible` |
| `DecoderBackedVideoFrameProvider.ts` | **Deprecated** (pull-based predecessor). Kept one release cycle; not returned by the factory |

## Provider selection (`createVideoFrameProvider`)

```
deps.demuxerFactory provided        → StreamingFrameProducer  (real decode)
OffscreenCanvas + VideoFrame avail.  → SyntheticVideoFrameProvider  (coloured dev frames)
otherwise (jsdom / tests)            → MockVideoFrameProvider
```

## How `StreamingFrameProducer` works

- **Copy-and-close.** Each decoded `VideoFrame` is copied to an `ImageBitmap` and
  closed *immediately* (returning its slot in the decoder's ~16-slot output pool);
  the cache holds the bitmap. This is the invariant that keeps playback from
  freezing. The `flipY` on copy cancels the GL upload flip — load-bearing.
- **Lookahead with hysteresis.** Feeds the decoder in bursts up to a high-water
  line (`N + lookahead`) and waits until the buffer drains past a low-water line
  before the next burst — keeps frames flowing without re-feeding packet ranges.
- **Discontinuity reset.** A playhead jump greater than the lookahead (or the
  first call) seeks the demuxer to the nearest keyframe and cold-starts the
  decoder. Backward scrubbing hits this path (see limitations).
- **Stall watchdog.** Progress-based: if the decoder goes silent for a sustained
  run of ticks while fed ahead of the playhead, one reset is triggered.

## Public exports (`index.ts`)

`VideoFrameProvider` (type) · `VideoFrameProviderDeps` · `createVideoFrameProvider`
· `MockVideoFrameProvider` · `SyntheticVideoFrameProvider` · `StreamingFrameProducer`
· `DecoderBackedVideoFrameProvider` · `FrameCache` · `DemuxerBackend` /
`DemuxerFactory` (types) · `createMediabunnyBackend` · `isMediabunnyCompatible`.

## Dependencies

- **WebCodecs** (`VideoDecoder`, `EncodedVideoChunk`) and `createImageBitmap` —
  browser-native; jsdom falls back to stubs in tests.
- **mediabunny** — only via an injected `DemuxerFactory`; this folder never
  statically imports it. The web app wires it via `createDefaultDemuxerFactory()`
  (`apps/web/components/playground/ProductionEditor.tsx`).

## Current limitations

- **Backward scrubbing is a cold start** — every large backward jump re-seeks to a
  keyframe (forward-only lookahead). See [`CURRENT_LIMITATIONS.md`](../../../../../../CURRENT_LIMITATIONS.md).
- **One decoder per `src`** — simultaneous different frames from the same file
  (e.g. a same-source transition) aren't handled yet.
- **fps mismatch workaround** — `getCurrent(N)` falls back to a `FrameCache.get(N, maxLookback=2)`
  lookup, returning the nearest earlier cached frame to bridge index gaps when
  video fps ≠ project fps. See [`docs/known-bugs.md` KB-001](../../../../../../docs/known-bugs.md).

## Future direction

The planned scheduler layer (see [`ROADMAP.md`](../../../../../../ROADMAP.md)) will
sit above these providers to add predictive caching, reverse-scrub strategy, and
cross-clip decode prioritization. The provider interface is meant to stay stable
under it.

## Tests

`__tests__/` — provider behaviour, decoder state machine, cache eviction/ownership,
demuxer adapter, and stress suites (`PlaybackStress`, `RapidSeekStress`,
`BackwardSeekStability`, `StuckDecodeRecovery`, …). Run from `packages/core`:

```bash
npm --workspace @elah/core run test -- --run media/video/__tests__/StreamingFrameProducer.test.ts
```
