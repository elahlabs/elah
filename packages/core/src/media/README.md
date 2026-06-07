# `core/media`

Frame and sample **producers** for downstream consumers (the renderer and the
exporter). This layer turns a source URL into decoded frames / audio — it does
not composite or paint.

## Subfolders

| Folder | Role | Status |
|---|---|---|
| [`video/`](./video/) | WebCodecs-backed video decode: push-based `StreamingFrameProducer`, `VideoDecoderManager`, `FrameCache`, mediabunny demuxer adapter | ✅ Working |
| `audio/` | `AudioPlaybackController` — schedules Web Audio for `scene.audios` on the `PlaybackEngine` clock | ✅ Working (single track) |

> **Text and image are not media producers.** They need no decode, so they are
> rendered directly by `TextLayer` / `ImageLayer` in `core/renderer/gpu/layers/`.
> An image is loaded as an `ImageBitmap` at the layer; text is rasterized from
> `computeTextLayout`. There is intentionally no `media/text/` or `media/image/`.

## Import rules (enforced by [`__tests__/ImportBoundary.test.ts`](./__tests__/ImportBoundary.test.ts))

- `core/media/**` must **not** import from `core/renderer/**` (one temporary
  exception: `GpuDebugCounters`, used for metrics) or `core/assets/**`.
- `core/renderer/**` may import `core/media/video` only via its public barrel
  (`index.ts`) or the `VideoFrameProvider` type module — no deep imports.
- Consumers (renderer, exporter) depend on the interfaces each subfolder exports,
  not on internal files.

## Where it connects

- The **renderer** uses `video/` through `VideoLayer` (one `VideoFrameProvider`
  per unique `src`, ref-counted across clips).
- The **playback** layer mounts `audio/`'s `AudioPlaybackController` via `<Preview>`.
- The **asset library** (import, metadata, thumbnails) lives separately in
  [`core/assets/`](../assets/) — `media/` consumes the `src` URLs that produces.

See [`video/README.md`](./video/README.md) for the decode pipeline and
[`../renderer/architecture.md` § 6](../renderer/architecture.md) for the full
frame lifecycle and ownership rules.
