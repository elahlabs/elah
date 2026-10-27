# Changelog

All notable changes to the Elah packages (`@elah/core`, `@elah/react`,
`@elah/timeline`, `@elah/editor`, `@elah/cli`) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the packages follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
`@elah/core`, `@elah/react`, `@elah/timeline`, and `@elah/editor` are released
together and share a version number. `@elah/cli` is a separate package and
versions independently, starting from its own 0.1.0.

## [Unreleased]

Not part of the 1.0.0 packages. `@elah/cli` keeps its own version (0.1.2) and is
released separately.

### Added

- `@elah/timeline`: `<KeyframeLane>` and `useKeySelectionStore`. A selected clip shows its keyframes as diamonds on its bottom edge: click to seek and select, drag to retime with snapping (one undo step), Shift+click for multi-select.

- **`@elah/react-native` 0.1.0 (pre-release, not published).** The platform-free timeline model:
  lane layout, move / trim / pinch gesture reducers and a single engine-command applier, tested
  against the real `TimelineEngine`. Re-exports `EditorProvider`, the store hooks and the engine
  from `@elah/core/engine`. No timeline component yet. Its colour map now covers the four new
  clip types.
- **`apps/mobile`:** an Expo dev harness for the React Native binding (own install, not a root
  workspace member).

### Changed

- **`@elah/cli` (unreleased, still 0.1.2): exports version 5 projects.** The harness server
  answers a module directory request with a redirect to its `index.js` and resolves dotted
  module names (`./shaders/quad.frag`), so the export worker loads against the converged core;
  served modules get `process.env.NODE_ENV` inlined; media inside compound clips and
  animated-image sequence clips is served; the hard-coded project version 1 is gone, and the
  version warning fires only for a project newer than `PROJECT_VERSION`. A `frames` sequence
  whose template is a relative URL is not routed yet. Its `@elah/core` range is now `^1.0.0`.
- The root `workspaces` list names `apps/web` and `apps/server` instead of `apps/*`.

## [1.0.0] — 2026-10-22

The motion and programmatic layer. `@elah/core` is now the same engine our own
editor runs on: keyframe animation with the full ease set, springs, stagger and
motion paths; HTML/CSS scenes and a VideoSpec document that compile to native,
editable clips; effects, transitions, generators, compound and sequence clips,
audio enhancement and Lottie / SVG import. 1.0.0 also makes the exported surface
a semver promise (see Stability). `@elah/core`, `@elah/react`, `@elah/timeline`
and `@elah/editor` ship together at 1.0.0; `@elah/cli` is not part of this
release.

### Stability

From 1.0.0 the exported API of `@elah/core` (the root entry and the browser-free
`@elah/core/engine` entry), `@elah/react`, `@elah/timeline` and `@elah/editor`
follows semver: a breaking change needs 2.0. Three AI-facing layers are the
exception and are **experimental**; they may change in a minor release as the
models that write them change. They are not exported from the `@elah/core` root:
each has its own subpath entry, so the stable root stays small.

| Subpath | What it holds |
| --- | --- |
| `@elah/core/spec` | the `VideoSpec` / `AuthoredSpec` documents, `compileVideoSpec`, `buildVideo`, `layProject`, `specVocabulary`, component instances |
| `@elah/core/html` | HTML/CSS scene conversion: `validateScene`, `sceneToClip` |
| `@elah/core/ops` | the op vocabulary: `EDITOR_OP_NAMES`, `applyOps`, `sanitizeOps`, the `describe*` helpers |
| `@elah/core/icons` | the vendored Lucide icon set (`ICON_NAMES`) the spec compiler draws from |

The documents they produce are ordinary projects and stay readable; it is the
authoring vocabulary and op shapes that can move. `@elah/editor` does not
re-export these layers: import them from the subpaths above.

### Breaking

- **Project documents are version 5.** `PROJECT_VERSION` went from 1 to 5. A project is
  stamped with the lowest version that can hold what it uses (adjustment clips 2;
  generator clips, shape draw-on and the newer transitions 3; compound clips 4; sequence
  clips 5), so a project that uses none of them is still version 1 and opens in 0.6.x.
  A project that does is refused by 0.6.x with `ProjectDocumentError`
  (`code: 'unsupported-version'`). Every 0.6.x document opens unchanged in 1.0.0.
- **Widened unions can break an exhaustive `switch`.** `ClipType` gained `adjustment`,
  `generator`, `compound` and `sequence` (now 10 members), and `TransitionKind` gained
  `zoom`, `spin`, `whip`, `glitchCut`, `warpDissolve` and `lumaWipe` (now 9). Code that
  switches on either with no `default`, or keeps a `Record<ClipType, …>`, stops
  compiling until it handles the new members. `@elah/react-native` hit exactly this.
