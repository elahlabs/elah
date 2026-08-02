# @elah/editor

The full Elah video editor SDK for React. Combines the core engine, timeline UI, WebGL2 renderer, media library, and export pipeline into a single package.

Ships `EditorProvider`, `Preview` (WebGL2 canvas + interactive transform overlays), `Timeline`, `AssetPanel`, `SourcePanel`, and `ElementsPanel`, and re-exports the public `@elah/core`, `@elah/react`, and `@elah/timeline` API — so most apps only ever import from `@elah/editor`. (Renderer and debug internals are the exception; import those from `@elah/core` directly.) Supports video, image, text, **shape**, and **freehand** clips, **multi-track audio**, and MP4 export.

[![npm](https://img.shields.io/npm/v/@elah/editor)](https://www.npmjs.com/package/@elah/editor)
[![gzip size](https://img.shields.io/badge/gzip-~63%20KiB%20full%20SDK-brightgreen)](../../BUNDLE_STRATEGY.md)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/elahlabs/elah/blob/main/LICENSE)

---

## Install

```bash
npm install @elah/editor
```

Peer dependencies: `react`, `react-dom` >= 18, `lucide-react` >= 0.400.0 (used by the
bundled `@elah/timeline` UI for clip icons — install it alongside `react`/`react-dom`
even though nothing in your own code imports it).

**Bundle size:** ~10 KiB gzipped for the editor layer (51 KiB raw); ~63 KiB gzipped for the full SDK graph (`core` + `timeline` + `editor`, 330 KiB raw). `mediabunny` is injected, never bundled — see [BUNDLE_STRATEGY.md](../../BUNDLE_STRATEGY.md).

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
import { importFiles, importUrl, importBlob, useMediaLibrary } from '@elah/editor'

await importFiles(Array.from(fileList))          // local files
await importUrl('https://example.com/clip.mp4')  // remote URL
await importBlob(recordedBlob, { name: 'take-1.webm' })

// Subscribe in React — useMediaLibrary() takes no arguments and returns
// { assets, getAsset, removeAsset, updateAsset, importFiles, importUrl, importBlob }
// with assets in insertion order. `useAssets` is an alias for the same hook.
const { assets, importFiles: addFiles } = useMediaLibrary()
```

### Programmatic insertion (no drag)

```ts
import { insertMediaAsset } from '@elah/editor'

// Place an imported asset onto the timeline — powers tap-to-add on touch.
// Returns a typed InsertAssetResult ({ ok, kind, trackId, clipIds } | { ok:false, reason }).
const result = await insertMediaAsset(engine, assetId, { desiredStartFrame: 0 })
```

---

## Export to MP4

```ts
import { exportVideo } from '@elah/editor'

const blob = await exportVideo(engine.getProject(), {
  videoBitrate: 8_000_000,
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
`playbackStore`, `selectionStore`, `transitionsStore`, `mediaLibraryStore`) are
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
- [Discord](https://discord.gg/8CeZ2XbPy)
- [Headless CLI — @elah/cli](https://www.npmjs.com/package/@elah/cli)
- [License](https://github.com/elahlabs/elah/blob/main/LICENSE)
- [Commercial licensing](mailto:paul@elah.dev)
