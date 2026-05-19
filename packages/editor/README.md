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

## Import media files (PR-07)

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

## AssetPanel (PR-08)

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
- Thumbnails appear asynchronously after import (PR-07)
- Drag a thumbnail onto a timeline track lane to create a clip (see Timeline drop below)

## Timeline drop (PR-09)

With `<AssetPanel>` and `<Timeline>` as siblings inside `<EditorProvider>`, drag a thumbnail onto any track lane:

- Drop position becomes the clip `startFrame` (respects timeline zoom)
- Clip duration comes from the asset (`durationSec × project.fps`; images default to 5 seconds)
- Video/image assets go on video tracks; audio on audio tracks
- When snap is enabled (`usePlaybackStore.snapEnabled`), the drop snaps to the playhead and nearby clip edges

No extra wiring beyond `TrackRow` — `useTimelineDrop` is attached automatically per lane.

## Package layout

```
src/
  core/       types, engine, playback, resolver, stores, media, actions
  timeline/   Timeline UI + hooks
  editor/     EditorProvider, AssetPanel, useResolvedScene (Preview arrives PR-10)
```

## Scripts

```bash
npm run typecheck   # from packages/editor
npm run test
```

## License

To be decided — see root README.
