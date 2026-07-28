# @elah/react

React bindings for the [Elah](https://www.elah.dev) video engine.

`@elah/core` is framework-agnostic — it has zero React imports and runs in Node, workers, and non-React apps (Vue, Svelte, plain JS). This package is the React layer on top of it:

- **Editor context** — `EditorContext`, `useEditor`, `useTimelineEngine`, `usePlaybackEngine`
- **Store hooks** — `useTracksStore`, `usePlaybackStore`, `useSelectionStore`, `useTransitionsStore`, `useMediaLibraryStore`, `useMediaLibrary` — React views over core's vanilla Zustand stores
- **Audio hooks** — `useAudioMixer`, `useMasterVolume`, `useTrackLevels`

Each store hook also carries the vanilla store API, so `useTracksStore(s => s.tracks)` and `useTracksStore.getState()` both work.

## Install

```bash
npm install @elah/react @elah/core react
```

Most apps should install [`@elah/editor`](https://www.npmjs.com/package/@elah/editor) instead — the batteries-included SDK that re-exports everything here alongside the timeline UI and `<EditorProvider>`.

## Usage

```tsx
import { useTimelineEngine, useTracksStore } from '@elah/react'

function TrackCount() {
  const engine = useTimelineEngine()
  const tracks = useTracksStore((s) => s.tracks)
  return <span>{tracks.length} tracks in {engine.getProject().id}</span>
}
```

## License

Apache-2.0
