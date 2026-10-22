# @elah/editor

The full Elah video editor SDK for React. Combines the core engine, timeline UI, WebGL2 renderer, media library, and export pipeline into a single package.

Ships `EditorProvider`, `Preview` (WebGL2 canvas + interactive transform overlays), `Timeline`, `AssetPanel`, `SourcePanel`, and `ElementsPanel`, and re-exports the public `@elah/core`, `@elah/react`, and `@elah/timeline` API — so most apps only ever import from `@elah/editor`. (Renderer and debug internals, and the 1.0.0 programmatic layer, are the exception; import those from `@elah/core` directly.) Supports video, image, text, **shape**, and **freehand** clips, **multiple video tracks**, **multi-track audio**, and export to MP4, WebM, GIF or a PNG sequence. Projects that use the newer **adjustment**, **generator**, **compound** and **sequence** clips, and the nine transitions, open, play, save and export; `@elah/editor` has no editing UI for those clips yet.

**1.0.0:** the exports of this package follow semver. The 1.0.0 programmatic layer (effects, generators, motion helpers, VideoSpec, HTML scenes, editor ops, `packageFontsBaseUrl`) is **not** re-exported here: import it from `@elah/core`, which this package already depends on (list it in your own `package.json`). VideoSpec, `vector/html` and the op vocabulary are experimental; see [the changelog](../../CHANGELOG.md).

