# @elah/react

React bindings for the [Elah](https://www.elah.dev) video engine.

[![npm](https://img.shields.io/npm/v/@elah/react)](https://www.npmjs.com/package/@elah/react)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/elahlabs/elah/blob/main/LICENSE)

`@elah/core` is framework-agnostic — it has zero React imports and runs in Node, workers, and non-React apps (Vue, Svelte, plain JS). This package is the React layer on top of it:

- **Editor context** — `EditorContext`, `useEditor`, `useTimelineEngine`, `usePlaybackEngine`
- **Store hooks** — `useTracksStore`, `usePlaybackStore`, `useSelectionStore`, `useTransitionsStore`, `useTextStylePresetsStore`, `useClipLoadStore`, `useMediaLibraryStore`, `useMediaLibrary` (alias `useAssets`) — React views over core's vanilla Zustand stores
- **Audio hooks** — `useAudioMixer`, `useMasterVolume`, `useTrackLevels`

`useTextStylePresetsStore` reads the reusable text looks; `useClipLoadStore(s => s.byClipId[clipId])` reports `'loading'` or `'error'` for a clip the preview cannot draw yet.

Each store hook also carries the vanilla store API, so `useTracksStore(s => s.tracks)` and `useTracksStore.getState()` both work.

`@elah/core` ships the stores as **module-level singletons** (one `tracksStore`, one `playbackStore`, etc. per JS realm), and this package's hooks bind to those exact instances — so only one active engine/project per page is supported today. `<EditorProvider>` (exported from this package since the React Native work; `@elah/editor` re-exports it, so existing imports keep working) wires a `TimelineEngine` + `PlaybackEngine` into these shared stores on mount; mounting a second `<EditorProvider>` (or manually wiring a second engine into `EditorContext.Provider`) on the same page will have both write into the same stores and clobber each other's state.

**1.0.0:** the exports of this package follow semver, released in lockstep with `@elah/core`, `@elah/timeline` and `@elah/editor` — a breaking change needs 2.0.

**Version note:** install `@elah/react` at the same release line as whatever `@elah/core` (and, if used, `@elah/timeline`/`@elah/editor`) version you're on — see each package's `peerDependencies`/`dependencies` range. A mismatched `@elah/core` copy (e.g. hoisted to a different version than what `@elah/react`/`@elah/timeline`/`@elah/editor` resolve internally) means two separate copies of these singleton stores exist, and state silently stops syncing between them.

## Install

```bash
npm install @elah/react @elah/core react
```

Peer dependency: `react` >= 18.

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

`<EditorProvider fps={30}>` builds the engine pair and keeps the stores in sync; wrap your
tree in it. It has no DOM dependency, so React Native uses the same component.

**React Native.** Value imports from `@elah/core` go through the browser-free
`@elah/core/engine` entry, so Metro can bundle this package. On iOS and Android, Metro picks
`useMediaLibrary.native`: same API and store, but `importFiles` / `importUrl` / `importBlob`
throw, because they are DOM importers. Mobile import is `@elah/react-native`'s job.

## License

Apache-2.0
