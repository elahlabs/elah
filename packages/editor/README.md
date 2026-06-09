# @elah/editor

The full Elah video editor SDK for React. Combines the core engine, timeline UI, WebGL2 renderer, media library, and export pipeline into a single package.

[![npm](https://img.shields.io/npm/v/@elah/editor)](https://www.npmjs.com/package/@elah/editor)
[![license](https://img.shields.io/badge/license-ECL--1.0-blue)](https://github.com/elahlabs/elah/blob/main/LICENSE)

---

## Install

```bash
npm install @elah/editor
```

Peer dependencies: `react`, `react-dom` >= 18.

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
import { importFiles, useMediaLibrary } from '@elah/editor'

await importFiles(Array.from(fileList))

// Subscribe in React
const assets = useMediaLibrary(s => s.assets)
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
| `Ctrl/Cmd + Shift + Z` | Redo |
| `Ctrl/Cmd + scroll` | Zoom |
| `← / →` | Step one frame |

---

## Package layers

```
@elah/core      — engine, playback, resolver, stores, media, export (framework-agnostic)
@elah/timeline  — React timeline UI components and hooks
@elah/editor    — EditorProvider, Preview, AssetPanel + re-exports everything above
```

Use `@elah/editor` for the full experience. Use `@elah/core` directly for headless or custom rendering pipelines.

---

## Links

- [Website](https://www.elah.dev)
- [GitHub](https://github.com/elahlabs/elah)
- [License](https://github.com/elahlabs/elah/blob/main/LICENSE)
- [Commercial licensing](mailto:contact@elah.dev)