[![npm](https://img.shields.io/npm/v/@elah/editor)](https://www.npmjs.com/package/@elah/editor)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/elahlabs/elah/blob/main/LICENSE)

---

## Install

```bash
npm install @elah/editor
```

Peer dependencies: `react`, `react-dom` >= 18, `lucide-react` >= 0.400.0 (used by the
bundled `@elah/timeline` UI for clip icons — install it alongside `react`/`react-dom`
even though nothing in your own code imports it).

**Bundle size:** the 1.0.0 figures are not published yet; [BUNDLE_STRATEGY.md](../../BUNDLE_STRATEGY.md) explains how they are measured. `@elah/core` grew substantially in 1.0.0 (it now carries the motion layer, effects and the model-facing layers); import `@elah/core/engine` directly if you need only the engine. `createDefaultDemuxerFactory()` imports `mediabunny` statically, so it pulls the codec into the startup graph; every other path loads it lazily.

---

## Quick start

```tsx
import { EditorProvider, Timeline } from '@elah/editor'

function App() {
  return (
    <EditorProvider fps={30}>
      <Timeline style={{ height: 300 }} />
    </EditorProvider>
  )
}
```

---

## Styling

Import the compiled stylesheets once. They are plain CSS — your app does **not**
need Tailwind, and no utility class names leak into your global scope (preflight
is disabled, so nothing resets your elements):

```ts
import '@elah/timeline/styles.css'
import '@elah/editor/styles.css'
import '@elah/editor/styles/tokens.css' // --elah-* dark defaults (standalone)
```

When embedding inside an app that already defines `.elah-root` (mapping `--elah-*`
onto its own design system), skip `tokens.css`. Re-theme or white-label by
overriding `--elah-*` variables in your own `.elah-root` scope — see
[design-tokens.md](https://github.com/elahlabs/elah/blob/main/docs/design-tokens.md).

---

## With preview and asset panel

```tsx
import { EditorProvider, Timeline, Preview, AssetPanel, createDefaultDemuxerFactory } from '@elah/editor'

const demuxerFactory = createDefaultDemuxerFactory()

function App() {
  return (
    <EditorProvider fps={30}>
      <div style={{ display: 'flex', height: '100vh' }}>
        <AssetPanel style={{ width: 220 }} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <Preview demuxerFactory={demuxerFactory} style={{ flex: 1 }} />
          <Timeline style={{ height: 300 }} />
        </div>
      </div>
    </EditorProvider>
  )
}
```

---

## Import media

```ts
import { importFiles, importUrl, importBlob, beginImportUrl, useMediaLibrary } from '@elah/editor'

await importFiles(Array.from(fileList))          // local files
await importUrl('https://example.com/clip.mp4')  // remote URL (waits for metadata)
const pending = await beginImportUrl('https://example.com/clip.mp4') // returns at once, status: 'pending'
await importBlob(recordedBlob, { name: 'take-1.webm' })

// Subscribe in React — useMediaLibrary() takes no arguments and returns
// { assets, getAsset, removeAsset, updateAsset, importFiles, importUrl, importBlob }
// with assets in insertion order. `useAssets` is an alias for the same hook.
const { assets, importFiles: addFiles } = useMediaLibrary()
```

`beginImportUrl` is for "add to timeline" from a remote gallery: place a clip right away
and let it resize itself once the real duration arrives. Pair it with
`growClipToAssetDuration` (see [`@elah/timeline`](https://www.npmjs.com/package/@elah/timeline)).
`determineAssetHasAudio` answers whether a video has an audio track.

### Programmatic insertion (no drag)

```ts
import { insertMediaAsset } from '@elah/editor'

// Place an imported asset onto the timeline — powers tap-to-add on touch.
// Returns a typed InsertAssetResult ({ ok, kind, trackId, clipIds } | { ok:false, reason }).
const result = await insertMediaAsset(engine, assetId, { desiredStartFrame: 0 })
```

---

## Multiple video tracks

`engine.addTrack('video')` always adds a lane. Video tracks composite in track order
(topmost lane draws on top) and a new one lands directly below the last video track.

---

## Preview overlays, crop and speed

`<Preview>` paints the interactive overlays for you. **Text** clips: drag, resize, a rotate knob
(Shift snaps to 15°) and inline edit. **Video and image** clips (`MediaTransformOverlay`): drag,
8 resize handles with non-uniform scale (Shift keeps the aspect ratio), and a Resize/Crop toggle
that edits `Clip.crop`. There is no rotate handle for video or image clips; the box tilts with
`transform.rotation`, which you set through the engine. Clip speed (`engine.setClipSpeed`,
0.25–4) and `Clip.cornerRadius` are engine-level fields.

---

## Text templates and frame sequences

```ts
import { BUILT_IN_TEXT_TEMPLATES, applyTextTemplate, createFrameSequence, frameSequenceToProject } from '@elah/editor'

engine.updateClip(clip.id, clip.trackId, applyTextTemplate(BUILT_IN_TEXT_TEMPLATES[0], clip)) // one undo entry
```

14 built-in looks with layered entry/exit motion (`MotionSpec`). A template's `stagger` and
`tracking` are data that `applyTextTemplate` ignores, and rotation motion has no effect on shape
clips. Transitions are `fade`, `slide` and `wipe` (`slide` goes left only for `direction: 'left'`,
`wipe` ignores direction). Frame sequences, `snapshotMediaLibrary` / `hydrateMediaLibrary` and the
rest are documented in [`@elah/core`](https://www.npmjs.com/package/@elah/core); everything is
re-exported from this package.

---

## Save and restore

```ts
import { serializeProject, deserializeProject } from '@elah/editor'

localStorage.setItem('project', serializeProject(engine))
deserializeProject(engine, localStorage.getItem('project')!) // throws, engine untouched, if unreadable
```

For control over the refusal, read first, then load:
`engine.loadProject(readProjectDocument(JSON.parse(json)))`. `readProjectDocument` throws
`ProjectDocumentError` (`'unreadable'` or `'unsupported-version'`). Files imported from
disk are `blob:` URLs that do not survive a reload; after your media library is rebuilt,
`relinkProjectMedia(project, assets)` re-points clips at it and lists what is `missing`
(never dropped). Load its result with `{ transport: 'keep', history: 'keep' }` so the
playhead and undo stack stay put. See [`@elah/core`](https://www.npmjs.com/package/@elah/core).

---

## Export to MP4

```ts
import { exportVideo } from '@elah/editor'

const blob = await exportVideo(engine.getProject(), {
  videoBitrate: 8_000_000,
  outputHeight: 1080, // the stage's short edge: 1920×1080 landscape or 1080×1920 portrait
  onProgress: ({ frame, totalFrames }) => {
    console.log(`${Math.round((frame / totalFrames) * 100)}%`)
  },
})
```

Runs in a web worker. Reuses `resolveTimeline` + the GPU renderer's placement math.

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Space` | Play / pause |
| `S` | Split clip at playhead |
| `Delete` / `Backspace` | Delete selected clip(s) |
| `Ctrl/Cmd + C` | Copy |
| `Ctrl/Cmd + V` | Paste at playhead |
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Shift + Z` / `Ctrl/Cmd + Y` | Redo |
| `Ctrl/Cmd + scroll` | Zoom |
| `← / →` | Step one frame |

---

## Package layers

```
@elah/core      — engine, playback, resolver, vanilla stores, media, export (framework-agnostic)
@elah/react     — React bindings: EditorContext, store hooks, audio hooks
@elah/timeline  — React timeline UI components and hooks (consumes @elah/core + @elah/react)
@elah/editor    — EditorProvider, Preview, AssetPanel + re-exports @elah/core, @elah/react, @elah/timeline
@elah/cli       — headless split/trim/build/export/serve on top of @elah/core
```

Use `@elah/editor` for the full in-browser experience. Use `@elah/core` directly
for headless or custom rendering pipelines, or pair it with `@elah/react` if you
want the hooks without the timeline UI. Use `@elah/cli` for automation,
AI-generation pipelines, and server-side rendering.

**One active project per page.** `@elah/core`'s stores (`tracksStore`,
`playbackStore`, `selectionStore`, `transitionsStore`, `mediaLibraryStore`, `textStylePresetsStore`, `clipLoadStore`) are
module-level singletons, and `<EditorProvider>` wires the `TimelineEngine` /
`PlaybackEngine` it creates into those same shared stores. Mounting a second
`<EditorProvider>` on the same page (two independent projects at once) will have
both instances overwrite each other's state — there is currently no per-instance
scoping. If you need multiple concurrent editors, isolate each in its own
tab/window/iframe.

---

## Links

- [Website](https://www.elah.dev)
- [GitHub](https://github.com/elahlabs/elah)
- [Discord](https://discord.gg/qKJXvc4Pwu)
- [Headless CLI — @elah/cli](https://www.npmjs.com/package/@elah/cli)
- [License](https://github.com/elahlabs/elah/blob/main/LICENSE)
- [Commercial licensing](mailto:paul@elah.dev)
