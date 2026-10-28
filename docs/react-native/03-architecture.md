# 03 — Architecture of `@elah/react-native`

> Status: proposed. Last verified: 2026-10-06 against `dev` @ `e9fe11c`.
> Read [`ARCHITECTURE.md`](../../ARCHITECTURE.md) first; this document only says what changes
> on mobile. Where it is silent, the web architecture applies.

## 1. Principles that carry over, and two that are added

The six design principles P1 to P6 and the renderer invariants I1 to I8 in
[`packages/core/src/renderer/EVOLUTION.md`](../../packages/core/src/renderer/EVOLUTION.md) hold
unchanged. In particular:

- **Time is integer frames.** `seek(ms)` APIs on native players are converted at the edge with
  `framesToSeconds`; nothing stores milliseconds.
- **One mutation funnel.** Gestures call `engine.previewClip` per move and
  `engine.commitInteraction()` on release. Nothing writes to a store.
- **The resolver is pure, and renderers read only `Scene`.** The Skia renderer never imports
  `Project`, the engine or the stores.
- **`render(scene)` is synchronous**, equal `Scene` references are a no-op, decode is
  out-of-band, a cache miss draws the last frame.

Two mobile-specific additions:

- **M1. No React commit per frame.** Playback updates a Skia surface or a Reanimated shared
  value; React renders only on transport events and edits. The web `<Preview>` already works
  this way; on a phone the budget is tighter.
- **M2. Native code is a leaf.** The native module decodes, probes, encodes and mixes. It never
  reads a `Project`, never knows what a `Track` is, and never calls back into the engine. It is
  fed frame indices and file URIs; it returns frames and files.

## 2. Package layout

```
packages/
  core/            @elah/core          + a browser-free entry: @elah/core/engine     (RN-P1)
  react/           @elah/react         + EditorProvider moved here, re-exported by editor (RN-P2)
  react-native/    @elah/react-native  NEW: Skia renderer, Preview, Timeline, import, export,
                                       the native module (ios/, android/, cpp/ as needed)
apps/
  mobile/          Expo (SDK 57) dev harness: the mobile apps/web. Workspace member.
examples/
  react-native/    Installs @elah/react-native from npm. Added last (RN-P11).

Dependency rule:  core  <-  react  <-  react-native        (react-native never imports timeline or editor)
```

**One package, not several.** Renderer, timeline, import and the native module share one
`package.json` and one version. `ARCHITECTURE.md` section 9 (A6) is the rule; a second package
appears only when a layer has its own audience. The native module is a folder inside the package
(`create-react-native-library` layout), not its own npm package, until a non-Elah consumer wants
it.

**Versioning.** `@elah/react-native` versions independently, like `@elah/cli`, starting at
0.1.0, and depends on the first `@elah/core` that ships the `engine` entry (0.7.0 if additive).
It is not part of the four-package lockstep until it reaches feature parity.

**Dependencies as published:**

| Kind | Package | Why |
|---|---|---|
| dependency | `@elah/core` | the engine, via `@elah/core/engine` |
| dependency | `@elah/react` | context + store hooks, unchanged |
| peer | `react`, `react-native` | host-owned |
| peer | `react-native-skia` (3.x) | renderer |
| peer | `react-native-reanimated`, `react-native-worklets` | required by Skia v3; used for the frame-publishing shared value |
| peer | `react-native-gesture-handler` | timeline gestures |
| optional peer | `react-native-audio-api` | audio playback (D5) |
| none | `mediabunny`, `immer`, `zustand` | never imported directly here; core owns them |

## 3. The `@elah/core/engine` entry

A second barrel, `packages/core/src/engine.ts`, exported as `"./engine"` in core's `exports`
map, that re-exports exactly the portable surface from [`02-platform-audit.md`](./02-platform-audit.md):