- **Transitions are drawn by the WebGL2 renderer.** `<Preview>` no longer lays a frozen CSS
  snapshot over a transition; both clips play through it, with their effects. A host that
  rendered its own transition overlay on top of `<Preview>` should remove it.
- **`mediabunny` `^1.50.8`** (was `^1.45.3`) in `@elah/core`, `@elah/cli` and `apps/web`:
  the export worker retries a failed decoder with options older releases do not have.
- No exported name from 0.6.0 was removed, in any of the four packages.

### Added

- **`@elah/core`: the motion layer.** Keyframes on every transform channel with the full
  ease set (sine, quad, cubic, quart, quint, expo, circ, back, elastic and bounce, each
  in / out / in-out, plus `steps(n)`, cubic-bezier curves and named bezier presets) and
  closed-form springs (the gentle, snappy, bouncy, stiff and wobbly presets); hold keys;
  stagger from the start, end, centre, edges or at random, and across a grid; motion paths
  (a clip travels an SVG path and can orient to it); per-character, word and line text
  animators with their own tweens; scramble text; repeat and yoyo; skew; 3D tilt
  (`rotateX` / `rotateY`, on video, image, sequence and compound clips); expressions;
  36 motion presets.
- **`@elah/core/html`: HTML/CSS scene conversion (experimental).**
  `validateScene({ html, css })` checks a scene against a whitelisted HTML/CSS subset and
  names the supported substitute for everything it refuses; `sceneToClip(measuredScene,
  { fps })` turns a measured scene into one compound clip of native shape, text and image
  clips with keys, from a one-line `data-motion` grammar. Measuring the scene in a browser
  is the host's step: this release ships no DOM measurer.
- **`@elah/core/spec`: VideoSpec (experimental).** A seconds-based JSON document for
  models to write: `compileVideoSpec` compiles it to a `Project` and returns every problem as
  a path-addressed `SpecIssue` instead of throwing; `buildVideo` also expands 17 motion
  components and 6 motion systems and polishes the result; `layProject` lays a compiled
  project onto a live engine as one undo step; `specVocabulary()` renders the vocabulary
  block for a prompt.
- **`@elah/core/ops`: editor ops (experimental).** 57 typed ops (`EDITOR_OP_NAMES`)
  that add text, shapes, generators, captions, effects, transitions, keyframes and edits;
  `applyOps` runs a plan against an engine as one undo step, `sanitizeOps` repairs a model's
  plan, and the `describe*` helpers summarise a project for a prompt. Ops that need a
  provider (`generateMedia`, `removeBackground`) come back as `deferred` for the host to run.
- **`@elah/core`: new clip types.** `adjustment` (applies effects to everything beneath it),
  `generator` (8 built in: particles, energy lines, light leak, lens flare, gradient
  background, counter, bar chart, progress bar), `compound` (a nested project played as one
  clip; `nestClips` / `unnestClip`, component instances that re-expand) and `sequence`
  (an animated image or a numbered frame set, picked by frame index in preview and export).
- **`@elah/core`: effects, transitions, blend modes and mattes.** 23 GPU effects
  (`EFFECT_REGISTRY`: colour grade, blurs, bloom, glow, grain, VHS, CRT, glitch, pixelate and
  more), effect bundles and looks, masks and track mattes, blend modes, and nine transitions
  (`fade`, `slide`, `wipe`, `zoom`, `spin`, `whip`, `glitchCut`, `warpDissolve`, `lumaWipe`),
  all drawn by one WebGL2 pipeline shared by preview and export.
- **`@elah/core`: clip audio.** `Clip.audio`: mute, boost (up to +12 dB), fades and Enhance
  (noise reduction and voice clarity). One gain envelope and one Web Audio chain serve the
  live preview and the export mix, so what you hear is what you export. Audio analysis
  (beats, silences, markers) and word-level captions are public too.
- **`@elah/core`: Lottie and SVG import.** `lottieToClip` and `svgToProject` turn an
  animation or drawing into editable native clips and keys; each returns a report of what it
  could not map.
