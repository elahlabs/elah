# Current Limitations

> An honest list of what the engine does **not** do yet. Everything here is a
> known gap or deliberate trade-off, verified against the current code — not a
> bug report and not a promise. Features the engine *does* ship are in
> [`README.md`](./README.md); the forward plan is in [`ROADMAP.md`](./ROADMAP.md).

---

## Playback & decode

- **Single video track + single audio track (v1).** The decode pipeline and
  renderer composite multiple clips by `zIndex`, but the system is tuned and
  tested for one active video track and one audio track. Heavy multi-track
  compositing is not yet a supported path.
- **Reverse / backward scrubbing is unstable.** `StreamingFrameProducer` feeds a
  *forward* lookahead window. A backward jump larger than the lookahead is a
  discontinuity: it seeks the demuxer to the nearest keyframe and cold-starts the
  decoder, so scrubbing backward can show the last frame or a brief black frame
  until decode catches up.
- **No scheduler / predictive frame caching.** Decode is reactive to the current
  playhead. There is no component that warms frames ahead of where the playhead
  is *heading*, prioritizes across clips, or pre-rolls around cuts. This is the
  next planned architectural layer (see [`ROADMAP.md`](./ROADMAP.md)).
- **Cache misses on large jumps look like a stall.** On a miss the renderer keeps
  the last uploaded texture (by design — no flicker). During a big seek or a
  transition that means a held/last frame until the decoder produces the target.
- **One decoder per source URL.** Clips that share a `src` share a decoder. Two
  clips from the same file needing different frames simultaneously (e.g. a
  same-source transition) is not yet handled.
- **fps mismatch is worked around, not solved.** A video whose native fps differs
  from the project fps relies on a small cache-lookback fallback. See
  [`docs/known-bugs.md` KB-001](./docs/known-bugs.md).

## Editing UI

- **No on-canvas gizmos for video/image.** Text clips have interactive
  drag / resize / inline-edit in the preview overlay. Video and image clips are
  positioned through `Clip.transform` but have no resize/rotate handles on the
  canvas yet.
- **No timeline thumbnails or waveforms.** The asset panel generates a single
  thumbnail per asset, but timeline clips render no filmstrip, and audio clips
  render no waveform (`MediaAsset.waveform` is a reserved placeholder).
- **No media persistence.** The media library is in-memory only; object URLs are
  created at import and are **not** persisted. Reloading the editor clears the
  library.

## Compositing & effects

- **No transition system.** `Scene.transitions` is a reserved, always-empty array.
  Crossfade / cut / wipe are not implemented.
- **No effects / filters / animation pipeline.** Layers apply `transform` and
  `opacity` only. There is no per-clip shader-effect stack and no advanced GPU
  transition pipeline.

## Export

- **Audio export is functional but not yet hardened.** The mix is rendered on the
  main thread via a single `OfflineAudioContext` (the Web Audio API isn't
  available in workers), each clip is whole-file decoded, and the PCM is
  transferred to the worker for encoding. It works for the common case; edge
  cases (very long timelines, many overlapping clips, exotic codecs) are not yet
  stress-tested.
- **Export is single-worker and sequential.** Frames render one at a time in one
  worker. There is no distributed/parallel export, though the deterministic
  `(project, frame) → pixels` contract is designed to allow it later.

## Platform & extensibility

- **No plugin architecture.** This is deliberate (`ARCHITECTURE.md` § 9, A5):
  the abstraction will be added when there is something concrete to plug in.
- **WebGL2 only.** The renderer targets `#version 300 es`. There is a WebGL1
  fallback path in `WebGLContext`, but no WebGPU backend yet (the `Renderer`
  interface is shaped to accept one).
- **`DecoderBackedVideoFrameProvider` is deprecated.** It remains in the tree for
  one release cycle; `StreamingFrameProducer` is the production path. Don't build
  on the deprecated class.