- `types/*`, `editor/TimelineEngine`, `editor/projectDocument`, `project/serialization`
- `playback/PlaybackEngine`
- `resolver/resolveTimeline`, `resolver/scene` (types), `resolver/textAnimation`
- `elements/*` (factories, `textTemplates`), `actions/*`, `utils/*`
- `stores/*` (all seven vanilla stores) and `assets/types`, `assets/store`
- `renderer/types` (`Renderer`), `renderer/gpu/layers/drawRect`, `objectFit`, `textLayout`,
  `renderer/gpu/viewport`
- `frames/frameSequence`, `frames/FrameSequenceController`, `frames/frameSequenceProject`
- `debug/trace`, `debug/PerfSummary`

It must **not** reach `export/*`, `renderer/gpu/GpuRenderer` or any layer class, `media/*`,
`assets/importFiles`, `assets/hasAudio`, `assets/librarySnapshot` (until its thumbnail import is
injected), `frames/framePreloader`, `frames/frameSource`.

A guard test, `packages/core/src/engine.no-browser.test.ts`, modelled on
`no-react-imports.test.ts`, walks the import graph from `engine.ts` and fails if any reached file
(a) is outside an allowlist or (b) contains `import.meta`, `new Worker`, `OffscreenCanvas`,
`VideoDecoder`, `document.` or `window.` outside a `typeof` guard. Keep the allowlist explicit; a
new portable module is added to it on purpose.

`AudioPlaybackController` is deliberately **not** in the first cut of the entry, even though it
is DOM-guarded: it is typed against `lib.dom`'s `AudioContext`. RN-P7 decides whether to add it
(with `react-native-audio-api`'s types) or to let `@elah/react-native` import it by deep path.

## 4. Runtime wiring

```
                 +---------------------------- @elah/react -----------------------------+
                 |  EditorProvider  (engines <-> stores bridge, moved from @elah/editor) |
                 |  useTimelineEngine . usePlaybackEngine . use*Store . useMediaLibrary  |
                 +--------------+------------------------------+------------------------+
                                | engines from context          | store selectors
                                v                              v
  +------------ @elah/react-native -----------------------------------------------------+
  |                                                                                     |
  |  <Preview>                        <Timeline>                 useImportMedia()       |
  |   RAF loop (JS thread)             gesture-handler            picker -> probe ->    |
  |   frame = playback.getFrameAt()    reanimated scroll/zoom     mediaLibraryStore     |
  |   scene = resolveTimeline()        previewClip / commit       thumbnails (Skia)     |
  |   renderer.render(scene) ----+                                                      |
  |                              v                                                      |
  |  SkiaRenderer (SceneRenderer): records an SkPicture -> shared value -> <Picture>    |
  |   ImageLayer . TextLayer . ShapeLayer . FreehandLayer . VideoLayer                  |
  |                      ^ SkImage frames                                               |
  |  NativeFrameProvider +  (sync getCurrent(sourceFrame), setPlayhead, cache)          |
  |                                                                                     |
  |  AudioController: @elah/core AudioPlaybackController + react-native-audio-api       |
  |  exportProject(): frame-step resolveTimeline -> offscreen surface -> native encoder |
  +------------------------------+------------------------------------------------------+
                                 v
                     ElahMedia native module (ios/ android/)
                     probe(uri) . openDecoder(uri) . decodeAhead . encoder . audio mix
```

### 4.1 `EditorProvider`

Identical to the web file. Two notes: `playbackStore` prefs do not persist (no `localStorage`),
which is fine; and `installTraceGlobal()` is a no-op without `window`, so tracing on device goes
through `trace()` to `console` and the React Native DevTools.

### 4.2 `SkiaRenderer`

Core's `Renderer` has `mount(container: HTMLElement)`. The mobile renderer implements the rest
of the contract and attaches differently:

```ts
// @elah/react-native (proposed)
export interface SceneRenderer extends Pick<Renderer, 'render' | 'resize' | 'prewarm' | 'dispose'> {
  /** Publish target: a Reanimated shared value the <Picture> reads. No React commit. */
  attach(target: SharedValue<SkPicture | null>): void
}
```

Changing core's `Renderer` to be generic over its mount target is a later core proposal (D7).
In v0.1 the mobile interface is local.

`render(scene)` is synchronous and does this:

1. `if (scene === last) return`.
2. `const rec = Skia.PictureRecorder(); const canvas = rec.beginRecording(stageRect)`.
3. Compute the contain viewport once per `resize` with `computeContainViewport(cssW*dpr,
   cssH*dpr, stage.width, stage.height)` and apply it as a `translate` + `scale`, so layers draw
   in **stage space** exactly as the web layers do.
4. Build one draw list from `scene.videos`, `.images`, `.texts`, `.shapes`, `.freehand`, sort by
   `zIndex` ascending, draw in order. Placement per item:
   - video/image: `resolveDrawRect(transform, stage.w, stage.h, contentW, contentH, crop)` gives
     `{x, y, width, height, rotation}`; `save`, `translate` to centre, `rotate`, `clipRRect` if
     `cornerRadius`, `drawImageRect(image, srcRect(normalizeCrop(crop)), dstRect, paint{alpha:
     opacity})`, `restore`. Unknown content size (frame not yet decoded) fills the stage for that
     tick, as the web does.
   - text: `computeTextLayout(measurer, item, stage)` gives lines, `anchorX`, `firstLineY`, `box`;
     draw background/border from `box`, then each line with `drawText` at the same baselines. The
     `measurer` is a Skia-backed `TextMeasurer` (section 4.3).
   - shape: `rect` / `circle` / `triangle` as Skia paths from the same rect math the web
     `ShapeLayer` uses; fill, then stroke.
   - freehand: `Skia.Path.MakeFromSVGString(pathData)`, stroke.
   - transitions: v0.1 handles `fade` only, by drawing the previous frame's snapshot (kept from
     the last `render`) on top at alpha `1 - t`. This mirrors `TransitionOverlay` and the export
     worker's `globalAlpha = 1 - t` pass.
