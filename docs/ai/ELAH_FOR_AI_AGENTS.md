# Elah for AI agents — complete integration guide

**Everything needed to build a custom video-editor UI on `@elah/editor`, in one file.**

Written for AI coding tools that get one shot and no repo access — Lovable, Google AI Studio,
Emergent, v0, bolt.new — as well as repo-aware agents (Claude Code, Codex, Cursor, Gemini CLI).
Nothing here requires reading another file.

- **Version:** `@elah/editor@0.4.1` · **License:** Apache-2.0
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
[9 Browser support](#9-browser-support-and-host-platforms)

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
re-exports their public API — you import everything from `@elah/editor`.

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
  stage={{ width: 1920, height: 1080 }}      // default 1920x1080
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

`TimelineRef = { engine, playback, fitToWindow() }`. `TimelineClassNames` has slots for
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
| `useMediaLibrary()` / `useAssets()` | `{ assets, getAsset, removeAsset, updateAsset, importFiles, importUrl, importBlob }` |
| `useResolvedScene(frame?)` | The `Scene` at the current frame — for custom overlays |
| `useAudioMixer(controller)` | `{ setMasterGain, setTrackGain }` |
| `useMasterVolume(controller, engine)` | `{ masterVolume, setMasterVolume }` |
| `useTrackLevels(controller)` | `Map<trackId, { left, right }>` for VU meters |

**Always pass a narrow selector.** `usePlaybackStore(s => s.isPlaying)`, never
`usePlaybackStore(s => s)` — the latter re-renders 30-60× per second during playback.

Each store hook also carries `.getState()` and `.subscribe()` for imperative use outside
React. Outside React entirely, use the vanilla stores: `playbackStore`, `tracksStore`,
`selectionStore`, `transitionsStore`, `mediaLibraryStore`.

### `TimelineEngine`

```ts
const engine = useTimelineEngine()
```

**Read:** `getProject()` · `getTrack(trackId)` · `getClipsOnTrack(trackId)` ·
`findClip(clipId)` · `getTotalFrames()` · `canUndo()` · `canRedo()` · `isTrackLocked(trackId)`

**Project:** `setStage(width, height)` · `setMasterVolume(v)` · `loadProject(project)`

**Tracks:** `addTrack(kind, options?)` · `removeTrack(id)` · `updateTrack(id, updates)` ·
`reorderTracks(orderedIds)`

**Clips:** `addClip(options)` · `removeClip(clipId, trackId)` ·
`updateClip(clipId, trackId, updates)` · `moveClip(clipId, fromTrackId, toTrackId, startFrame)` ·
`trimClip(clipId, trackId, startFrame, durationFrames)` ·
`splitClip(clipId, trackId, atFrame)` → `[leftId, rightId] | null` · `cloneClip(clipId, trackId)`

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
```

All types also accept `name?`, `volume?`, `opacity?`, `transform?`, and
clip-relative `animations?`. Text clips additionally accept `textAnimation?`.

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
}
```

Normalized so a project is resolution-independent.

### Text animation

Animations attach to the text clip; do not create a separate animation track.
Preset and keyframe timing uses integer frame offsets from `clip.startFrame`:

```ts
interface TextAnimation {
  in?: 'fade' | 'slide' | 'pop' | 'typewriter'
  out?: 'fade' | 'slide' | 'pop' | 'typewriter'
  loop?: 'pulse'
  durationFrames: number
  inDurationFrames?: number
  outDurationFrames?: number
  loopDurationFrames?: number
  direction?: 'left' | 'right' | 'up' | 'down'
  easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'
}

interface AnimationChannel {
  property: 'opacity' | 'transform.x' | 'transform.y' |
            'transform.scale' | 'transform.rotation'
  keyframes: Array<{
    frame: number
    value: number
    easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'
  }>
}
```

`resolveTimeline(frame, project)` evaluates these into ordinary scene content,
opacity, and transform values. Renderers remain animation-agnostic, which keeps
scrubbing, browser preview, and export deterministic. Use
`evaluateAnimationChannel(channel, localFrame)` when custom tooling needs the
same interpolation behavior.

### Export

```ts
const blob = await exportVideo(project, options)      // eager
const blob = await lazyExportVideo(project, options)  // code-split; prefer this
```

```ts
interface ExportOptions {
  videoCodec?: 'avc' | 'vp9' | 'vp8'    // default 'avc'
  audioCodec?: 'aac' | 'opus'           // default 'aac'
  videoBitrate?: number                 // bits/s, default 8_000_000
  audioBitrate?: number                 // bits/s, default 128_000
  outputHeight?: number                 // e.g. 720; width derives from stage aspect
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

### Utilities

`framesToTimecode(frame, fps)` · `secondsToFrames(s, fps)` · `framesToSeconds(f, fps)` ·
`getTotalFrames(project)` · `generateId()` · `splitClipAtPlayhead(engine)` ·
`snapFrame(frame, points, threshold)` · `buildSnapPoints(clipsByTrack, excludeId?)` ·
`clipsOverlap(a, b)` · `DEFAULT_OVERLAP_TOLERANCE` ·
`serializeProject(engine)` → string / `deserializeProject(engine, json)` → void ·
`insertMediaAsset(engine, assetId, opts?)` · `insertElement(engine, payload, opts?)` ·
`importFiles(files)` / `importUrl(url)` / `importBlob(blob)`

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
`src` URLs still resolve. `deserializeProject` throws on invalid JSON or a schema-version
mismatch — always wrap it in a `try`.

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

## Appendix: complete package layout

| Package | Purpose | Import it directly? |
| --- | --- | --- |
| `@elah/editor` | Full SDK: components + everything below re-exported | **Yes — this is the one you install** |
| `@elah/core` | Engine, resolver, renderer, export. Zero React. | Only for custom renderers or non-React hosts |
| `@elah/react` | React bindings (context + store hooks) | Rarely — `@elah/editor` re-exports these |
| `@elah/timeline` | The `<Timeline>` UI | Rarely — same |
| `@elah/cli` | Headless server-side rendering (`elah build / export / serve`) | Separate Node tool |

Bundle cost: ~63 KiB gzipped for the full SDK graph. `mediabunny` (the demuxer) is injected at
runtime, never bundled.
