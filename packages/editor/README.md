# @elah/editor

Engine-first video timeline SDK for React. Internally layered as `core/` → `timeline/` → `editor/`.

See the repo root [README](../../README.md) for project overview and the [core architecture reference](src/core/Architecture.md) for a cold-start guide to the engine.

## Install

This package is part of the monorepo workspace:

```bash
npm install
```

Peer dependencies: `react`, `react-dom` (>= 18).

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

## Import media files

Register local files into the media library from a file input or drop handler:

```ts
import { importFiles, useMediaLibraryStore } from '@elah/editor'

async function onFilesSelected(files: FileList | File[]) {
  const list = Array.from(files)
  const assets = await importFiles(list)

  // Assets are in the store immediately; thumbnails arrive shortly after.
  console.log(useMediaLibraryStore.getState().assets)

  // Subscribe in React via useMediaLibrary() for UI updates.
  return assets
}
```

`importFiles`:

- Creates object URLs and probes duration/dimensions via DOM media elements
- Skips unsupported MIME types with a console warning
- Registers assets in `useMediaLibraryStore` synchronously
- Generates JPEG thumbnails on the main thread and patches `thumbnailUrl` asynchronously

## AssetPanel

Browse, drop, and drag media assets from a sidebar panel. Render as a sibling of `<Timeline>` inside `<EditorProvider>`:

```tsx
import { EditorProvider, Timeline, AssetPanel } from '@elah/editor'

function App() {
  return (
    <EditorProvider fps={30}>
      <div style={{ display: 'flex', height: '100vh' }}>
        <AssetPanel style={{ width: 220 }} />
        <Timeline style={{ flex: 1 }} />
      </div>
    </EditorProvider>
  )
}
```

- **Add** opens a file picker; **drop** onto the panel imports via `importFiles`
- Thumbnails appear asynchronously after import
- Drag a thumbnail onto a timeline track lane to create a clip (see Timeline drop below)

## Timeline drop

With `<AssetPanel>` and `<Timeline>` as siblings inside `<EditorProvider>`, drag a thumbnail onto any track lane:

- Drop position becomes the clip `startFrame` (respects timeline zoom)
- Clip duration comes from the asset (`durationSec × project.fps`; images default to 5 seconds)
- Video/image assets go on video tracks; audio on audio tracks
- When snap is enabled (`usePlaybackStore.snapEnabled`), the drop snaps to the playhead and nearby clip edges

No extra wiring beyond `TrackRow` — `useTimelineDrop` is attached automatically per lane.

## Render pixels with `<Preview>`

`<Preview>` mounts the WebGL2 `GpuRenderer`, drives the RAF loop, and paints
interactive transform overlays — drag / uniform-scale for video & image clips
(`MediaTransformOverlay`), and drag / resize / inline-edit for text clips
(`TextOverlay`) — plus the project's audio.
Inject a **demuxer factory** so the SDK never hard-depends on a decode backend:

```tsx
import { EditorProvider, Preview, createMediabunnyBackend } from '@elah/editor'
import * as mediabunny from 'mediabunny'

const demuxerFactory = () =>
  createMediabunnyBackend(mediabunny, { blobResolver: (src) => fetch(src).then((r) => r.blob()) })

function App() {
  return (
    <EditorProvider fps={30}>
      <Preview demuxerFactory={demuxerFactory} style={{ height: 480 }} />
    </EditorProvider>
  )
}
```

Omit `demuxerFactory` for a synthetic dev preview (no media files, no mediabunny).
For a lower-level renderer handle, `GpuRenderer` is exported directly. See
[`src/core/renderer/README.md`](src/core/renderer/README.md).

## Export to MP4

```ts
import { exportVideo } from '@elah/editor'

const blob = await exportVideo(engine.getProject(), {
  videoBitrate: 8_000_000,
  onProgress: ({ frame, totalFrames }) => setPct(Math.round((frame / totalFrames) * 100)),
})
```

Runs in a worker; reuses `resolveTimeline` + the renderer's placement math. See
[`src/core/export/README.md`](src/core/export/README.md).

## Package layout

```
src/
  core/       types, engine, playback, resolver, stores, assets, media, export, debug, actions
  timeline/   Timeline UI + hooks
  editor/     EditorProvider, AssetPanel, Preview, useResolvedScene
```

## Scripts

```bash
npm run typecheck   # from packages/editor
npm run test
```

## License

To be decided — see root README.