5. `target.value = rec.finishRecordingAsPicture()`.

Why a picture and not a declarative Skia tree: a React tree of `<Image>`/`<Text>` nodes
re-renders React at the frame rate (violates M1). A picture is the imperative, zero-commit path,
and `<Picture picture={sharedValue}>` repaints on the UI thread when the value changes. Validate
the frame budget in RN-P0; if recording is too slow on low-end Android, fall back to drawing
straight into an offscreen `Surface` and publishing its `makeImageSnapshot()`.

**Layers own resources the way the web layers do.** `VideoLayer` acquires a frame provider per
`src` on enter and releases on leave; `ImageLayer` caches decoded `SkImage` by `src`; `TextLayer`
caches paragraphs by `(content, style, scale)`. The `RenderGraph` diff (enter/leave per `Scene`)
is small and is reimplemented locally rather than imported, because core's `RenderGraph` is
typed to GL textures.

### 4.3 Text parity

`computeTextLayout` is the single source of truth for wrapping on the web and takes a
`TextMeasurer` (`font` setter + `measureText(text).width`). The mobile package provides one
backed by Skia (`Skia.Font(typeface, size).measureText(text).width`) so the greedy word-wrap and
block placement are the same code path. Two consequences to document in the package README:

- The default web font is `sans-serif`, resolved by the browser. On device, `fontFamily` must map
  to a typeface the app ships or the system has. v0.1 bundles one open-licensed default
  (D8) and the harness uses it on both platforms so parity tests are meaningful.
- `TextLayout` positions assume `textBaseline = 'middle'`; Skia draws from the alphabetic
  baseline, so `firstLineY` is adjusted by the font's ascent/descent from `getMetrics()`. Do this
  once in the measurer adapter, with a test.

### 4.4 Video frames: `NativeFrameProvider`

Core's `VideoFrameProvider` is typed on `VideoFrame | ImageBitmap`; the mobile equivalent keeps
the **contract** (invariant I4) and swaps the frame type:

```ts
export interface NativeFrameProvider {
  getCurrent(sourceFrame: number): SkImage | null        // synchronous; null on miss
  setPlayhead(sourceFrame: number, opts?: { lookaheadFrames?: number }): void
  markIdle(): void
  markActive(): void
  dispose(): void
  readonly openPromise?: Promise<void> | null
  readonly openError?: Error | null
}
```

Behind it, the native module keeps one decoder per source URI (as the web keeps one per `src`),
decodes **forward** from the nearest keyframe into a ring of N frames keyed by source frame
index (`Math.round(pts / (1_000_000 / sourceFps))`, the same rounding as `VideoDecoderManager`),
and exposes the ring to JS as `SkImage` handles. A backward jump larger than the window is a
discontinuity: seek, flush, re-decode (same limitation as the web; see `CURRENT_LIMITATIONS.md`).
Frame ownership: the provider's cache is the only thing that releases a frame image.

Platform work: `AVAssetReader` + `AVAssetReaderTrackOutput` with `kCVPixelFormatType_32BGRA`
on iOS; `MediaExtractor` + `MediaCodec` to a `Surface`/`ImageReader` or to `HardwareBuffer` on
Android. Hand-off to Skia is via Skia's native-buffer image constructors (the mechanism
`react-native-vision-camera` uses for Skia frame processors). Confirm the exact API on the
installed Skia version in RN-P6 before designing the ring around it.

`clipLoadStore` gets `'loading'` while `openPromise` is pending and `'error'` on `openError`,
exactly as the web `VideoLayer` reports.

### 4.5 Audio

`AudioPlaybackController` subscribes to `PlaybackEngine`, reads `scene.audios` on epoch
changes, builds `AudioBufferSourceNode -> clipGain -> trackGain -> analyser -> masterGain ->
destination`, and hands its `AudioContext` to `PlaybackEngine.setAudioContext()` so the hardware
clock drives the transport. `react-native-audio-api` implements those nodes and `currentTime`,
`state`, `decodeAudioData`. Plan: construct it with
`audioContextFactory: () => new AudioContext()` from `react-native-audio-api` and an
`audioResolver` that reads a `file://` URI into an `ArrayBuffer` (`fetch` works for `file://`
in React Native; `expo-file-system` is the fallback). If it runs unmodified, mobile audio is a
60-line wrapper. If a node or method is missing, the gap is listed in RN-P7 and either shimmed or
reported upstream.

The autoplay unlock (`window.addEventListener('pointerdown')`) is skipped on device by its own
guard; iOS audio session configuration is the native module's job.

### 4.6 Import

`useImportMedia()` wraps the pickers and funnels every result through **one** registration path
(the web rule: one ingestion funnel), producing a `MediaAsset` for `mediaLibraryStore.addAsset`:
`src` is the `file://` URI (copied into the app's document directory so it survives the picker's
temp lifetime), `durationSec` / `width` / `height` / `sourceFps` / `hasAudio` come from
`ElahMedia.probe(uri)`, `thumbnailUrl` and `thumbnailStrip` are PNGs written by the decoder +
Skia, `waveform` comes from `decodeAudioData` peaks or the native module. `status: 'pending'`
while probing, as the web does for URL imports.

### 4.7 Export

`exportProject(engine.getProject(), options)`:

1. Native: `encoder = ElahMedia.openEncoder({ width, height, fps, videoCodec: 'h264' | 'hevc',
   bitrate, audio?: { sampleRate, channels } })`.
2. JS: for `frame in 0..totalFrames`: `scene = resolveTimeline(frame, project)`;
   `renderer.render(scene)` into an **offscreen `Surface` at stage size**; `pixels =
   snapshot.readPixels()` (or hand the Skia image's native buffer to the encoder without a
   copy); `encoder.appendFrame(pixels, frame)`. Decode is driven synchronously here: the export
   loop awaits the provider's open and pre-rolls `setPlayhead` before reading, so a cache miss
   is a wait, not a repeated frame (the web export worker does the same).