- **`@elah/core`: export containers.** `ExportOptions.container` selects `mp4` (default),
  `webm` (with transparency where the browser's own check passes), `gif` or a PNG sequence;
  codecs are `avc`, `hevc`, `av1`, `vp9` and `vp8` where the browser can encode them;
  `range: 'inOut'` exports the marked range. A default MP4 export is unchanged.
- **`@elah/core`: fonts that ship in the package.** Twelve OFL families (Inter, Montserrat,
  Poppins, Space Grotesk, Playfair Display, DM Serif Display, Bebas Neue, Anton, Oswald,
  Archivo Black, Roboto Mono, Caveat; Latin subset, woff2) in `fonts/<id>/` with each
  `OFL.txt`. The default font base URL stays `/fonts/`; `packageFontsBaseUrl()` opts in to
  the package's own copies for unbundled use (a CDN, native ESM). Lucide (ISC) icon paths
  and the fonts are listed in `NOTICE` and `THIRD_PARTY_NOTICES.md`.
- **`@elah/core`: CDN-safe workers.** The export, audio-analysis and capability-probe
  workers start from a cross-origin module URL through a blob module worker (jsDelivr's
  `/+esm` build included). Bundled hosts (webpack, Turbopack, Vite) take the same
  `new Worker(new URL(…))` path as before.
- **`@elah/core/engine`: a browser-free entry point.** The engine, resolver,
  `PlaybackEngine`, stores, clip factories, project documents and the pure placement and
  timeline math, now for the whole converged engine, without the WebGL2 renderer, WebCodecs,
  the media importers or the export worker (whose `import.meta` Metro and Hermes reject).
  Shares module instances with `@elah/core`. A test pins every file it can reach.
- **`@elah/core`: timeline geometry.** Pure helpers shared by every timeline UI, in
  `utils/timelineMath.ts`: `timelineContentWidth`, `computeRulerTicks`, `formatRulerLabel`,
  `computeAnchoredScrollLeft`, `resolveZoomAnchorX`, `wheelZoomStep`, `pinchZoom`, `clampZoom`
  (`ZOOM_MIN` / `ZOOM_MAX`), `pxToFrames`, `xToFrame`, `seekFrameAtX`, `snapThresholdFrames`,
  `isCompatibleTrackKind`, `isClipAllowedOnTrack`, and the trim limits `maxTrimDuration`,
  `minTrimDuration`, `minLeftTrimStart`, `neighbourBounds`, `clampLeftTrim`, `clampRightTrim`.
  Re-exported by `@elah/editor`.
- **`@elah/react`: `EditorProvider`.** Moved from `@elah/editor`, which still re-exports it, so
  no import changes. On React Native, Metro picks a `useMediaLibrary.native` variant whose
  browser importers throw.
- **`@elah/timeline`, `@elah/editor`: projects that use the new clip types open, play, save and
  export without losing a clip.** The timeline draws adjustment, generator, compound and
  sequence clips as labelled blocks in existing token colours; trimming lets sourceless clips
  grow as `engine.trimClip()` does; paste copies shapes, drawings and the new types with
  `cloneClip` (pasting a shape used to throw); the transition picker shows a loaded kind
  outside fade / slide / wipe as the active choice; selecting a clip with no inspector panel
  shows a neutral message. There is no editing UI for the new clip types in `@elah/editor`
  yet (see `CURRENT_LIMITATIONS.md`).

### Changed

- **Package size.** `@elah/core` is about 1.2 MB as an npm tarball (`npm pack --dry-run`:
  1,158,481 bytes packed, 3.0 MB unpacked, 735 files); 0.6.0 was about 106 KB. Roughly half is
  the bundled fonts, which a host loads only if it opts in; the rest is the converged engine.
  Everything stays tree-shakeable (`sideEffects: false`), and the engine-only entry
  `@elah/core/engine` leaves out the renderer and the codec.
- **Startup cost grew from 0.6.0, and the experimental layers are not why.** Measured with
  `node scripts/measure-bundle.mjs` (esbuild, minified, gzipped; react, lucide-react and
  mediabunny external): an editor app (`EditorProvider`, `Preview`, `Timeline` from
  `@elah/editor`) was **133 KiB gz**, against 68 KiB gz in 0.6.0, and is **112 KiB gz** once
  effects, generators, sequence clips, roto masks and audio Enhance load on first use (the
  script now counts a relative dynamic `import()` as a chunk, not as startup; the same method
  read 130.5 KiB before). The engine alone (`TimelineEngine`, `resolveTimeline`) is 45 KiB gz;
  engine plus `GpuRenderer` and `exportVideo` is 75 KiB gz. The growth is the renderer (effects, GPU transitions, masks and
  mattes, compound and sequence clips, generators), the resolver (keyframes, expressions,
  compounds) and media (audio enhancement, sequence decoding), all of which the editor app
  needs on first paint. `spec`, `html`, `ops` and `icons` cost a real app 0 bytes because
  the bundler drops what is not imported; imported on their own, `@elah/core/spec` is
  71 KiB gz and `@elah/core/html` is 44 KiB gz. Moving them to subpaths keeps them off the
  semver-stable root and stops the "everything exported" worst case (about 165 KiB gz for
  the editor barrel) from being mistaken for a startup number.
- **Optional renderer features load on first use.** Effects (the effect chain, all GPU
  effects, masks, blends, mattes and GPU transitions), generators, sequence clips, roto masks
  and the audio Enhance denoiser are separate chunks behind literal dynamic imports in
  `renderer/gpu/features.ts`. A project that uses none of them downloads none of their code.
  A frame that needs a feature still loading draws without it and the renderer redraws its
  last scene when the load finishes; exports are unchanged (the export worker keeps static
  imports, and the audio mix awaits the Enhance chunk first). New `prepareFeatures(project)`
  and `featuresForProject(project)` let a host load a project's features before frame 0.
- **`@elah/timeline`:** the zoom-anchor, content-width and track-compatibility modules now
  re-export from `@elah/core`, and the ruler computes its ticks with `computeRulerTicks`. No
  behaviour change. `playbackStore.setZoom` clamps with the shared `clampZoom`.
- **`@elah/core`:** `textStylePresetsStore.addPreset` ids come from `generateId()` instead of
  `crypto.randomUUID()`, which Hermes does not provide.
- **`@elah/react`:** value imports from core go through `@elah/core/engine`; the build no longer
  emits `*.test.tsx` files into `dist`.
- **`@elah/editor`:** `Preview` no longer drives the CSS `TransitionOverlay` (see Breaking).
  The unused `TransitionOverlay.tsx` file is still in the tree and is not exported.

## [0.6.0] — 2026-10-02

The premium editor port (PR #72), verified. Multiple video tracks, clip speed,
crop and corner radius, layered text animation with 14 templates, frame
sequences, stored project documents with media re-linking — and the eight
defects found while verifying it. `@elah/cli` 0.1.2 ships alongside (below).

### Added

- **`@elah/core`: reading a stored project.** `readProjectDocument(document)` turns
  stored JSON into a `Project` or throws `ProjectDocumentError`
  (`code: 'unreadable' | 'unsupported-version'`); it never returns half a project.
  `isReadableProjectDocument` is the boolean form. `PROJECT_VERSION` is the schema
  version this build writes. `relinkProjectMedia(project, assets)` points restored
  clips back at the media library by `src`, and reports clips whose `blob:`/`data:`
  source cannot be fetched again as `missing` (never dropped);
  `isRecoverableMediaSrc` and `missingMediaSummary` are its helpers.
  `engine.loadProject(project, { transport?, history? })` gained options, and the
  engine emits a `project:loaded` event (`ProjectLoadedEvent`) so the transport can
  rewind. `history: 'keep'` is for the re-link pass, which must not discard undo.
- **`@elah/core`: layered text and shape animation.** `TextAnimation` gained
  `inMotion` / `outMotion`, each a `MotionSpec` (opacity, `offsetX`/`offsetY`,
  `scale`, `rotation`, `ease`, `opacityEase`), so one end can drive several
  channels at once. New `TextAnimationEasing` curves include the overshooting
  `back-*`, `elastic-out` and `bounce-out`. The pure sampling helpers are public:
  `sampleTextAnimation`, `resolveRampFrames`, `motionForKind`,
  `TEXT_ANIMATION_KINDS`, `TEXT_ANIMATION_EASINGS`, `DEFAULT_TEXT_TRANSFORM`,
  `DEFAULT_SHAPE_TRANSFORM`.
- **`@elah/core`: text templates.** `BUILT_IN_TEXT_TEMPLATES` (14 looks),
  `findTextTemplate`, and `applyTextTemplate(template, clip)`, which returns the
  `Partial<Clip>` patch to hand to `engine.updateClip` so the change is undoable.
  Switching templates is clean rather than cumulative. `resolveTemplateRamp` and
  `MIN_/MAX_TEMPLATE_RAMP_FRAMES` clamp the ramp for hosts that build a timeline
  from a template.
- **`@elah/core`: two new vanilla stores.** `textStylePresetsStore`
  (+ `BUILT_IN_TEXT_STYLE_PRESETS`, `TextStylePreset`) holds reusable text looks.
  `clipLoadStore` reports which clips the preview cannot draw yet
  (`'loading' | 'error'`). It is renderer state, never part of the project,
  undo history or an autosave.
- **`@elah/core`: frame sequences.** An ordered set of images addressed by index
  (360 degree orbits, generated sets, storyboards): `createFrameSequence`,
  `frameAt`, `frameCount`, `normalizeFrameIndex`, `FrameSequenceController`
  (clock, drag-to-scrub, `wrap`/`pingpong` looping), `createFramePreloader`,
  `pickFrameSource`, `supportsImageType`, and `frameSequenceToProject`, which
  lays a sequence out as image clips so it can be edited and exported.
- **`@elah/core`: shared source-blob cache.** `sourceBlobCache`,
  `createSourceBlobCache`, `warmVideoSrc` de-duplicate video downloads between
  the demuxer and the preview.
- **`@elah/core`: media library.** `beginImportUrl` registers a remote URL as a
  `status: 'pending'` asset immediately and lets it resolve later.
  `determineAssetHasAudio`, `hasAudioDetermined` and `probeHasAudio` answer whether
  a video carries an audio track. `snapshotMediaLibrary`, `hydrateMediaLibrary`,
  `refreshMissingThumbnails` and `scheduleThumbnailById` carry the library across
  a page load. `MediaAsset` gained `MediaAssetAnalysis` / `MediaAssetTopObject`.
- **`@elah/core`: `PerfSummary`.** A once-a-second summary of the render loop's
  tick cost and overruns, silent unless the `PERF` trace channel is on
  (`__trace.on('PERF')`).
- **`@elah/core`: clip and track fields.** `Clip.speed` (0.25 to 4, video only;
  `duration` follows it and export honours it), `Clip.crop` (normalized source
  window) and `Clip.cornerRadius` (0 to 0.5). `Track.protected` (cannot be removed
  by the user) and `Track.pinned: 'bottom'` (`addTrack` keeps the lane below every
  non-pinned track). Both track fields are also accepted by `addTrack` options and
  `InitialTrackConfig`. `normalizeCrop`, `FULL_CROP`, `CropRect` and
  `transformFromContainRect` are exported for custom placement.
- **`@elah/core`: export.** `ExportOptions.outputHeight` is now the stage's *short*
  edge, so `1080` means 1920x1080 landscape and 1080x1920 portrait. The other
  edge is derived from the stage's aspect ratio and rounded to an even number.
- **`@elah/timeline`:** `TimelineRef.zoomAtAnchor(nextZoom)` zooms anchored on the
  playhead (or the viewport centre when it is off-screen).
  `growClipToAssetDuration(engine, clipId, expectedFallbackFrames, newDurationSec)`
  is the companion of core's `beginImportUrl`: insert a clip with a fallback length
  before its media has been probed, then grow it once the real duration is known.
  Clips that are still loading show a shimmer.
- **`@elah/react`:** `useClipLoadStore` and `useTextStylePresetsStore`.
- **`@elah/editor`:** the barrel now re-exports all of the above, including the
  vanilla `clipLoadStore` and `textStylePresetsStore` beside the other stores.
  Design tokens for the preview overlays and clip badge were added
  (`--elah-overlay-*`, `--elah-spinner-*`, `--elah-clip-badge-bg`,
  `--elah-toast-shadow`); see `docs/design-tokens.md`.

### Changed

- **Multiple video tracks are allowed.** The engine used to cap a project at one
  video track (`addTrack('video')` returned the existing one); it now adds another. Video tracks composite in
  track order (the topmost lane draws on top), and a new video track is placed
  directly below the last existing one.
- **Playback preferences are persisted by hand, not per frame.** Zoom, volume,
  mute, playback rate, loop and snap are still saved to `localStorage` under the
  same key and envelope, so nobody loses their settings. The write now happens
  when a preference changes; zustand's `persist` middleware re-serialised them on
  every frame of playback and every scrub move.
- **`serializeProject` / `deserializeProject` are unchanged for consumers.** They
  were briefly removed from `@elah/core` and the `@elah/editor` barrel during the
  port and have been restored as a facade over `readProjectDocument`, so no
  consumer break ships. One difference: a document with no `version` stamp is now
  read as version 1 instead of rejected, and a document from a newer build throws
  `ProjectDocumentError`. The `Not valid project JSON: ...` message for bad JSON
  is kept.
- **The timeline ruler and the rest of the UI share one timecode formatter.**
- **`@elah/timeline`: horizontal clip virtualisation.** Only clips inside the
  scrolled viewport (plus a margin, quantised to limit re-renders) are mounted.

### Fixed

- **Video frames could upload into a disposed GPU texture after a clip's source
  changed.** The layer read the texture before replacing the provider, so a
  re-pointed clip kept writing into the old one. A replaced provider also
  inherits the clip's reference count, so it is no longer exposed to idle
  eviction and prewarm seeks.
- **A preview loading spinner that could never clear** after a failed decoder
  re-open. The failure watcher is re-armed on the replacement provider, and
  disposing a provider always clears the clip's load state.
- **A borrowed frame stretched to the stage between clips.** The held-over frame
  is now fitted by its own dimensions, not the incoming clip's unknown ones.
- **The timeline ruler showed `00:90` instead of `01:30`.** Labels now roll over
  to minutes, show hours only when non-zero, and drop the frames segment on
  whole-second ticks. The ruler also uses the same content width as the lanes,
  so ticks no longer drift from clips at low zoom.
- **The clip loading shimmer had no CSS at all**, so a pending clip showed
  nothing. `.elah-clip-shimmer` and its sweep animation now ship in
  `@elah/timeline/styles`.
- **Horizontal clip virtualisation had been silently dropped** in the port;
  every clip on a long timeline was mounted.
- **Preview overlays and clip badges used hard-coded colours** and could not be
  themed; they now read the new `--elah-*` tokens.
- **Web playground: deleted imported media was resurrected from IndexedDB, and
  its object URLs were never revoked.** The library is now restored only for
  files a project still references, and every object URL the restore mints is
  revoked on cleanup.

### Documentation

- **Bundle sizes re-measured and the method fixed.** `BUNDLE_STRATEGY.md` now quotes
  what a browser downloads (esbuild, minified, gzipped, with code splitting) instead
  of the raw `tsc` output the old badges were based on: ~64 KiB at startup for the
  full SDK with the demuxer injected, ~11 KiB engine-only, and ~227 KiB on the quick-start
  path because `createDefaultDemuxerFactory` imports `mediabunny` statically. Reproduce
  with `node scripts/measure-bundle.mjs`.

- The package READMEs, `/docs/api`, and `docs/ai/ELAH_FOR_AI_AGENTS.md` now cover
  the API added above.

- **`playground/` is now `examples/`.** The three standalone apps that install
  `@elah/editor` from npm moved to [`examples/`](examples), and the `/examples`
  page on the site links to their new paths. The live in-browser playgrounds at
  `elah.dev/playground/*` are unrelated and unchanged.
- All three examples were verified against the published **0.4.1** packages from
  a clean registry install: `typecheck`, `dev`, and `build` for each, plus a full
  MP4 export in `examples/react` and `examples/next` under both the dev server
  and the production build.
- New [`examples/AGENTS.md`](examples/AGENTS.md) — the integration contract in one
  page, as an entry point for agents landing on the folder.
  [`docs/ai/ELAH_FOR_AI_AGENTS.md`](docs/ai/ELAH_FOR_AI_AGENTS.md) now links to
  the three runnable apps.
- New root `npm run verify:examples` — builds all three examples against the
  published packages. It is the only check in the repo that exercises the
  published tarballs rather than local source.
- The examples declare an inline favicon (no more `/favicon.ico` 404 in the
  console), and the Next example pins `turbopack.root` / `outputFileTracingRoot`
  so it stops inferring the monorepo root.
- `/docs/installation` corrected: the sample `package.json` pinned `^0.2.0`, the
  `transpilePackages` and Vite `optimizeDeps.exclude` lists omitted
  `@elah/react`, and the peer-dependency section did not mention `lucide-react`.

## `@elah/cli` [0.1.2] — 2026-10-02

### Changed

- Depends on `@elah/core@^0.6.0`. The build spec places every video clip on one
  video track, so overlapping video clips are a build error in the spec rather
  than something the engine rejects — the engine has allowed several video
  tracks since the multi-track change, but the spec has no way to say which
  one a clip belongs to.

## [0.4.1] — 2026-08-02

### Fixed

- **`@elah/core`: the MP4 export worker now resolves in installed packages.**
  `exportVideo` spawned the worker via `new URL('./ExportWorker.ts', …)`, but the
  published package ships only the compiled `ExportWorker.js`. The `.ts` specifier
  was unresolvable, so any consumer bundler (Turbopack, webpack, Vite) failed on
  the `@elah/editor` barrel — on first page load, not just on export. The build now
  rewrites the extension in `dist/` as its final step. **Apps no longer need a
  `postinstall` patch script**; if you added one, delete it.
- **`@elah/editor` re-exports the full public API.** 40+ identifiers were missing
  from the barrel, including ones the docs told you to import from it:
  `snapFrame`, `buildSnapPoints`, `resolveOverlapEdgeSnap`, `clipsOverlap`,
  `DEFAULT_OVERLAP_TOLERANCE`, `useTransitionsStore`, `useAssets`, `importBlob`,
  `createShapeClip`, `createFreehandClip`, `serializeProject`,
  `deserializeProject`, `warmImageSrc`, `preloadProjectImages`, `cn`,
  `EditorContext`, the vanilla stores (`tracksStore`, `playbackStore`,
  `selectionStore`, `transitionsStore`, `mediaLibraryStore`), and the
  corresponding types (`ActiveShapeClip`, `ActiveFreehandClip`,
  `CreateClipOptions`, `TimelineClassNames`, `TimelineDropState`,
  `UseMediaLibraryApi`, `EditorContextValue`, `BoundStoreHook`, and the store
  `*State`/`*Actions` pairs). Renderer and debug internals stay `@elah/core`-only
  by design.

### Documentation

- New [`AGENTS.md`](AGENTS.md) — the brief for coding agents working in this
  checkout — and [`docs/ai/ELAH_FOR_AI_AGENTS.md`](docs/ai/ELAH_FOR_AI_AGENTS.md),
  a single self-contained integration guide for AI tools that have no repo access.
- New `playground/minimal` example: the smallest complete custom editor UI.
- The `playground/next` and `playground/react` examples now import all three
  required stylesheets and declare the `lucide-react` peer dependency explicitly.
- Corrected the code samples on the `/examples` page, which did not compile
  against 0.4.x (`exportVideo` options, `ExportProgress` shape, the
  `DemuxerBackend` interface, and `ActiveTextClip` field access).

## [0.4.0] — 2026-07-28

### Added

- **New package `@elah/react`** — all React bindings in one place: the editor
  context (`EditorContext`, `useEditor`, `useTimelineEngine`,
  `usePlaybackEngine`), store hooks (`useTracksStore`, `usePlaybackStore`,
  `useSelectionStore`, `useTransitionsStore`, `useMediaLibraryStore`,
  `useMediaLibrary`/`useAssets`), and the audio hooks (`useAudioMixer`,
  `useMasterVolume`, `useTrackLevels`). Store hooks keep the imperative
  surface too (`useTracksStore.getState()` still works).
- `@elah/editor` now also re-exports the audio hooks.
- Test coverage for `@elah/react` (binding-layer tests for every hook,
  mirroring the `vitest`/`jsdom` conventions already used by
  `@elah/timeline` and `@elah/editor`).

### Changed

- **BREAKING (`@elah/core`)**: core is now truly framework-agnostic — zero
  React in its module graph (fixes [#42](https://github.com/elahlabs/elah/issues/42);
  importing `@elah/core` from Vue/Nuxt/Node no longer requires React).
  - All React hooks moved to `@elah/react` (re-exported unchanged by
    `@elah/editor`, so `@elah/editor` users are unaffected).
  - The Zustand mirrors are now vanilla stores exported as `tracksStore`,
    `playbackStore`, `selectionStore`, `transitionsStore`, and
    `mediaLibraryStore` (previously the React-bound `useXStore` exports).
    Imperative call sites migrate as
    `useTracksStore.getState()` → `tracksStore.getState()`.

## `@elah/cli` [0.1.1] — 2026-07-12

### Added

- **`elah serve` welcome page** — `GET /` now serves an HTML orientation page
  (route table, browser-connected status, copy-paste `/render` example)
  instead of a bare 404, for humans who open the listen address in a browser.
- **Copy-paste startup example** — `elah serve` now prints a ready-to-run
  render example on startup: `curl` on macOS/Linux, `Invoke-RestMethod` on
  Windows (PowerShell's `curl` alias doesn't accept `-H`/`-d`).

## [0.3.2] — 2026-07-12

Documentation only — reworked `@elah/core`, `@elah/timeline`, and
`@elah/editor` READMEs to cross-link `@elah/cli` and stay consistent with its
README pattern. No code changes.

## [0.3.1] — 2026-07-11

License changed from the Elah Community License (ECL) v1.0 to Apache-2.0,
across `@elah/core`, `@elah/timeline`, and `@elah/editor`. Copyright remains
with Elah Labs Private Limited. No code changes.

## `@elah/cli` [0.1.0] — 2026-07-11

Initial release of `@elah/cli` — a headless CLI and self-hosted render
server. Rendering runs core's real `exportVideo` pipeline in headless
branded Chrome, so output is bit-identical to the browser editor by
construction.

### Added

- **CLI commands** — `elah split`, `trim`, `export`, and `build` for headless
  project editing and MP4 export.
- **`elah serve`** — a long-lived HTTP render server (`POST /render`: spec
  JSON in, MP4 bytes out) with a warm browser and `--concurrency` control.
- **Seconds-based build spec** for programmatic and AI-generated projects,
  with path-addressed validation errors a generating model can self-correct
  from.
- **Library API** — `build`, `exportProject`, `createRenderSession`,
  `startServe`, `validateSpec`, `probeMedia` — importable directly from Node.
- Dockerfile (`packages/cli/Dockerfile`) with branded Chrome + fonts,
  entrypoint `elah serve --host 0.0.0.0 --port 8080`.

## [0.3.0] — 2026-07-03

A feature release focused on **multi-track audio**, **shapes & freehand
drawing**, a **programmatic asset-insertion API**, and a fully **themeable
timeline**. Additive — no breaking changes to the 0.2.x public API.

### Added

#### `@elah/core`

- **Multi-track audio playback.** `AudioPlaybackController` now mixes multiple
  audio tracks against the `PlaybackEngine` clock with independent per-clip
  control, replacing the single-track v1 constraint.
- **Audio mixer hooks** — `useAudioMixer`, `useTrackLevels`, `useMasterVolume`
  for building level meters and volume UIs, plus a pluggable
  `defaultAudioResolver` / `AudioResolver` for custom audio fetch + decode.
- **Shape clips** — `createShapeClip`, `ShapeVariant`, and a GPU `ShapeLayer`.
  `Scene` now exposes `scene.shapes` (`ActiveShapeClip`).
- **Freehand clips** — `createFreehandClip` and a GPU `FreehandLayer`, surfaced
  on `Scene` as `scene.freehand` (`ActiveFreehandClip`).
- **Image decode cache warming** — `warmImageSrc`, `preloadProjectImages`, and
  the `ImageLoader` / `LoadedImage` types for eliminating first-paint stalls on
  image clips.
- **Expanded asset import** — `importUrl` and `importBlob` alongside
  `importFiles`; new `useAssets` hook, `mediaDragKindMime` helper, and
  `ImportUrlOptions` / `ImportBlobOptions` / `UseMediaLibraryApi` types.
- **`transformFromCoverRect`** placement helper (object-fit **cover**) added
  next to the existing `transformFromContainRect`.

#### `@elah/timeline`

- **Programmatic insertion API** — `insertMediaAsset` and `insertElement` place
  assets and elements on the timeline without a drag gesture, returning a typed
  `InsertAssetResult`. Powers tap-to-add on touch devices.
- **`classNames` slot API + `cn` util** — every timeline sub-component accepts a
  `TimelineClassNames` slot map so consumers can restyle without forking. A
  passed class always wins over defaults.
- **`--elah-*` CSS-variable theming** with a backward-compatible `timelineTheme`
  facade (deprecated in favor of the `classNames` prop / CSS variables). See
  [THEMING.md](./packages/timeline/THEMING.md).
- New public types — `TimelineDropState`, `ShapeVariant`.

#### `@elah/editor`

- **`SourcePanel`** — a new, fully slot-styled source/asset browser component
  (`SourcePanelProps`, `SourcePanelClassNames`) with an asset **activation** API
  (`AssetActivationPayload`, `AssetActivationHandler`) for tap-to-add flows.
- Re-exports all of the new `core` and `timeline` API above, including
  `insertMediaAsset` / `insertElement`, `importUrl`, audio mixer hooks, and
  `transformFromCoverRect`.

### Changed

- Timeline UI redesigned (clips, headers, ruler, playhead) to the Figma
  cyan / cool-navy theme; editor retinted to match.
- Timeline gestures migrated to **pointer events** (unifying mouse + touch) with
  pinch-to-zoom and touch tap-to-add.
- Video tracks capped at one and track-lock enforced on edits (single video
  track remains the v1 renderer constraint; audio is now multi-track).
- Export pipeline hardened: re-entrancy guard on `exportVideo`, improved audio
  mixing, and shape/freehand parity with the live renderer.

### Fixed

- Backward-seek frame-cache stability and video-decoder pivot handling.
- Generated clips can grow left without being clamped by source bounds.

## [0.2.1] — 2026-06-15

- Documented measured bundle sizes and improved package build scripts.

## [0.2.0]

- First public release of the three-package split: `@elah/core`,
  `@elah/timeline`, `@elah/editor`.

[1.0.0]: https://github.com/elahlabs/elah/releases/tag/v1.0.0
[0.6.0]: https://github.com/elahlabs/elah/releases/tag/v0.6.0
[@elah/cli 0.1.2]: https://github.com/elahlabs/elah/releases/tag/cli-v0.1.2
[0.4.1]: https://github.com/elahlabs/elah/releases/tag/v0.4.1
[0.4.0]: https://github.com/elahlabs/elah/releases/tag/v0.4.0
[0.3.2]: https://github.com/elahlabs/elah/releases/tag/v0.3.2
[0.3.1]: https://github.com/elahlabs/elah/releases/tag/v0.3.1
[0.3.0]: https://github.com/elahlabs/elah/releases/tag/v0.3.0
[0.2.1]: https://github.com/elahlabs/elah/releases/tag/v0.2.1
[0.2.0]: https://github.com/elahlabs/elah/releases/tag/v0.2.0
[@elah/cli 0.1.1]: https://github.com/elahlabs/elah/releases/tag/cli-v0.1.1
[@elah/cli 0.1.0]: https://github.com/elahlabs/elah/releases/tag/cli-v0.1.0
