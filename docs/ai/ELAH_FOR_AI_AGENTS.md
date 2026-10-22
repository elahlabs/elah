# Elah for AI agents — complete integration guide

**Everything needed to build a custom video-editor UI on `@elah/editor`, in one file.**

Written for AI coding tools that get one shot and no repo access — Lovable, Google AI Studio,
Emergent, v0, bolt.new — as well as repo-aware agents (Claude Code, Codex, Cursor, Gemini CLI).
Nothing here requires reading another file.

- **Version:** `@elah/editor@1.0.0` (with `@elah/core@1.0.0`) · **License:** Apache-2.0
- **Repo:** https://github.com/elahlabs/elah · **Docs:** https://www.elah.dev/docs

**Working code, if you can fetch a URL.** Three runnable apps that install this exact version
from npm — every config and import in this guide is applied and verified there:

| Example | Stack | Use it for |
| --- | --- | --- |
| [`examples/minimal`](https://github.com/elahlabs/elah/tree/main/examples/minimal) | Vite + React 19 | The smallest complete editor, ~130 lines. **Copy this to start a custom UI.** |
| [`examples/react`](https://github.com/elahlabs/elah/tree/main/examples/react) | Vite + React 19 | A finished editor — panels, inspector, MP4 export modal. |
| [`examples/next`](https://github.com/elahlabs/elah/tree/main/examples/next) | Next.js 16 App Router | The same, plus `ssr: false` mounting and `transpilePackages`. |

**Contents:** [1 What it is](#1-what-elah-is-and-is-not) · [2 Install](#2-install) ·
[3 Stylesheets](#3-the-three-stylesheets-most-common-mistake) · [4 Bundler](#4-bundler-setup) ·
[5 Mental model](#5-mental-model) · [6 API reference](#6-api-reference) ·
[7 Recipes](#7-recipes) · [8 Common mistakes](#8-common-mistakes) ·
[9 Browser support](#9-browser-support-and-host-platforms) ·
[10 Headless rendering with the CLI](#10-headless-rendering-with-elahcli) ·
[11 Writing videos and scenes with a model](#11-writing-videos-and-scenes-with-a-model)

---

## 1. What Elah is (and is not)

**Is:** an npm SDK that renders a complete video editor in the browser. Frame-accurate
timeline, WebGL2 preview canvas, media import, drag/trim/split, and MP4 export — all
client-side. You compose its React components and drive its engine.

**Is not:** a hosted service, an API you call, or a video player. There is no account, no key,
and no server. Nothing is uploaded; media stays in the browser.

**Build UI by composing, not forking.** `Preview`, `Timeline`, `AssetPanel` are the heavy
lifting. Your custom UI is toolbars, inspectors, and panels that *read* engine state and
*call* engine methods — see [§7](#7-recipes).

---

## 2. Install

```bash
npm install @elah/editor lucide-react
```

One package. `@elah/editor` pulls in `@elah/core`, `@elah/react`, and `@elah/timeline`, and
re-exports their public API — you import the editor, timeline and engine API from `@elah/editor`.
The 1.0.0 programmatic layer (effects, generators, motion helpers, VideoSpec, HTML scenes, ops,
`packageFontsBaseUrl`) is **not** re-exported: import it from `@elah/core` ([§11](#11-writing-videos-and-scenes-with-a-model)).

**`lucide-react` is a peer dependency** (the timeline uses it for clip icons) and you must
install it explicitly. npm auto-installs peers so it may appear to work without it; **pnpm and
yarn do not**, and neither do several AI hosting sandboxes. Always list it.

Peers: `react >= 18`, `react-dom >= 18`, `lucide-react >= 0.400.0`. React 19 is supported.

---

## 3. The three stylesheets (most common mistake)

```ts
import '@elah/timeline/styles.css'
import '@elah/editor/styles.css'
import '@elah/editor/styles/tokens.css'
import './your-app.css'   // yours last, so it wins
```

**Import all three, in this order, once at your app root.**

Each package compiles its own stylesheet from its own source, so they do **not** contain each
other's classes:

| Stylesheet | Covers |
| --- | --- |
| `@elah/timeline/styles.css` | Ruler, tracks, clips, playhead, trim handles |
| `@elah/editor/styles.css` | `Preview`, `AssetPanel`, `ElementsPanel`, `SourcePanel` |
| `@elah/editor/styles/tokens.css` | The 130+ `--elah-*` design tokens the other two read |

Importing only `@elah/editor/styles.css` — an easy assumption — leaves the timeline
half-styled with unset colours. Skip `tokens.css` **only** if your app already defines
`--elah-*` inside `.elah-root`.

These are plain CSS. **Your app does not need Tailwind**, and no utility class names leak into
your global scope.

---

## 4. Bundler setup

### Vite

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  worker: {
    // Export runs in a module worker; Vite's default IIFE format cannot use import.
    format: 'es',
  },
  optimizeDeps: {
    // esbuild's pre-bundle rewrites the worker's `new URL(...)` reference and breaks it.
    exclude: ['@elah/editor', '@elah/core', '@elah/react', '@elah/timeline', 'mediabunny'],
  },
})
```

### Next.js (App Router)

```js
// next.config.mjs
const nextConfig = {
  transpilePackages: ['@elah/editor', '@elah/core', '@elah/react', '@elah/timeline', 'mediabunny'],
}
export default nextConfig
```

```tsx
// app/page.tsx — the editor is browser-only and MUST NOT server-render.
'use client'
import dynamic from 'next/dynamic'

const Editor = dynamic(() => import('@/components/Editor'), { ssr: false })

export default function Page() {
  return <Editor />
}
```

**The editor is browser-only.** It uses Canvas, WebGL2, Web Audio, Web Workers, and WebCodecs.
It cannot server-render — always gate it behind `ssr: false` (Next), a `typeof window` check,
or a client-only route.

---

## 5. Mental model

```
        your UI  ──calls──►  TimelineEngine  ──emits──►  Zustand stores  ──►  your UI reads
                                   │
                                   ▼
                            Project (state)
                                   │
                       resolveTimeline(frame, project)   ← pure, no I/O
                                   │
                                   ▼
                                 Scene  ──►  <Preview> WebGL2 canvas / MP4 export
```

Four rules that explain almost every bug:

1. **Time is integer frames, never seconds.** `startFrame`, `durationFrames`, `currentFrame`
   are all frame counts. Convert at the edges with `secondsToFrames(s, fps)` /
   `framesToSeconds(f, fps)`. `fps` is fixed per project.
2. **The engine is the only way to change the project.** `engine.addClip()`,
   `engine.updateClip()`, `engine.undo()`. Every mutation is undoable because it funnels here.
3. **The stores are read-only mirrors.** `usePlaybackStore`, `useTracksStore`,
   `useSelectionStore` are for *reading* in React. Never write to them — you desync the UI
   from the project and break undo. (Playback transport — `togglePlayPause`, `setCurrentFrame`,
   `setZoom` — is the exception: those *are* store actions, because playback position is view
   state, not project state.)
4. **Rendering is a pure function of `(frame, project)`.** You never draw to the canvas
   yourself. Change the project and the preview follows.

---

## 6. API reference

### Components

#### `<EditorProvider>` — wraps everything

```tsx
<EditorProvider
  fps={30}                                   // required
  stage={{ width: 1920, height: 1080 }}      // default is PORTRAIT 1080x1920; pass a stage for landscape
  defaultTrackHeight={36}
  maxHistorySize={100}
  initialTracks={[
    { kind: 'video',    name: 'Video' },
    { kind: 'elements', name: 'Text & Shapes' },
    { kind: 'audio',    name: 'Audio' },
  ]}
>
  {children}
</EditorProvider>
```

**These props are read once, on mount.** The engine is memoised with empty deps, so changing
`fps` or `stage` later does nothing. To resize at runtime call `engine.setStage(w, h)`.

`TrackKind` is `'video' | 'audio' | 'elements'`. Any number of tracks of any kind; index order
is top→bottom in the UI, and lower index renders on top.

#### `<Preview>` — the WebGL2 canvas

```tsx
<Preview
  demuxerFactory={demuxerFactory}   // required for video playback
  style={{ flex: 1 }}
  className=""
  debug={false}
  enableAudio={true}
  clearColor={[0, 0, 0, 1]}
  preserveDrawingBuffer={false}
  audioResolver={undefined}         // custom URL→bytes for audio
/>
```

Create the factory **once**, at module scope or in a `useRef`:

```ts
import { createDefaultDemuxerFactory } from '@elah/editor'
const demuxerFactory = createDefaultDemuxerFactory()
```

Ref handle: `PreviewHandle = { getCanvas(), getRenderer() }`.

#### `<Timeline>` — the track UI

```tsx
<Timeline
  ref={timelineRef}
  fps={30}
  style={{ height: 240 }}       // REQUIRED — it fills its container
  sidebarWidth={184}
  compactSidebar={false}
  classNames={{ /* per-slot class overrides */ }}
/>
```

`TimelineRef = { engine, playback, fitToWindow(), zoomAtAnchor(nextZoom) }`. `zoomAtAnchor` zooms
anchored on the playhead when it is in view, else on the viewport centre, so a zoom button or
slider never scrolls the playhead away — use it instead of a raw `setZoom`. Any number of video
tracks is supported, and only clips inside the scrolled viewport are mounted. `TimelineClassNames` has slots for
`root`, `ruler`, `rulerTick`, `rulerLabel`, `track`, `trackLabel`, `lane`, `clip`,
`clipVideo` / `clipAudio` / `clipText` / `clipImage` (each with an `*Accent` variant),
and `playhead`.

#### Panels

```tsx
<AssetPanel style={{ width: 240 }} onAssetActivate={handler} activateOnTap />
<ElementsPanel style={{ width: 240 }} />
<SourcePanel defaultLane="media" classNames={{ /* 24 slots */ }} />
```

`AssetPanel` = imported media. `ElementsPanel` = text/shape/freehand to drag in.
`SourcePanel` = both in one tabbed panel.

### Hooks

| Hook | Returns |
| --- | --- |
| `useTimelineEngine()` | The `TimelineEngine`. Your handle on every edit. |
| `usePlaybackEngine()` | The `PlaybackEngine` (clock/transport). |
| `useEditor()` | `{ engine, playback }` together. |
| `usePlaybackStore(selector)` | `currentFrame`, `isPlaying`, `zoom`, `volume`, `muted`, `loop`, `playbackRate`, `snapEnabled` + actions `play`, `pause`, `togglePlayPause`, `setCurrentFrame`, `setZoom`, `setVolume`, `toggleMute`, `toggleLoop`, `toggleSnap`, `setPlaybackRate` |
| `useTracksStore(selector)` | `tracks`, `clips`, `stage`, `totalFrames`, `canUndo`, `canRedo` |
| `useSelectionStore(selector)` | `selectedClipIds: Set<string>`, `activeTrackId` + `selectClip`, `toggleClipSelection`, `selectClips`, `clearSelection`, `setActiveTrack` |
| `useTransitionsStore(selector)` | Transition state |
| `useTextStylePresetsStore(selector)` | Reusable text looks: the built-in presets (`BUILT_IN_TEXT_STYLE_PRESETS`) plus user-saved ones |
| `useClipLoadStore(selector)` | `byClipId: Record<clipId, 'loading' \| 'error'>` — clips the preview cannot draw yet. Renderer state: never saved, never undoable |
| `useMediaLibrary()` / `useAssets()` | `{ assets, getAsset, removeAsset, updateAsset, importFiles, importUrl, importBlob }` |
| `useResolvedScene(frame?)` | The `Scene` at the current frame — for custom overlays |
| `useAudioMixer(controller)` | `{ setMasterGain, setTrackGain }` |
| `useMasterVolume(controller, engine)` | `{ masterVolume, setMasterVolume }` |
| `useTrackLevels(controller)` | `Map<trackId, { left, right }>` for VU meters |

**Always pass a narrow selector.** `usePlaybackStore(s => s.isPlaying)`, never
`usePlaybackStore(s => s)` — the latter re-renders 30-60× per second during playback.

Each store hook also carries `.getState()` and `.subscribe()` for imperative use outside
React. Outside React entirely, use the vanilla stores: `playbackStore`, `tracksStore`,
`selectionStore`, `transitionsStore`, `mediaLibraryStore`, `textStylePresetsStore`, `clipLoadStore`.

### `TimelineEngine`

```ts
const engine = useTimelineEngine()
```

**Read:** `getProject()` · `getTrack(trackId)` · `getClipsOnTrack(trackId)` ·
`findClip(clipId)` · `getTotalFrames()` · `canUndo()` · `canRedo()` · `isTrackLocked(trackId)`

**Project:** `setStage(width, height)` · `setMasterVolume(v)` · `loadProject(project, options?)`
(`options: { transport?: 'rewind' | 'keep', history?: 'reset' | 'keep' }`; feed it the result of
`readProjectDocument`, and listen for the `project:loaded` event)

**Tracks:** `addTrack(kind, options?)` (any number of tracks of any kind, **including several video
tracks**, which composite in track order with the topmost lane on top; options include `name`, `height`,
`protected` (user cannot remove it) and `pinned: 'bottom'` (kept below every non-pinned track)) · `removeTrack(id)` · `updateTrack(id, updates)` ·
`reorderTracks(orderedIds)`

**Clips:** `addClip(options)` · `removeClip(clipId, trackId)` ·
`updateClip(clipId, trackId, updates)` · `moveClip(clipId, fromTrackId, toTrackId, startFrame)` ·
`trimClip(clipId, trackId, startFrame, durationFrames)` ·
`splitClip(clipId, trackId, atFrame)` → `[leftId, rightId] | null` · `cloneClip(clipId, trackId)` ·
`setClipSpeed(clipId, trackId, speed)` (video only, 0.25–4; length follows the speed)

Clips also carry `speed`, `crop` (`{ x, y, width, height }`, 0..1 of the source) and `cornerRadius`
(0..0.5 of the shorter side) for video and image clips.

**Gestures:** `previewClip(clipId, trackId, updates)` · `commitInteraction(description?)` ·
`cancelInteraction()`

**Transitions:** `addTransition(options)` · `removeTransition(id)` · `updateTransition(id, updates)`

**History:** `undo()` · `redo()` · `batch(recipe, description?)`

**Events:** `on(event, handler)` · `off(event, handler)`

### Creating clips

`engine.addClip()` takes a **discriminated union on `type`**:

```ts
// Video / audio / image — need a `src`
engine.addClip({ type: 'video', trackId, startFrame: 0, durationFrames: 150, src: url })
engine.addClip({ type: 'audio', trackId, startFrame: 0, durationFrames: 300, src: url })
engine.addClip({ type: 'image', trackId, startFrame: 0, durationFrames: 90,  src: url })

// Text — style is NESTED under `text`
engine.addClip({
  type: 'text', trackId, startFrame: 0, durationFrames: 60,
  text: { content: 'Hello', fontSize: 72, color: '#fff', fontWeight: 'bold', textAlign: 'center' },
})

// Shape — nested under `shape`; shapeKind is 'rect' | 'circle' | 'triangle'
engine.addClip({
  type: 'shape', trackId, startFrame: 0, durationFrames: 60,
  shape: { shapeKind: 'circle', shapeFill: '#e11d48', shapeStroke: '#fff', shapeStrokeWidth: 4 },
})

// Freehand — an SVG path
engine.addClip({
  type: 'freehand', trackId, startFrame: 0, durationFrames: 60,
  freehand: { pathData: 'M10 10 L100 100', strokeColor: '#fff', strokeWidth: 3 },
})

// 1.0.0 types (imports from '@elah/core'):
engine.addClip({ type: 'adjustment', trackId, startFrame: 0, durationFrames: 60 })   // effects for everything beneath
engine.addClip({ type: 'generator', trackId, startFrame: 0, durationFrames: 60,
  generator: createGenerator('particles', { count: 80 }) })                          // 8 generators
engine.addClip({ type: 'compound', trackId, startFrame: 0, durationFrames: 60, compound: { project: nested } })
engine.addClip({ type: 'sequence', trackId, startFrame: 0, durationFrames: 60, src: gifUrl,
  sequence: { kind: 'animated-image', frameCount: 24, fps: 12, loop: true } })        // GIF / animated WebP
```

`ClipType` has ten members; code that switches on it needs a `default`. The four 1.0.0 types sit on
`elements` tracks in the timeline UI, and `@elah/editor` has no inspector for them: drive them through the
engine, ops or VideoSpec ([§11](#11-writing-videos-and-scenes-with-a-model)).

All types also accept `name?`, `volume?`, `opacity?`, `transform?`.

⚠️ **Nested on creation, flat on the `Clip`.** You *create* text with `text: { content }`, but
the stored `Clip` and the resolved `ActiveTextClip` both expose `content`, `fontSize`, `color`
directly. So updates are flat: `engine.updateClip(id, trackId, { content: 'New' })`.

Standalone factories (`createTextClip`, `createVideoClip`, `createShapeClip`, …) exist for
building `Clip` objects outside the engine; they take the same nested option shapes.

### `Transform`

```ts
interface Transform {
  x: number              // 0..1, normalized to stage width
  y: number              // 0..1, normalized to stage height
  scale: number          // 1 = native size
  rotation: number       // radians, positive = clockwise
  anchor: { x: number; y: number }   // 0..1 within the clip's own box
  scaleX?: number        // extra horizontal stretch on top of `scale` (omitted = 1)
  scaleY?: number        // extra vertical stretch on top of `scale` (omitted = 1)
}
```

Normalized so a project is resolution-independent. Setting `rotation` tilts a video, image or
text clip, but only **text** clips get an interactive rotate knob in `<Preview>`. Video and image
clips have 8 resize handles (non-uniform; Shift keeps the aspect ratio) and a Resize/Crop toggle,
but **no rotate handle**: set `transform.rotation` through `engine.updateClip`.

### Transitions

```ts
engine.addTransition({
  fromClipId, toClipId, trackId,        // two adjacent clips on the SAME track
  kind: 'slide',                        // 'fade' | 'slide' | 'wipe' | 'zoom' | 'spin' | 'whip'
                                        // | 'glitchCut' | 'warpDissolve' | 'lumaWipe'
  durationFrames: 12,
  direction: 'left',                    // optional: 'left' | 'right' | 'up' | 'down' (slide and whip)
  easing: 'ease-out',                   // 'linear' | 'ease-in' | 'ease-out'
})
```

Nine kinds, all drawn by the WebGL2 renderer in preview and in export; both clips keep playing through
a transition. `slide` and `whip` take a direction (default right); the others ignore it. A project that uses
only `fade`, `slide` and `wipe` still exports without WebGL2 (a 2D path with left/right slide only); any of
the other six needs WebGL2 in the export worker and fails there without it. `TRANSITION_REGISTRY`
(from `@elah/core`) lists the kinds with labels and hints.

### Text templates, animation and frame sequences

```ts
import { BUILT_IN_TEXT_TEMPLATES, findTextTemplate, applyTextTemplate } from '@elah/editor'

const template = findTextTemplate(BUILT_IN_TEXT_TEMPLATES[0].id)!
engine.updateClip(clip.id, clip.trackId, applyTextTemplate(template, clip)) // undoable patch

// Plain entry/exit: one kind per end. Text and shape clips both take this shape.
engine.updateClip(clip.id, clip.trackId, {
  textAnimation: { in: 'fade', out: 'slide-down', durationFrames: 12 }, // shapes: `shapeAnimation`
})
```

14 built-in templates. Entry/exit can also be a layered `MotionSpec` (`inMotion` / `outMotion`:
`opacity`, `offsetX`, `offsetY`, `scale`, `rotation`, `ease`, `opacityEase`), which replaces the
plain `in` / `out` kind. Limit to respect: `applyTextTemplate` **ignores a template's `stagger`
and `tracking`** (nothing in the packages runs them).

Richer animation is data on the clip (`Clip.keyframes`, from `@elah/core`): keyframes on every transform
channel with the full ease set, springs, hold, stagger, motion paths, per-unit text animators, scramble,
repeat/yoyo, skew and 3D tilt (`rotateX` / `rotateY` on video, image, sequence and compound clips).
Key frames are integers relative to the clip start.

Frame sequences are ordered image sets (360 degree orbits, storyboards):
`createFrameSequence({ frames: urls, fps: 12, loop: 'wrap' })`, drive one with
`FrameSequenceController`, or lay one out as image clips with
`engine.loadProject(frameSequenceToProject(seq, { holdFrames: 6 }))`.

### Export

```ts
const blob = await exportVideo(project, options)      // eager
const blob = await lazyExportVideo(project, options)  // code-split; prefer this
```

```ts
interface ExportOptions {
  videoCodec?: 'avc' | 'hevc' | 'av1' | 'vp9' | 'vp8'  // default 'avc'; others where the browser can encode
  audioCodec?: 'aac' | 'opus'           // default 'aac'
  container?: 'mp4' | 'webm' | 'png-sequence' | 'gif'   // default 'mp4'
  transparent?: boolean                 // webm only, where the browser's own check passes
  range?: 'all' | 'inOut'               // 'inOut' = the marked in/out range
  gifFps?: number                       // gif only, default 15
  fonts?: { baseUrl: string }           // where bundled fonts are served; default '/fonts/'
  videoBitrate?: number                 // bits/s, default 8_000_000
  audioBitrate?: number                 // bits/s, default 128_000
  outputHeight?: number                 // target SHORT edge, e.g. 720 (portrait or landscape); the
                                        // other edge derives from the stage aspect, rounded to even
  onProgress?: (p: { frame: number; totalFrames: number }) => void
  signal?: AbortSignal                  // cancel
  audioResolver?: AudioResolver         // custom URL→bytes
  onAudioIssue?: (message: string, src?: string) => void
}
```

**There is no `fps` option and no `demuxerFactory` option** — fps comes from the project, and
export builds its own decode pipeline in the worker. Progress is `{ frame, totalFrames }`;
compute a percentage yourself. Only one export may run at a time.

### `Scene` (for custom renderers / overlays)

```ts
const scene = resolveTimeline(frame, project)
// { frame, fps, stage, videos, audios, texts, images, shapes, freehand, transitions }
```

Clip fields are **flat**: `scene.texts[0].content`, `.fontSize`, `.color` — not nested.

### Entry points

`@elah/core` is everything. `@elah/core/engine` is the browser-free subset (engine, resolver,
`PlaybackEngine`, stores, clip factories, project documents, pure placement / timeline math) with
no renderer, codec, importer or export worker. Use it in React Native, workers and Node; both
entries share store instances. `EditorProvider` is exported by `@elah/react` (and re-exported by
`@elah/editor`).

### Utilities

`framesToTimecode(frame, fps)` · `secondsToFrames(s, fps)` · `framesToSeconds(f, fps)` ·
`getTotalFrames(project)` · `generateId()` · `splitClipAtPlayhead(engine)` ·
`snapFrame(frame, points, threshold)` · `buildSnapPoints(clipsByTrack, excludeId?)` ·
`clipsOverlap(a, b)` · `DEFAULT_OVERLAP_TOLERANCE` ·
timeline geometry (pure): `timelineContentWidth(totalFrames, zoom)` · `seekFrameAtX(x, scrollX, zoom)` · `computeRulerTicks(fps, totalFrames, zoom)` ·
`computeAnchoredScrollLeft(prevZoom, nextZoom, scrollLeft, anchorX)` · `pinchZoom` · `clampZoom` ·
`isCompatibleTrackKind` · `isClipAllowedOnTrack` · `clampLeftTrim` / `clampRightTrim` · `neighbourBounds` ·
`serializeProject(engine)` → string / `deserializeProject(engine, json)` → void ·
`readProjectDocument(doc)` → `Project` (throws `ProjectDocumentError`) · `relinkProjectMedia(project, assets)` →
`{ project, relinked, missing }` · `missingMediaSummary(missing)` · `isRecoverableMediaSrc(src)` · `PROJECT_VERSION` ·
`insertMediaAsset(engine, assetId, opts?)` · `insertElement(engine, payload, opts?)` ·
`growClipToAssetDuration(engine, clipId, expectedFallbackFrames, newDurationSec)` ·
`importFiles(files)` / `importUrl(url)` / `importBlob(blob)` / `beginImportUrl(url, opts?)` (returns a
`status: 'pending'` asset at once) · `determineAssetHasAudio(assetId)` · `probeHasAudio(src)` ·
`BUILT_IN_TEXT_TEMPLATES` · `findTextTemplate(id)` · `applyTextTemplate(template, clip)` → `Partial<Clip>` ·
`sampleTextAnimation(...)` · `TEXT_ANIMATION_KINDS` · `TEXT_ANIMATION_EASINGS` ·
`createFrameSequence` · `FrameSequenceController` · `frameSequenceToProject` · `PerfSummary`

---

## 7. Recipes

Copy-paste ready. All imports come from `@elah/editor`.

### 7.1 Minimal working editor

```tsx
import {
  EditorProvider, Preview, Timeline, AssetPanel,
  createDefaultDemuxerFactory, type InitialTrackConfig,
} from '@elah/editor'

// Once, at module scope — it owns decoder state.
const demuxerFactory = createDefaultDemuxerFactory()

const TRACKS: InitialTrackConfig[] = [
  { kind: 'video', name: 'Video' },
  { kind: 'elements', name: 'Text & Shapes' },
  { kind: 'audio', name: 'Audio' },
]

export default function Editor() {
  return (
    <EditorProvider fps={30} stage={{ width: 1920, height: 1080 }} initialTracks={TRACKS}>
      {/* elah-root scopes the --elah-* design tokens */}
      <div className="elah-root" style={{ display: 'flex', height: '100vh' }}>
        <AssetPanel style={{ width: 240, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <Preview demuxerFactory={demuxerFactory} style={{ flex: 1, minHeight: 0 }} />
          <Timeline fps={30} style={{ height: 240, flexShrink: 0 }} />
        </div>
      </div>
    </EditorProvider>
  )
}
```

### 7.2 Custom transport bar

```tsx
import { usePlaybackStore, useTracksStore, framesToTimecode } from '@elah/editor'

export function Transport({ fps = 30 }) {
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const currentFrame = usePlaybackStore((s) => s.currentFrame)
  const toggle = usePlaybackStore((s) => s.togglePlayPause)
  const seek = usePlaybackStore((s) => s.setCurrentFrame)
  const totalFrames = useTracksStore((s) => s.totalFrames)

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <button onClick={toggle}>{isPlaying ? 'Pause' : 'Play'}</button>
      <button onClick={() => seek(0)}>Start</button>
      <span style={{ fontFamily: 'monospace' }}>
        {framesToTimecode(currentFrame, fps)} / {framesToTimecode(Math.max(totalFrames, 1), fps)}
      </span>
    </div>
  )
}
```

### 7.3 Undo / redo

```tsx
import { useTracksStore, useTimelineEngine } from '@elah/editor'

export function HistoryButtons() {
  const engine = useTimelineEngine()
  const canUndo = useTracksStore((s) => s.canUndo)
  const canRedo = useTracksStore((s) => s.canRedo)

  return (
    <>
      <button disabled={!canUndo} onClick={() => engine.undo()}>Undo</button>
      <button disabled={!canRedo} onClick={() => engine.redo()}>Redo</button>
    </>
  )
}
```

### 7.4 Clip inspector — the preview/commit pattern

The single most important pattern for custom property panels. Continuous input (sliders,
dragging, typing) uses `previewClip`, which updates live but records **no** history. One
`commitInteraction()` at the end folds the whole gesture into a single undo entry.

```tsx
import { useSelectionStore, useTracksStore, useTimelineEngine } from '@elah/editor'

export function TextInspector() {
  const engine = useTimelineEngine()
  const selectedId = useSelectionStore((s) => [...s.selectedClipIds][0])
  const clips = useTracksStore((s) => s.clips)

  if (!selectedId) return null
  const clip = Object.values(clips).flat().find((c) => c.id === selectedId)
  if (!clip || clip.type !== 'text') return null

  return (
    <div style={{ width: 280, padding: 12 }}>
      {/* Continuous: preview while typing, commit on blur → ONE undo entry */}
      <input
        value={clip.content ?? ''}
        onChange={(e) => engine.previewClip(clip.id, clip.trackId, { content: e.target.value })}
        onBlur={() => engine.commitInteraction('Edit text')}
      />

      {/* Continuous: same pattern for a slider */}
      <input
        type="range" min={12} max={200}
        value={clip.fontSize ?? 48}
        onChange={(e) => engine.previewClip(clip.id, clip.trackId, { fontSize: +e.target.value })}
        onPointerUp={() => engine.commitInteraction('Resize text')}
      />

      {/* Discrete: one-shot change → updateClip records history directly */}
      <input
        type="color"
        value={clip.color ?? '#ffffff'}
        onChange={(e) => engine.updateClip(clip.id, clip.trackId, { color: e.target.value })}
      />
    </div>
  )
}
```

Rule of thumb: **continuous → `previewClip` + `commitInteraction`; discrete → `updateClip`.**
Use `cancelInteraction()` to abandon a gesture (e.g. Escape during a drag).

### 7.5 Import media and place it programmatically

```tsx
import { useMediaLibrary, useTimelineEngine, insertMediaAsset } from '@elah/editor'

export function ImportButton() {
  const engine = useTimelineEngine()
  const { importFiles, assets } = useMediaLibrary()

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files) return
    // ImportFilesResult is { imported: MediaAsset[], skipped: SkippedImport[] }
    const { imported, skipped } = await importFiles(Array.from(e.target.files))
    if (skipped.length) console.warn('skipped:', skipped)

    const asset = imported[0]
    if (!asset) return

    // Place it on a compatible track. No drag needed.
    const placed = await insertMediaAsset(engine, asset.id, { desiredStartFrame: 0 })
    if (!placed.ok) console.warn('insert failed:', placed.reason)
  }

  return (
    <>
      <input type="file" accept="video/*,audio/*,image/*" multiple onChange={onPick} />
      <p>{assets.length} asset(s)</p>
    </>
  )
}
```

`insertMediaAsset` returns `{ ok: true, kind, trackId, clipIds }` or
`{ ok: false, kind, reason }` where reason is `'missing-asset' | 'no-track' | 'locked' |
'incompatible-track' | 'cancelled'`. `importUrl(url)` and `importBlob(blob)` work the same way.

For a remote URL you want on the timeline *now*, use `beginImportUrl(url)`: it returns a
`status: 'pending'` asset immediately. Insert the clip with `insertMediaAsset`, then call
`growClipToAssetDuration(engine, clipId, fallbackFrames, asset.durationSec)` once the asset flips to
`'ready'`; it grows only into free space and leaves a clip the user already trimmed alone.

### 7.6 Add a text clip

```tsx
import { useTimelineEngine, useTracksStore, usePlaybackStore } from '@elah/editor'

export function AddTitleButton() {
  const engine = useTimelineEngine()
  const tracks = useTracksStore((s) => s.tracks)

  function addTitle() {
    const track = tracks.find((t) => t.kind === 'elements')
    if (!track) return

    engine.addClip({
      type: 'text',
      trackId: track.id,
      startFrame: usePlaybackStore.getState().currentFrame,
      durationFrames: 90,           // 3s at 30fps
      text: { content: 'Your title', fontSize: 72, color: '#ffffff', textAlign: 'center' },
    })
  }

  return <button onClick={addTitle}>Add title</button>
}
```

### 7.7 Split the selected clip at the playhead

```tsx
import { useTimelineEngine, useSelectionStore, splitClipAtPlayhead } from '@elah/editor'

export function SplitButton() {
  const engine = useTimelineEngine()
  const hasOne = useSelectionStore((s) => s.selectedClipIds.size === 1)

  function split() {
    const result = splitClipAtPlayhead(engine)   // handles selection + playhead for you
    if (!result.ok) console.warn('split failed:', result.reason)
  }

  return <button disabled={!hasOne} onClick={split}>Split</button>
}
```

### 7.8 Export to MP4 with progress and cancel

```tsx
import { useState, useRef } from 'react'
import { useTimelineEngine, usePlaybackStore, lazyExportVideo } from '@elah/editor'

export function ExportButton() {
  const engine = useTimelineEngine()
  const [pct, setPct] = useState<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  async function run() {
    usePlaybackStore.getState().pause()          // always pause first
    const controller = new AbortController()
    abortRef.current = controller
    setPct(0)

    try {
      const blob = await lazyExportVideo(engine.getProject(), {
        videoCodec: 'avc',
        audioCodec: 'aac',
        videoBitrate: 8_000_000,
        outputHeight: 1080,
        signal: controller.signal,
        // Progress is { frame, totalFrames } — compute the percentage yourself.
        onProgress: ({ frame, totalFrames }) =>
          setPct(Math.round((frame / totalFrames) * 100)),
      })

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'export.mp4'
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') throw err
    } finally {
      setPct(null)
      abortRef.current = null
    }
  }

  if (pct !== null) {
    return (
      <span>
        Exporting {pct}% <button onClick={() => abortRef.current?.abort()}>Cancel</button>
      </span>
    )
  }
  return <button onClick={run}>Export MP4</button>
}
```

`lazyExportVideo` code-splits the export pipeline so it isn't in your initial bundle.

### 7.9 Aspect-ratio switcher

```tsx
import { useTimelineEngine, useTracksStore } from '@elah/editor'

const PRESETS = [
  { label: '16:9', w: 1920, h: 1080 },
  { label: '9:16', w: 1080, h: 1920 },
  { label: '1:1',  w: 1080, h: 1080 },
]

export function AspectSwitcher() {
  const engine = useTimelineEngine()
  const stage = useTracksStore((s) => s.stage)

  return (
    <>
      {PRESETS.map((p) => (
        <button
          key={p.label}
          aria-pressed={Math.abs(stage.width / stage.height - p.w / p.h) < 0.001}
          onClick={() => engine.setStage(p.w, p.h)}   // NOT the EditorProvider prop
        >
          {p.label}
        </button>
      ))}
    </>
  )
}
```

### 7.10 Save and load a project

```ts
import { serializeProject, deserializeProject } from '@elah/editor'

// Both take the ENGINE, not a Project.
// serializeProject(engine) → string
// deserializeProject(engine, json) → void  (loads in place; throws on bad JSON)

const engine = useTimelineEngine()

localStorage.setItem('project', serializeProject(engine))

const saved = localStorage.getItem('project')
if (saved) {
  try {
    deserializeProject(engine, saved)
  } catch (err) {
    console.error('could not load project:', err)
  }
}
```

Serialization stores clip references, not media bytes. Re-import or re-host the media so the
`src` URLs still resolve. `deserializeProject` throws `Not valid project JSON: …` on bad JSON and a
`ProjectDocumentError` (`code: 'unreadable' | 'unsupported-version'`) on a document it cannot read
or one written by a newer build; the engine is left untouched. A document with no `version` stamp is read
as version 1. Always wrap it in a `try`.

`serializeProject` / `deserializeProject` are a thin facade over `readProjectDocument`. Use the reader
directly when you want to show a refusal before clearing the editor, and to repair media afterwards:

```ts
import { readProjectDocument, relinkProjectMedia, missingMediaSummary } from '@elah/editor'

engine.loadProject(readProjectDocument(JSON.parse(saved)))     // throws ProjectDocumentError

// Files the user imported from disk are blob: URLs and do not survive a reload.
// Once your media library is rebuilt, re-point clips at it and report what is gone:
const { project, missing } = relinkProjectMedia(engine.getProject(), assets) // assets from useMediaLibrary()
engine.loadProject(project, { transport: 'keep', history: 'keep' })  // keep playhead + undo
const note = missingMediaSummary(missing)                       // e.g. "a.mp4, b.mp4 and 3 more"
```

Missing clips are never dropped; they stay in place with their name and length so the user can
supply the file again.

To keep the media library itself (thumbnails, durations) across a reload, save
`snapshotMediaLibrary(mediaLibraryStore.getState())` somewhere you control (IndexedDB, say) and put it
back with `hydrateMediaLibrary(entries, { referencedSrcs })`. Storage is yours; the bytes of files
imported from disk are not part of the snapshot.

The playback preferences (`zoom`, `volume`, `muted`, `playbackRate`, `loop`, `snapEnabled`) are not part
of the project: they persist separately in `localStorage`.

### 7.11 Re-theme with design tokens

The white-label path. Override `--elah-*` variables inside `.elah-root` — no forking, no
overriding SDK internals:

```css
.elah-root {
  --elah-bg:            #0b0b12;
  --elah-bg-secondary:  #12121c;
  --elah-bg-panel:      #171726;
  --elah-bg-card:       #1e1e30;
  --elah-bg-elevated:   #262640;

  --elah-border:        #2e2e48;
  --elah-border-subtle: #232338;

  --elah-text:           #e8e8f0;
  --elah-text-secondary: #b4b4c8;
  --elah-text-muted:     #7e7e96;

  --elah-accent:       #7c3aed;
  --elah-accent-hover: #8b5cf6;
  --elah-accent-text:  #ede9fe;
}
```

Anything you don't override keeps its default from `tokens.css`, so partial overrides are
safe. Clip colours are themeable too — `--elah-clip-video-*`, `--elah-clip-audio-*`,
`--elah-clip-text-*`, `--elah-clip-image-*`, `--elah-clip-shape-*`, `--elah-clip-freehand-*`
(each has `-top`, `-mid`, `-bottom`, `-accent`).

For structural changes, pass `classNames` to `<Timeline>` to target individual slots.

### 7.12 Batch several edits into one undo step

```ts
engine.batch(() => {
  engine.removeClip(oldId, trackId)
  engine.addClip({ type: 'text', trackId, startFrame: 0, durationFrames: 60,
                   text: { content: 'Replaced' } })
}, 'Replace title')
```

---

## 8. Common mistakes

Each of these has been observed in real generated code.

| ❌ Wrong | ✅ Right |
| --- | --- |
| `import '@elah/editor/styles.css'` only | Import **all three** stylesheets ([§3](#3-the-three-stylesheets-most-common-mistake)) |
| `npm install @elah/editor` alone | Also install `lucide-react` — it is a required peer |
| `exportVideo(project, { fps: 30, demuxerFactory })` | Neither option exists. fps comes from the project; export builds its own decode pipeline |
| `progress.percent` / `progress.phase` | `ExportProgress` is `{ frame, totalFrames }` — compute the percentage yourself |
| `clip.text.content` on a resolved/stored clip | Flat: `clip.content`, `clip.fontSize`, `clip.color`. Nesting applies **only** when *creating* (`addClip({ type: 'text', text: {...} })`) |
| Changing `<EditorProvider fps>` to change fps | Read once on mount. Use `engine.setStage(w, h)` for the canvas; fps is fixed per project |
| `<Timeline />` with no height | Give it an explicit height — it fills its container and collapses to zero otherwise |
| Rendering the editor without `.elah-root` | Wrap it: that class scopes the `--elah-*` tokens |
| `createDefaultDemuxerFactory()` in the component body | Call it once at module scope or in a `useRef` |
| `usePlaybackStore(s => s)` | Narrow selector: `usePlaybackStore(s => s.isPlaying)` |
| Writing to a store to change a clip | Go through the engine: `engine.updateClip(...)` |
| `updateClip` on every slider tick | `previewClip` during the gesture, one `commitInteraction()` at the end |
| Server-rendering the editor | Browser-only. `dynamic(..., { ssr: false })` in Next.js |
| Time in seconds | Integer frames. Convert with `secondsToFrames(s, fps)` |
| Assuming `<EditorProvider>` defaults to landscape | Default stage is portrait 1080x1920. Pass `stage={{ width: 1920, height: 1080 }}` |
| Telling users they can rotate a video or image clip by dragging | There is no rotate handle for video/image (text has a knob). Set `transform.rotation` via `engine.updateClip` |
| `import { compileVideoSpec, applyOps, validateScene } from '@elah/editor'` | The 1.0.0 programmatic layer is **not** re-exported by the editor: import it from `@elah/core` |
| `switch (clip.type)` or `switch (transition.kind)` with no `default` | `ClipType` has 10 members and `TransitionKind` has 9; handle the rest or add a `default` |
| Expecting `wipe` to honour `direction`, or a vertical `slide` from the 2D fallback | `slide` and `whip` take a direction; `wipe` and the rest ignore it. Without WebGL2 only fade, wipe and a left/right slide export |
| Promising users an editing panel for compound, generator, sequence or adjustment clips | They play, save and export, but `@elah/editor` has no UI to edit them yet |
| Handing `sceneToClip` raw HTML | It takes a **measured** scene (`MeasuredScene`); measuring needs a browser DOM and is your host's step |
| Text in Telugu, Hindi, Arabic, CJK, Cyrillic or Greek with a bundled font | The 12 bundled fonts are a Latin subset; other scripts fall back to a generic family |
| Expecting `applyTextTemplate` to stagger lines or add letter-spacing | It ignores `stagger` and `tracking`; build that yourself |
| Two overlapping video clips in an `elah build` spec | The spec puts every video clip on one track, so overlap is a build error. Sequence them, or build the project with the engine and use `elah export` |
| A custom demuxer with `{ probe, demux, destroy }` | `DemuxerBackend` is `{ open(src), getConfig(), packets(range), seekToKeyframe(t), dispose() }` |

---

## 9. Browser support and host platforms

**Required:** WebGL2, WebCodecs, Web Workers, Web Audio, `OffscreenCanvas`.

**Chromium 108+ is the supported baseline** (Chrome, Edge, Arc, Brave). Firefox has partial
support — preview works, export is codec-dependent. Rather than version-sniffing, feature-detect
before showing an export button:

```ts
const canExport = typeof VideoEncoder !== 'undefined' && typeof OffscreenCanvas !== 'undefined'
```

**Host platform notes:**

- **Lovable, and other Vite + React hosts** — fully supported. Use the Vite config in
  [§4](#4-bundler-setup) and start from [§7.1](#71-minimal-working-editor).
- **v0 / Next.js hosts** — supported. `transpilePackages` plus `dynamic(..., { ssr: false })`
  are both mandatory.
- **bolt.new / StackBlitz (WebContainers)** — preview works; **MP4 export generally does not**,
  because WebCodecs in the container environment is unreliable. Build and test export on a real
  browser deployment.
- **Google AI Studio / Emergent** — standard React apps; follow the Vite path.

Media is never uploaded. Everything — decode, render, encode — happens in the user's browser,
so a large export is bounded by their machine, not by a server.

---

## 10. Headless rendering with `@elah/cli`

For server-side or no-UI rendering (an AI backend that emits a video), `@elah/cli` runs the same
engine and export pipeline in headless Chrome. The published version **0.1.2** depends on `@elah/core@^0.6.0`
and exports 0.6.x projects; the next CLI release depends on `@elah/core@^1.0.0` and exports version 5 projects.
Node >= 18.17 and a system Chrome (or `--browser <path>` / `ELAH_BROWSER`) are required for
export.

```bash
npx @elah/cli build --spec spec.json --export final.mp4                    # spec -> project -> MP4
npx @elah/cli export --project project.json --out final.mp4 --height 1080  # --height = SHORT edge
npx @elah/cli serve --port 8080 --concurrency 2 --media-root ./assets      # HTTP render server
curl -X POST --data-binary @spec.json http://127.0.0.1:8080/render -o out.mp4
```

`elah serve` exposes `GET /healthz` and `POST /render` (body = a build spec; `422` on a bad spec,
`503` + `Retry-After` when at `--concurrency`). `split` and `trim` commands also exist.

The **build spec** is seconds-based JSON; times are converted to frames at `fps` (default 30), and
`stage` defaults to 1920x1080:

```json
{
  "fps": 30,
  "assets": { "footage": "./clip.mp4", "music": "./song.mp3" },
  "clips": [
    { "track": "video", "asset": "footage", "start": 0, "duration": 8 },
    { "track": "text", "text": "Hello", "start": 0.5, "duration": 4, "fontSize": 96, "x": 0.5, "y": 0.15 },
    { "track": "audio", "asset": "music", "start": 0, "duration": 8, "volume": 0.5 }
  ]
}
```

Rules a generator must follow: every **video clip lands on one video track, so overlapping video
clips are a spec error** (the engine allows several video tracks; the spec cannot name one).
Overlapping text, image and audio clips are placed on extra tracks automatically, and a clip bumped
to a later track renders *beneath* the one it overlaps. Unknown fields are rejected by name, text
clips need an explicit `duration`, and the spec has no speed, crop, template or transition fields.
Errors are path-addressed (`clips[2].duration must be ...`) so a model can correct itself. Node API:
`build({ spec, baseDir })`, `exportProject({ project, outPath })`, `createRenderSession()`.

---

## 11. Writing videos and scenes with a model

Since 1.0.0 a model can also *author* a video: it writes a small document, the engine compiles it to
ordinary, editable clips and keyframes, and a person can open the result on the timeline. There are
two document formats. **Both are experimental** (they may change in a minor release); the project
they produce is an ordinary `Project` and stays readable.

Import all of this from **`@elah/core`**, not from `@elah/editor`: the editor barrel does not
re-export these layers. `@elah/editor` already depends on `@elah/core`; still list it in your own
`package.json` (pnpm and yarn will not resolve it otherwise).

| Use | When |
| --- | --- |
| **VideoSpec** (`compileVideoSpec`, `buildVideo`) | The default. A seconds-based JSON document of text, shapes, icons, images, audio and generators with presets for entrance, exit and reveal. Never throws; every problem is a path-addressed issue the model can repair. |
| **HTML/CSS scene** (`validateScene`, `sceneToClip`) | When the model is better at CSS layout (flex, grid, gradients, shadows) than at coordinates **and** your host can measure a DOM. The scene becomes one compound clip. |

### 11.1 VideoSpec, worked example

```ts
import { compileVideoSpec, layProject, TimelineEngine, specVocabulary } from '@elah/core'
import type { VideoSpec } from '@elah/core'

const spec: VideoSpec = {
  version: 1,
  title: 'Launch card',
  format: { width: 1080, height: 1920, fps: 30 },
  duration: 4,                                  // seconds
  background: '$bg',
  design: {
    colors: [
      { name: 'bg', value: '#0b1020' },
      { name: 'ink', value: '#ffffff' },
      { name: 'accent', value: '#ffd166' },
    ],
    fonts: [
      { role: 'sans', font: 'inter' },
      { role: 'display', font: 'bebas-neue' },
    ],
  },
  elements: [
    { id: 'ring', kind: 'shape', shape: 'arc', at: 0.2, duration: 3.6, w: 420, h: 420,
      stroke: '$accent', strokeWidth: 18, cap: 'round', x: 0.5, y: 0.4,
      draw: { duration: 1.2, curve: 'cubic-out' } },
    { id: 'big', kind: 'text', at: 0.4, duration: 3.4, text: '72%', font: '$display', size: 220,
      color: '$ink', x: 0.5, y: 0.4, enter: 'pop-in', exit: 'fade-out' },
    { id: 'label', kind: 'text', at: 0.8, duration: 3, text: 'of attacks start on free Wi-Fi',
      font: '$sans', size: 48, color: '$ink', maxWidth: 800, x: 0.5, y: 0.62,
      reveal: { preset: 'word-rise', stagger: 0.08, duration: 0.4 } },
  ],
}

const { project, issues, fontIds } = compileVideoSpec(spec, { seed: 1 })
// issues: [] here. A mistake comes back as data, e.g. font: '$nope' gives
// { severity: 'error', path: 'elements[0].font', code: 'unknown-token', message: 'unknown font role "$nope"' }
// The element is kept and the bad field dropped, so feed the issues back to the model and recompile.

const engine = new TimelineEngine({ fps: 30, stage: { width: 1080, height: 1920 } })
layProject(engine, project, { description: 'Add launch card' }) // one undo step
// fontIds lists the bundled fonts to load before previewing (see "Fonts" below).
```

Rules for the model (the full list, with every preset, icon and generator, is what
`specVocabulary()` returns: paste it into the system prompt rather than retyping it):

- Times are **seconds**; positions are fractions of the stage (`x: 0.5, y: 0.5` is the centre); sizes are stage px.
- `kind` is one of `text | shape | icon | image | audio | generator | group`. `shape` is one of
  `rect | circle | ellipse | triangle | polygon | line | path | arc`.
- Fonts and colours are tokens from `design` (`"$ink"`, `"$sans"`) or a raw hex / bundled font id.
  Only the 12 bundled fonts exist. Icons come only from the listed Lucide names.
- `layer` orders elements; a `group` holds children whose `at` is relative to the group.
- `buildVideo(authoredSpec)` takes the same document plus `kind: 'component'` elements (17 motion
  components such as `kinetic-title`, `stat-ring`, `quote-card`, `checklist`) and `system` behaviours
  (`swarm`, `radialPush`, `freeze`, `arrange`, `crossMorph`, `camera`), expands them, polishes the timing and compiles:
  `buildVideo(authored, { seed: 1 })` returns the same `{ project, issues }` plus the expanded spec.
- `compileVideoSpec` and `buildVideo` are deterministic for a given `seed`.

### 11.2 HTML/CSS scene, worked example

The model writes an HTML fragment and one stylesheet in a **whitelisted subset**. Validate it first;
every refusal names the supported substitute so the model can retry.

```ts
import { validateScene } from '@elah/core'

const html = '<section id="card"><h1 id="big" data-motion="in: slide-in-up 0.4s overshoot @0.2">72%</h1>' +
             '<p id="label" data-motion="in: fade-in 0.3s @0.5">of attacks start on free Wi-Fi</p></section>'
const css = '#card { width: 1080px; height: 1920px; background: #0b1020 }' +
            '#big { position: absolute; left: 80px; top: 800px; width: 900px; font-family: bebas-neue; font-size: 220px; color: #ffffff }' +
            '#label { position: absolute; left: 80px; top: 1040px; width: 900px; font-family: inter; font-size: 48px; color: #9aa4b2 }'

const { ok, violations } = validateScene({ html, css })
// ok: true, violations: []. Had the css said "animation: spin 1s; text-transform: uppercase":
// [{ element: '#a', property: 'animation', message: 'CSS animation is not supported', substitute: 'data-motion on the element' },
//  { element: '#a', property: 'text-transform', message: 'text-transform is not supported', substitute: 'write the text in the case you want' }]
```

The subset, in short. **Tags:** `div section header footer p h1-h6 span ul ol li svg img` (no `script`,
`canvas`, `iframe`, `video`, `button`, `a`, `table`, `br`; use spans and divs). **Layout:** `position`
static/relative/absolute, `display` block/flex/grid/inline-block/none, flex and grid properties, px sizes. **Look:**
colours, linear/radial/conic gradients, one outer `box-shadow`, per-corner `border-radius`, `opacity`,
`mix-blend-mode` (the engine's blend modes), `clip-path` (inset, circle, ellipse, path), `overflow: hidden`,
`filter: blur() | drop-shadow()`, `text-shadow`, `-webkit-text-stroke`, gradient text, underline and line-through.
**Refused, with a substitute:** `transform` (use `translate`, `rotate`, `scale`), `animation` and `transition` (use
`data-motion`), `@keyframes`, `@font-face`, `@import`, `url()`, external URLs, pseudo-classes, `backdrop-filter`,
`text-transform`, `perspective`, inset or multiple shadows. **Selectors:** `:root`, `#id` and `.class` only.
**Fonts:** one bundled family per element (an unknown font is refused and the nearest bundled one named).

`data-motion` is a one-line language in the engine's own vocabulary, clauses separated by `;`:
`in: pop-overshoot 0.4s @0.2; x: 0.30 → 0.50 0.6s overshoot @1.0; opacity: hold 0.5s @2; out: blur-out 0.3s @-0.3; stagger: children 4f`.
It also takes `repeat` / `yoyo`, `spring:<preset>` eases, relative positions (`@<`, `@>0.2`, `@label+0.3`), `path:`,
`split:` / `each:` text animators, `scramble:` and the `skewX`, `skewY`, `rotateX`, `rotateY` channels. A bad clause is
reported in the conversion report's `violations` and skipped; the scene still converts.

Converting needs the **measured** scene: the box, line breaks and resolved style of every node, as a
browser lays them out. Producing that is the host's step (mount the fragment in a hidden, stage-sized
element, wait for fonts, read the boxes); **no measurer ships in the packages**. A `MeasuredScene` is plain data, so
the conversion itself runs anywhere:

```ts
import { sceneToClip, TimelineEngine } from '@elah/core'
import type { MeasuredScene } from '@elah/core'

const scene: MeasuredScene = {
  name: 'stat', at: 0, duration: 4,            // seconds
  stage: { width: 1080, height: 1920 },
  root: {
    tag: 'section', id: 'card', box: { x: 0, y: 0, width: 1080, height: 1920 },
    style: { backgroundColor: 'rgb(11, 16, 32)' },
    children: [
      { tag: 'h1', id: 'big', box: { x: 80, y: 800, width: 900, height: 198 },
        style: { color: '#ffffff', fontFamily: 'bebas-neue', fontSize: 220, fontWeight: 400, lineHeight: 198, textAlign: 'left' },
        text: { lines: [{ text: '72%', box: { x: 80, y: 800, width: 900, height: 198 } }] },
        motion: 'in: slide-in-up 0.4s overshoot @0.2', children: [] },
      { tag: 'p', id: 'label', box: { x: 80, y: 1040, width: 900, height: 58 },
        style: { color: '#9aa4b2', fontFamily: 'inter', fontSize: 48, fontWeight: 400, lineHeight: 58, textAlign: 'left' },
        text: { lines: [{ text: 'of attacks start on free Wi-Fi', box: { x: 80, y: 1040, width: 900, height: 58 } }] },
        motion: 'in: fade-in 0.3s @0.5', children: [] },
    ],
  },
}

const { clip, report } = sceneToClip(scene, { fps: 30 })
// clip.type === 'compound'; report.native === 3 (a background rect and two text clips);
// report.skipped, report.substitutions and report.violations say what could not be mapped.

const engine = new TimelineEngine({ fps: 30, stage: { width: 1080, height: 1920 } })
const trackId = engine.addTrack('elements').id
const added = engine.addClip({
  trackId, type: 'compound', name: clip.name,
  startFrame: clip.startFrame, durationFrames: clip.durationFrames, compound: clip.compound!,
})
engine.updateClip(added.id, trackId, { transform: clip.transform })
// The project now holds a compound clip, so it is saved as document version 4.
```

### 11.3 Editing with ops

A model edits an existing project with typed ops instead of rewriting it. `sanitizeOps` repairs or drops
what it cannot trust (invented ops and stale ids, with a reason); `applyOps` applies the rest in one undo step.

```ts
import { sanitizeOps, applyOps, describeProject } from '@elah/core'

const prompt = describeProject(engine.getProject())            // a compact summary for the model
const { ops, dropped } = sanitizeOps(
  [{ op: 'addText', text: 'Hello world', at: 0.5, duration: 3, region: 'lower-third', motion: 'pop-in' }, { op: 'teleport' }],
  engine.getProject(),
)
// dropped: [{ index: 1, reason: ... }]   (the invented op)
const result = applyOps(engine, ops, { description: 'Add title' }) // result.applied, result.skipped, result.refs
```

There are 57 ops (`EDITOR_OP_NAMES`): text, shapes, generators, captions, lower thirds, keyframes and
expressions, motion presets, effects and looks, transitions, speed, cuts and ranges, markers, nesting and
more. `generateMedia` and `removeBackground` only place a placeholder and return it in `result.deferred`
for your host to run: no provider call ships.

### 11.4 Fonts

Text clips name one of the 12 bundled OFL families (Latin subset only). They load from `/fonts/` on your
host by default: copy `node_modules/@elah/core/fonts/` to your public `fonts/` folder, or, for an unbundled
import (a CDN), pass `{ fonts: { baseUrl: packageFontsBaseUrl() } }` to `exportVideo`. See the limitations in the
changelog and `CURRENT_LIMITATIONS.md`.

---

## Appendix: complete package layout

| Package | Purpose | Import it directly? |
| --- | --- | --- |
| `@elah/editor` | Full SDK: components + everything below re-exported | **Yes — this is the one you install** |
| `@elah/core` | Engine, resolver, renderer, export. Zero React. Also the 1.0.0 programmatic layer: effects, generators, motion, VideoSpec, HTML scenes, ops | For custom renderers, non-React hosts, and anything in [§11](#11-writing-videos-and-scenes-with-a-model) |
| `@elah/react` | React bindings (context + store hooks) | Rarely — `@elah/editor` re-exports these |
| `@elah/timeline` | The `<Timeline>` UI | Rarely — same |
| `@elah/cli` | Headless server-side rendering (`elah build / export / serve`), see [section 10](#10-headless-rendering-with-elahcli) | Separate Node tool, versioned independently (0.1.2) |

Bundle cost: `@elah/core` grew a lot in 1.0.0 (about 1.2 MB as a tarball, half of it optional fonts), and the 1.0.0 bundle figures are not published yet, so do not quote a number from an older version of this guide. `mediabunny` (the demuxer) loads lazily on first decode unless the app calls `createDefaultDemuxerFactory()`, whose static import puts it in the startup graph. Import `@elah/core/engine` for the engine without the renderer or the codec.
