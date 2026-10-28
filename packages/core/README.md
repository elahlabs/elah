# @elah/core

Framework-agnostic video timeline engine. No React. No renderer. Just the pure logic layer — project state, playback, frame resolution, and media management.

Used internally by `@elah/react`, `@elah/timeline`, and `@elah/editor`, but can be consumed directly for custom rendering pipelines or headless environments.

React hooks are **not** in this package — they live in [`@elah/react`](https://www.npmjs.com/package/@elah/react), which wraps the stores below for component use.

[![npm](https://img.shields.io/npm/v/@elah/core)](https://www.npmjs.com/package/@elah/core)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/elahlabs/elah/blob/main/LICENSE)

---

## Install

```bash
npm install @elah/core
```

**Package size:** about 1.2 MB as an npm tarball (3.0 MB unpacked), of which roughly half is the bundled fonts, which load only if you opt in (see [Fonts](#fonts-and-loading-from-a-cdn)). The code is tree-shakeable (`sideEffects: false`); import `@elah/core/engine` if you do not need the renderer or the codec. Runtime deps: `immer`, `zustand` and `mediabunny` (`^1.50.8`), which the demuxer and export worker load lazily on first decode or export, except through `createDefaultDemuxerFactory`, which imports it statically. What a real app downloads (esbuild, minified, gzipped; React, lucide-react and mediabunny external): an editor app (`EditorProvider`, `Preview`, `Timeline` from `@elah/editor`) is about **112 KiB gz**, up from 68 KiB in 0.6.0 (it was 133 KiB before effects, generators, sequence clips, roto masks and audio Enhance became chunks that load on first use; `prepareFeatures(project)` loads a project's features up front). The engine alone (`TimelineEngine`, `resolveTimeline`) is about 45 KiB gz, and engine plus `GpuRenderer` and `exportVideo` about 75 KiB gz. The AI-facing layers below cost an app that does not import them nothing. [BUNDLE_STRATEGY.md](../../BUNDLE_STRATEGY.md) explains how bundle size is measured (`node scripts/measure-bundle.mjs`) and what is left in startup.

**Stability (1.0.0):** the exports of the root entry and of `@elah/core/engine` follow semver. Three AI-facing layers are **live** in 1.0 and follow semver too. They are not exported from the root; import them from their own entries: `@elah/core/spec` (VideoSpec, components, systems, `specVocabulary`), `@elah/core/html` (HTML/CSS scene conversion), `@elah/core/ops` (the op vocabulary and `describe*` helpers) and `@elah/core/icons` (the vendored icon set). Each is marked where it appears below. A project is written as document version 1 to 5 (see [Save and restore](#save-and-restore)); 0.6.x cannot open a document that uses the newer clip types.

---

## What's inside

| Module | Description |
|---|---|
| `TimelineEngine` | Manages project state — tracks, clips, undo/redo |
| `PlaybackEngine` | Frame-accurate playback clock |
| `resolveTimeline` | Pure function — project → active scene at a given frame |
| `GpuRenderer` | WebGL2 renderer for video, image, text, shape, and freehand layers |
| `AudioPlaybackController` | Multi-track audio mixer on the playback clock |
| `tracksStore` | Vanilla Zustand store mirroring project state — bind it with `useTracksStore` from `@elah/react` |
| `playbackStore` | Vanilla Zustand store mirroring playback state — bind it with `usePlaybackStore` from `@elah/react` |
| `selectionStore` | Vanilla Zustand store for clip selection — bind it with `useSelectionStore` from `@elah/react` |
| `transitionsStore` | Vanilla Zustand store mirroring transitions — bind it with `useTransitionsStore` from `@elah/react` |
| `textStylePresetsStore` | Reusable text looks (built-ins plus user presets) — bind it with `useTextStylePresetsStore` from `@elah/react` |
| `clipLoadStore` | Which clips the preview cannot draw yet (`'loading'` / `'error'`). Renderer state, never saved or undoable — bind it with `useClipLoadStore` from `@elah/react` |
| `mediaLibraryStore` | Media asset registry (vanilla store) — bind it with `useMediaLibrary` from `@elah/react` |
| `importFiles` / `importUrl` / `importBlob` | Import local files, remote URLs, or blobs into the media library |
| `beginImportUrl` | Like `importUrl` but returns a `status: 'pending'` asset immediately, so a clip can be placed before the media is probed |
| `determineAssetHasAudio` / `probeHasAudio` | Whether a video carries an audio track |
| `serializeProject` / `deserializeProject` | Save the engine's project as JSON and load it back (a facade over `readProjectDocument`) |
| `readProjectDocument` / `relinkProjectMedia` | Validate a stored document into a `Project`; re-point restored clips at the media library |
| `BUILT_IN_TEXT_TEMPLATES` / `applyTextTemplate` | 14 text looks with layered entry/exit motion; `applyTextTemplate(template, clip)` returns an undoable `Partial<Clip>` patch |
| `sampleTextAnimation` | Pure sampler for text/shape entry-exit animation (`TextAnimation`, `MotionSpec`) |
| `createFrameSequence` / `FrameSequenceController` | Ordered image sets (360° orbits, storyboards) with scrub, loop and preload; `frameSequenceToProject` makes one editable |
| `snapshotMediaLibrary` / `hydrateMediaLibrary` | Turn the media library into storable entries and put them back (ids kept) after a page load; storage is yours |
| `sourceBlobCache` | Shared cache that de-duplicates video downloads between the demuxer and preview |
| `PerfSummary` | Once-a-second render-loop cost summary; silent unless the `PERF` trace channel is on |
| `exportVideo` | Export the timeline via a web worker: MP4 (default), WebM, GIF or a PNG sequence |
| `Clip.keyframes`, `TEXT_ANIMATION_EASINGS`, `SPRING_PRESETS`, `MOTION_PRESETS` | The motion layer: keyframes on every transform channel, 31 named eases plus cubic-bezier, steps and springs, stagger, motion paths, text animators, scramble, repeat/yoyo, skew, 3D tilt (see [Motion](#motion-keyframes-springs-stagger-paths)) |
| `createGenerator`, `GENERATOR_REGISTRY` | Generator clips: particles, energy lines, light leak, lens flare, gradient background, counter, bar chart, progress bar |
| `EFFECT_REGISTRY`, `EFFECT_BUNDLES` | 23 GPU effects, bundles and looks; `adjustment` clips apply them to everything beneath |
| `TRANSITION_REGISTRY` | The nine transitions, in picker order |
| `createCompoundClip`, `nestClips`, `createSequenceClip` | Compound clips (a nested project as one clip) and sequence clips (animated image or numbered frames) |
| `Clip.audio`, `clipAudioGain`, `enhancePlan` | Mute, boost, fades and Enhance; one envelope for preview and export |
| `svgToProject`, `lottieToClip` | Import SVG and Lottie as editable clips and keys |
| `validateScene`, `sceneToClip` (from `@elah/core/html`) | **Live.** HTML/CSS scene subset: validate, then convert a measured scene to one compound clip |
| `compileVideoSpec`, `buildVideo`, `layProject`, `specVocabulary` (from `@elah/core/spec`) | **Live.** VideoSpec: a seconds-based JSON document a model writes, compiled to a `Project` |
| `applyOps`, `sanitizeOps`, `EDITOR_OP_NAMES`, `describeProject` (from `@elah/core/ops`) | **Live.** 57 typed editor ops for a model to edit a project |
| `packageFontsBaseUrl` | Where the package's own copies of the 12 bundled fonts live (opt-in) |

These stores are **vanilla** (`zustand/vanilla`) — no React, subscribable from anywhere (`store.getState()`, `store.subscribe()`). They are also **module-level singletons**: one `tracksStore`, one `playbackStore`, etc. per JS realm. `@elah/editor`'s `<EditorProvider>` wires each `TimelineEngine`/`PlaybackEngine` instance it creates into these same shared stores, so only **one active project per page** is supported today — mounting two `<EditorProvider>` (or two manually-wired engines) at once will have them overwrite each other's state in the stores. Multiple independent editors on one page need separate tabs/iframes/windows until scoped stores land.

---

## Quick start

```ts
import { TimelineEngine, PlaybackEngine, resolveTimeline } from '@elah/core'

const engine = new TimelineEngine({ fps: 30, stage: { width: 1920, height: 1080 } })
const playback = new PlaybackEngine({ fps: 30, getTotalFrames: () => engine.getTotalFrames() })

// Add a track, then a clip onto it. addClip takes a single typed
// options object (a discriminated union keyed on `type`) and returns the Clip.
const track = engine.addTrack('video')
engine.addClip({ trackId: track.id, type: 'video', src: 'video.mp4', startFrame: 0, durationFrames: 90 })

// Resolve the scene at frame 15 — pure (frame, project) → Scene.
const scene = resolveTimeline(15, engine.getProject())
```

---

## Using the engine without a browser

`@elah/core/engine` is the browser-free subset: the engine, resolver, `PlaybackEngine`, the
stores, clip factories, project documents, and the pure placement and timeline math. It leaves
out the WebGL2 renderer, WebCodecs decode, the media importers and the MP4 export, which is the
one module using `import.meta`. Use it from React Native (Metro and Hermes reject `import.meta`),
workers, or Node:

```ts
import { TimelineEngine, resolveTimeline } from '@elah/core/engine'
```

Both entries share module instances, so `tracksStore` from either is the same object. A test,
`src/engine.no-browser.test.ts`, fails if anything browser-bound becomes reachable from it.

---

## Save and restore

`serializeProject` / `deserializeProject` are the simple pair. Underneath them,
`readProjectDocument` is the total reader: it returns a `Project` or throws
`ProjectDocumentError` (`code: 'unreadable' | 'unsupported-version'`), never half a
project. A document with no `version` stamp reads as version 1; one from a newer
build (`PROJECT_VERSION`, now 5) is refused. A project is stamped with the *lowest* version that can
hold what it uses: 2 for `adjustment` clips; 3 for generators, shape draw-on and the six newer
transitions; 4 for compound clips; 5 for sequence clips. A project that uses none of them is still
version 1 and opens in 0.6.x.

```ts
import {
  serializeProject, deserializeProject,
  readProjectDocument, relinkProjectMedia, missingMediaSummary,
} from '@elah/core'

const json = serializeProject(engine)
deserializeProject(engine, json) // throws, leaving the engine untouched, if unreadable

// Or in two steps, so a refusal can be shown before the editor is cleared:
const project = readProjectDocument(JSON.parse(json))
engine.loadProject(project) // options: { transport?: 'rewind' | 'keep', history?: 'reset' | 'keep' }

// Media imported from disk is a blob: URL and does not survive a reload.
// After the library is rebuilt, repair the clips' assetIds and report what is gone:
const { project: repaired, relinked, missing } = relinkProjectMedia(engine.getProject(), assets)
engine.loadProject(repaired, { transport: 'keep', history: 'keep' })
const note = missingMediaSummary(missing) // e.g. "a.mp4, b.mp4 and 3 more"
```

The engine emits `project:loaded` (`ProjectLoadedEvent`) after every load, carrying the
new project and the requested `transport`.

---

## Text templates and animation

```ts
import { BUILT_IN_TEXT_TEMPLATES, findTextTemplate, applyTextTemplate } from '@elah/core'

const template = findTextTemplate(BUILT_IN_TEXT_TEMPLATES[0].id)!
engine.updateClip(clip.id, trackId, applyTextTemplate(template, clip)) // one undo entry
```

Applying a template is clean, not cumulative: fields the template does not use are
cleared. `TextAnimation` keeps the single-kind `in`/`out` enum and adds `inMotion` /
`outMotion` (a `MotionSpec`: `opacity`, `offsetX`, `offsetY`, `scale`, `rotation`,
`ease`, `opacityEase`), which replace the enum when present.

Two things a template carries are **data only**: `stagger` (split a line into clips that
enter one after another) and `tracking` (fake letterspacing). `applyTextTemplate` ignores
them and nothing in these packages runs them; a host that wants either builds it from the
template itself.

---

## Transitions

```ts
engine.addTransition({ fromClipId, toClipId, trackId, kind: 'slide', durationFrames: 12, direction: 'left' })
```

`kind` is one of nine: `'fade' | 'slide' | 'wipe' | 'zoom' | 'spin' | 'whip' | 'glitchCut' | 'warpDissolve' | 'lumaWipe'`
(`TRANSITION_REGISTRY` lists them with a label and hint). `slide` and `whip` take a `direction`
(`'left' | 'right' | 'up' | 'down'`, default right); the others ignore it. The resolver keeps both
clips in the scene and lists the transition in `scene.transitions` with its eased progress; the
WebGL2 renderer composites the pair with one shader, so both clips keep playing with their effects, in
preview and in export. A project that uses only `fade`, `wipe` and `slide` still exports in a runtime whose worker
has no WebGL2 (a 2D snapshot path, left/right slide only); a project that uses any other kind needs WebGL2 in the
worker, and its export fails fast without it. Using any kind beyond the first three stamps the project as
document version 3.

---

## Motion: keyframes, springs, stagger, paths

Animation is data on the clip. Keyframe frames are integers **relative to the clip's start**, so moving
a clip moves its keys; trim, speed and split remap them for you.

```ts
engine.updateClip(title.id, trackId, {
  keyframes: {
    channels: {
      x: {
        source: { kind: 'keyframes' },
        keys: [
          { id: 'k0', frame: 0, value: 0.2, easing: 'linear' },
          { id: 'k1', frame: 30, value: 0.8, easing: 'back-out' }, // the curve INTO this key
        ],
      },
    },
  },
})
```

A key's `easing` is one of `TEXT_ANIMATION_EASINGS` (sine, quad, cubic, quart, quint, expo, circ,
back, elastic and bounce, each in / out / in-out, and `linear`). A key can instead carry a raw
`easingBezier`, `steps` (a staircase), `hold`, or a closed-form `spring` (`SPRING_PRESETS`: gentle,
snappy, bouncy, stiff, wobbly). The pure helpers that write keys (`setKeysEasingAtFrame`,
`moveKeysAtFrame`, `repeatKeysPatch` for repeat and yoyo, `staggerOffsets` for stagger from the start,
end, centre, edges or at random and across a grid, `scrambleText`) and the 36 `MOTION_PRESETS` are public.
Colour and path channels are keyable too, and `setChannelExpression` drives a channel from an
expression (`wiggle`, `loop`, `sin`, and so on).

Skew (`skewX`, `skewY`) is a keyable channel. 3D tilt (`rotateX`, `rotateY`) works on video, image,
sequence and compound clips and is refused on text, shapes and freehand. A clip can also travel a path
(the `motion.progress` channel). The one-line `data-motion` grammar that the HTML scene layer reads
is built from the same keys.

---

## New clip types, effects and generators

```ts
import { createGenerator } from '@elah/core'

const confetti = engine.addClip({
  trackId, type: 'generator', name: 'Confetti', startFrame: 0, durationFrames: 90,
  generator: createGenerator('particles', { count: 80 }),
})
const grade = engine.addClip({ trackId: overlayTrackId, type: 'adjustment', name: 'Grade', startFrame: 0, durationFrames: 90 })
```

- **`adjustment`**: no picture of its own; its effects, mask and blend apply to everything composited beneath it.
- **`generator`**: eight built in (`GENERATOR_REGISTRY`).
- **`compound`**: a nested project played as one clip (`createCompoundClip`; `engine.nestClips` / `unnestClip` turn a selection into one and back; nesting is capped at `MAX_COMPOUND_DEPTH`).
- **`sequence`**: an animated image or a numbered frame set, picked by frame index so preview and export show the same frame.

Effects are 23 GPU passes (`EFFECT_REGISTRY`: colour grade, gaussian blur, vignette, grain, RGB split,
bloom, glow, lens and wave distortions, VHS, CRT, glitch, pixelate, motion blur and more), with
`EFFECT_BUNDLES` as one-click looks, plus masks, track mattes and blend modes. Using these raises the
document version (see [Save and restore](#save-and-restore)). `@elah/editor` plays, saves and exports
these clips; it has no editing UI for them yet.

---

## Scenes and VideoSpec for models (live in 1.0)

Two ways for a model to write a video that lands as ordinary, editable clips. Both are
**live** in 1.0, on their own entries so the root stays small.

- **HTML/CSS scenes** (`import { validateScene, sceneToClip } from '@elah/core/html'`): the model writes an HTML fragment and a stylesheet in a whitelisted subset.
  `validateScene({ html, css })` returns violations that name the supported substitute.
  `sceneToClip(measuredScene, { fps })` converts a browser-**measured** scene (boxes, line breaks
  and resolved styles) into one compound clip of native clips and keys. Measuring is the host's job;
  this package ships no DOM measurer.
- **VideoSpec** (`from '@elah/core/spec'`): a seconds-based JSON document. `compileVideoSpec(spec)` returns `{ project, issues }`
  and never throws; `buildVideo(authoredSpec)` also expands components and polishes;
  `layProject(engine, project)` lays the result onto a live engine as one undo step;
  `specVocabulary()` renders the vocabulary block for a prompt.

Worked, tested examples of both are in
[`docs/ai/ELAH_FOR_AI_AGENTS.md`](https://github.com/elahlabs/elah/blob/main/docs/ai/ELAH_FOR_AI_AGENTS.md#11-writing-videos-and-scenes-with-a-model).
Edits go through typed ops (`from '@elah/core/ops'`): `sanitizeOps(raw, project)` repairs a model's op list and `applyOps(engine, ops)`
applies it as one undo step.

---

## Fonts and loading from a CDN

Text clips name one of 12 bundled families (`FONT_REGISTRY`: Inter, Montserrat, Poppins, Space Grotesk,
Playfair Display, DM Serif Display, Bebas Neue, Anton, Oswald, Archivo Black, Roboto Mono, Caveat; Latin
subset only, SIL OFL 1.1). The default is to load them from `/fonts/` on **your** host. The woff2 files ship
in this package under `fonts/<id>/`, so either copy that folder to your public `fonts/` directory, or, for an
unbundled import (a CDN, a native-ESM dev server), point the loader at the package itself:

```ts
import { exportVideo, packageFontsBaseUrl } from '@elah/core'

await exportVideo(project, { fonts: { baseUrl: packageFontsBaseUrl() } })
```

The export, audio-analysis and capability-probe workers start from a cross-origin module URL through a
blob module worker (jsDelivr's `/+esm` build included); bundled hosts take the ordinary
`new Worker(new URL(...))` path. Use `packageFontsBaseUrl()` only for an unbundled import: a bundler rewrites
`import.meta.url`.

---

## Frame sequences

```ts
import { createFrameSequence, frameSequenceToProject } from '@elah/core'

const seq = createFrameSequence({ frames: urls.map((src) => ({ src })), fps: 12, loop: 'wrap' })
engine.loadProject(frameSequenceToProject(seq, { holdFrames: 6 })) // edit/export as image clips
```

`FrameSequenceController` drives a sequence from a clock or a drag;
`createFramePreloader` warms frames ahead of the index; `pickFrameSource` chooses
the right responsive candidate.

---

## Clip and track fields

| Field | Applies to | Meaning |
|---|---|---|
| `Clip.speed` | video | Playback multiplier, clamped to 0.25–4 (`engine.setClipSpeed`); timeline length follows it |
| `Clip.crop` | video, image | Normalized source window `{ x, y, width, height }`; see `normalizeCrop`, `FULL_CROP` |
| `Clip.cornerRadius` | video, image | Rounded-corner mask, 0–0.5 of the shorter side |
| `Track.protected` | any | The user cannot remove the track |
| `Track.pinned` | any | `'bottom'` keeps the lane below every non-pinned track; `addTrack` honours it |

Any number of video tracks is allowed; they composite in track order, topmost lane on top.

---

## Keeping the media library across a page load

```ts
import {
  mediaLibraryStore, snapshotMediaLibrary, hydrateMediaLibrary, refreshMissingThumbnails,
} from '@elah/core'

// Save: plain entries (assets still being probed are skipped). Where they go is up to you.
const entries = snapshotMediaLibrary(mediaLibraryStore.getState())

// Restore: ids are kept, so restored clips resolve their `assetId` directly.
const { hydrated, needsThumbnail } = hydrateMediaLibrary(entries, {
  referencedSrcs: new Set(/* every media clip's src in the project being opened */),
})
refreshMissingThumbnails(needsThumbnail) // cosmetic, fire-and-forget
```

This carries asset metadata and thumbnails only. A file imported from disk is a `blob:` URL
that dies with the session; its bytes are not stored, and `relinkProjectMedia` reports such
clips as `missing`.

---

## Diagnostics

```ts
import { PerfSummary } from '@elah/core'
// In the browser console: __trace.on('PERF') turns the once-a-second summary on.
```

`PerfSummary` measures the whole render tick (phase timings, budget overruns), not
just GPU upload. It allocates nothing while the `PERF` channel is off.

---

## Clip factories

Standalone builders that return a fully-normalized `Clip` object (rounded frames, default volume/opacity, generated id) without an engine — useful for headless pipelines that feed `resolveTimeline` directly. When you have an engine, prefer `engine.addClip(options)` instead, which builds the clip and records an undo entry.

```ts
import {
  createVideoClip,
  createAudioClip,
  createTextClip,
  createImageClip,
  createShapeClip,
  createFreehandClip,
} from '@elah/core'

const clip = createVideoClip({ trackId: 'v1', src: 'video.mp4', startFrame: 0, durationFrames: 90 })
const rect = createShapeClip({
  trackId: 'el1',
  startFrame: 0,
  durationFrames: 90,
  shape: { shapeKind: 'rect', shapeFill: '#22d3ee' }, // 'rect' | 'circle' | 'triangle'
})
```

---

## Export

```ts
import { exportVideo } from '@elah/core'

const blob = await exportVideo(engine.getProject(), {
  videoBitrate: 8_000_000,
  outputHeight: 1080, // short edge — optional, defaults to the stage's own
  onProgress: ({ frame, totalFrames }) => console.log(frame, '/', totalFrames),
})
```

`outputHeight` is the stage's *short* edge (`1080` = 1920×1080 or 1080×1920); the other
edge follows the aspect ratio and is rounded to an even number, as codecs require.

`container` picks the output: `'mp4'` (default), `'webm'` (add `transparent: true` for an alpha channel, accepted only where the
browser's own encode-and-decode check passes), `'gif'` (`gifFps`, default 15, no audio) or `'png-sequence'` (a ZIP, or your own
`frameSink`). `videoCodec` is `'avc' | 'hevc' | 'av1' | 'vp9' | 'vp8'` where the browser can encode it, and
`range: 'inOut'` exports only the marked in/out range. Export needs WebCodecs and `OffscreenCanvas`: in practice Chrome or Edge.

---

## Links

- [Website](https://www.elah.dev)
- [GitHub](https://github.com/elahlabs/elah)
- [React bindings — @elah/react](https://www.npmjs.com/package/@elah/react)
- [Full SDK — @elah/editor](https://www.npmjs.com/package/@elah/editor)
- [Headless CLI — @elah/cli](https://www.npmjs.com/package/@elah/cli)
- [License](https://github.com/elahlabs/elah/blob/main/LICENSE)
- [Commercial licensing](mailto:paul@elah.dev)