3. Audio: the native module mixes clip PCM (`startFrame / fps`, `sourceStartFrame / fps`,
   `durationFrames / fps`, clip and track and master gain) because `OfflineAudioContext` is
   unavailable; then muxes.
4. Yield to the event loop every K frames and report `ExportProgress`.

Determinism (I7) holds because the pixels come from the same `(project, frame)` resolution and
the same placement math as preview. Reuse core's `ExportOptions` / `ExportProgress` types.

### 4.8 Timeline

A `react-native-gesture-handler` + Reanimated component over the same stores and hooks the web
timeline uses (`useTracksStore`, `usePlaybackStore`, `useSelectionStore`) with the same math
(`timelineContentWidth`, the zoom-anchor arithmetic, `snapFrame` / `buildSnapPoints`,
`isCompatibleTrackKind`). v0.1 gestures: horizontal pan (scroll), pinch (zoom anchored under the
fingers), tap (select), long-press-drag on a clip (move, via `previewClip` then
`commitInteraction`), drag on clip edges (trim), tap on the ruler (seek). No drag-and-drop from
an asset panel in v0.1; "Add to timeline" is a button on the asset that calls
`insertMediaAsset` at the playhead.

## 5. Threads

Three threads matter and the rule is the same for each: the engine lives on the JS thread.

| Thread | Runs | Must not |
|---|---|---|
| JS | engine, resolver, `SkiaRenderer.render`, store updates, React | block on decode or I/O |
| UI (Reanimated worklets) | repainting the `<Picture>` when the shared value changes; gesture math that needs 60 Hz feedback (pan/zoom offsets) | touch the engine or stores directly; commit edits (post back to JS) |
| Native | decode, probe, encode, audio mix | call back into JS per frame; the JS side polls `getCurrent` |

If `render` on the JS thread proves too slow on the floor device in RN-P0, the fallback is to
move recording into a worklet: the resolver is pure and `Scene` is plain data, so it can cross
the boundary. Do not design for that until measured.

## 6. What goes where (decision table)

| Question | Answer |
|---|---|
| New pure math (snap, zoom, placement) | `@elah/core` (`utils/` or `renderer/gpu/layers/`), with tests, exported from both barrels |
| Something that imports React but not DOM | `@elah/react` |
| Something that imports Skia, RN, gesture-handler, or the native module | `@elah/react-native` |
| Platform code (Swift / Kotlin / C++) | `packages/react-native/{ios,android,cpp}` |
| A dev page or fixture project | `apps/mobile` |
| Proof that the npm tarball works | `examples/react-native` |

## 7. Public API of v0.1 (target)

```ts
// re-exported from @elah/react / @elah/core/engine
export { EditorProvider, useEditor, useTimelineEngine, usePlaybackEngine,
         useTracksStore, usePlaybackStore, useSelectionStore, useTransitionsStore,
         useTextStylePresetsStore, useClipLoadStore, useMediaLibraryStore, useMediaLibrary }
export { TimelineEngine, PlaybackEngine, resolveTimeline, serializeProject, readProjectDocument,
         relinkProjectMedia, createVideoClip, createAudioClip, createTextClip, createImageClip,
         createShapeClip, createFreehandClip, BUILT_IN_TEXT_TEMPLATES, applyTextTemplate,
         secondsToFrames, framesToSeconds, framesToTimecode, splitClipAtPlayhead }
export type { Project, Track, Clip, Scene, Transform, Transition, MediaAsset }

// mobile-only
export { Preview }            // props: style, enableAudio?, clearColor?, onReady?
export type { PreviewHandle } // getRenderer(), snapshot(): Promise<SkImage>
export { Timeline }           // props: style, trackHeight?, onSelectClip?
export { useImportMedia }     // pickFromLibrary(), pickDocument(), importUri(uri)
export { exportProject }      // (project, options) => Promise<{ uri: string }>, with progress + cancel
export { SkiaRenderer }       // for custom previews
export type { SceneRenderer, NativeFrameProvider }
```

Anything not in this list is internal and may change without notice until 1.0.
