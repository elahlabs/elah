# Current Limitations

> An honest list of what the engine does **not** do yet. Everything here is a
> known gap or deliberate trade-off, verified against the current code — not a
> bug report and not a promise. Features the engine *does* ship are in
> [`README.md`](./README.md); the forward plan is in [`ROADMAP.md`](./ROADMAP.md).

---

## Playback & decode

- **Multiple video tracks are allowed, but not yet tuned for.** Since 0.6.0
  `addTrack('video')` adds another video track, and video tracks composite in
  track order (the topmost lane draws on top). The decode pipeline is still
  best-effort with no scheduler (below), so several video clips decoding at the
  same time can stall or hold a frame; one active video clip at a time is the
  tested path. **Audio is multi-track** as of 0.3.0 — `AudioPlaybackController`
  mixes several audio tracks with per-clip and master volume.
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

- **No rotation handle for video/image.** `MediaTransformOverlay` has 8 resize
  handles (non-uniform scale, **Shift** keeps aspect), a Resize/Crop toggle and
  drag-move. `transform.rotation` flows through both renderers and tilts the
  selection box, but the only way to set it on a video or image clip is through the
  engine. **Text** clips do have a rotate knob.
- **Media persistence is a seam, not a feature.** `snapshotMediaLibrary` /
  `hydrateMediaLibrary` and `readProjectDocument` / `relinkProjectMedia` (0.6.0) let a
  host save and restore the library's metadata and thumbnails and reopen a stored
  project, but core ships **no storage adapter** (the web playground's IndexedDB one
  lives in `apps/web`). Files imported from disk are `blob:` URLs that do not survive a
  reload and their bytes are not stored: `relinkProjectMedia` reports those clips as
  `missing` and the user must supply the file again.

## Compositing & effects

- **The six newer transitions need WebGL2.** `zoom`, `spin`, `whip`, `glitchCut`,
  `warpDissolve` and `lumaWipe` are composited by the WebGL2 transition shader in preview
  and export. A project that uses only `fade`, `wipe` and `slide` still exports in a
  runtime whose worker has no WebGL2 (a 2D snapshot path, left/right slide only); a
  project that uses any other kind fails to export there. A cold incoming video decoder
  can show through the start of a transition (see `docs/known-limitations.md` KB-003).
- **3D tilt is limited to four clip types.** `rotateX` / `rotateY` work on video, image,
  sequence and compound clips. Text, shape and freehand clips refuse them.
- **Text template `stagger` and `tracking` are inert.** `applyTextTemplate` ignores them
  and nothing in these packages executes them; they are metadata for a host that builds
  staggered or letter-spaced text itself. (Per-unit text animators, stagger and scramble
  in the motion layer are separate and do run.)
- **Effects, masks, mattes, adjustment clips and 3D tilt are GPU-only.** Export of a
  project that uses any of them opens a WebGL2 context in the worker first and fails fast
  if it cannot (a project without them exports without WebGL2).

## 1.0.0: new layers and what is not built

- **Export is Chromium-only in practice.** It needs WebCodecs `VideoEncoder`,
  `OffscreenCanvas` and WebGL2 in a worker. Chrome and Edge are the tested browsers;
  Safari and Firefox are untested and `detectExportSupport` says so. HEVC, AV1, WebM
  transparency and GIF depend on what the browser can encode.
- **Fonts are Latin-only.** The 12 bundled families ship a Latin subset, so Telugu,
  Hindi, Arabic, CJK, Cyrillic, Greek and Latin Extended characters are not covered and
  fall back to a generic family. The files load from `/fonts/` on your host unless you opt in with
  `packageFontsBaseUrl()` (unbundled imports only).
- **No editing UI for the newer clip types.** `@elah/editor` plays, saves and exports
  adjustment, generator, compound and sequence clips, and `@elah/timeline` draws and
  moves them, but there is no inspector, curve editor, effect stack or compound editor
  in the packages: you drive them through the engine, ops or VideoSpec. In the timeline,
  compound, generator, adjustment and sequence clips are placed on `elements` lanes and
  will not drag onto a video lane.
- **The HTML/CSS scene layer needs a host-side measurer.** `validateScene` and
  `sceneToClip` are pure, but `sceneToClip` takes a *measured* scene (boxes, line breaks,
  resolved styles) and this release ships no DOM measurer. You write one against a
  hidden, stage-sized DOM, or build the `MeasuredScene` yourself.
- **The AI-facing layers are experimental.** `spec` (VideoSpec), `vector/html` and the
  op vocabulary (`ops`) may change in a minor release. Two ops, `generateMedia` and
  `removeBackground`, only place a placeholder and return it as `deferred`: no provider
  call ships.
- **`@elah/editor` does not re-export the new layers.** Import effects, generators,
  motion helpers and `packageFontsBaseUrl` from `@elah/core`, and VideoSpec, HTML scenes
  and ops from `@elah/core/spec`, `/html` and `/ops`; list `@elah/core` in your own
  dependencies.
- **Loading from a CDN is only partly verified.** The cross-origin worker path, the font
  base URL and a jsDelivr `/+esm` import were exercised against a local stand-in for a
  CDN, not the published package. In a blob worker, relative or root-relative asset URLs
  have no base, so use absolute URLs for media in an unbundled import.
- **Package size grew.** `@elah/core` is about 1.2 MB packed (about half is the optional
  fonts); 0.6.0 was about 106 KB. Bundled-size figures for 1.0.0 are not published yet.
- **Dist is for bundlers.** `@elah/core`'s `dist` uses extensionless relative imports
  (as 0.6.0 did), so import it through Vite, webpack, Next or a CDN, not bare Node ESM.
  For Node without a bundler use `@elah/cli`, or bundle it yourself.

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
