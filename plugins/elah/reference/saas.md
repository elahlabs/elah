# Building a video editor on the Elah libraries

What a scaffolded app is, which package does what, and the traps that cost an afternoon. Read this before writing any file
for `skills/saas`.

## The packages

Four published packages, all Apache-2.0, all browser-only (no server, no upload, no key):

| Package | What it is | Take it when |
| --- | --- | --- |
| `@elah/core` | The engine: project model, timeline resolve, playback, GPU renderer, export, clip factories, pure geometry. No React. | Always — the others depend on it |
| `@elah/react` | React bindings: `EditorProvider`, the `use*Store` hooks, media library hooks | Any React app |
| `@elah/timeline` | The timeline UI: ruler, tracks, clips, playhead, trim and drag | You want the timeline strip |
| `@elah/editor` | The whole editor: `Preview`, `AssetPanel`, `ElementsPanel`, `SourcePanel`, plus a barrel re-exporting the public API of the other three | Almost always — one import path |

`@elah/editor` re-exports the public API of core, react and timeline, so an app that installs it imports everything from
`@elah/editor` and nothing else. Install the others directly only when the app does not want the editor chrome (a player-only
build takes `@elah/core` + `@elah/react`).

Two more exist and are usually not part of a scaffold: `@elah/cli` (headless render with Chrome + ffmpeg, Node only) and
`@elah/react-native` (0.x, the mobile bindings).

**Resolve the versions at scaffold time** — run `npm view @elah/editor version` and pin `^<that major.minor>`; never copy a
version number out of this file or out of the monorepo's `package.json`, which runs ahead of what is published.

## The three stylesheets

All three, in this order, before your own CSS:

```ts
import '@elah/timeline/styles.css'       // ruler, tracks, clips, playhead, trim handles
import '@elah/editor/styles.css'         // Preview, AssetPanel, ElementsPanel, SourcePanel
import '@elah/editor/styles/tokens.css'  // the --elah-* design tokens both consume
import './app.css'                       // yours last, so it can override
```

`@elah/timeline` compiles its own Tailwind build scanning only its own source, so `@elah/editor/styles.css` does **not**
contain the timeline's classes. Missing the first import gives a timeline with no layout — the classic "it rendered but it
looks broken" report. Skip `tokens.css` only when the app already defines the `--elah-*` tokens inside `.elah-root`.

Branding is those tokens, redefined under `.elah-root` in the app's own CSS. That is the whole theming story: do not fork the
packages to change a colour.

## Shape of the app

```
EditorProvider            // one per app: owns the engine, the stores, the demuxer factory
 ├─ your header           // play/pause, undo/redo, zoom, Export — your buttons, engine calls
 ├─ AssetPanel            // media the user adds (files stay in the browser)
 ├─ Preview               // the canvas
 ├─ ElementsPanel         // text, shapes, properties for the selection
 └─ Timeline              // tracks, clips, playhead
```

`EditorProvider` takes the initial tracks and a demuxer factory:

```tsx
const INITIAL_TRACKS: InitialTrackConfig[] = [
  { kind: 'video', name: 'Video / Image' },
  { kind: 'elements', name: 'Elements' },
  { kind: 'audio', name: 'Audio' },
]
```

Track order is top-to-bottom in the UI and a lower index renders in front. Any number of `audio` and `elements` tracks is
allowed. Pass `createDefaultDemuxerFactory()` unless the app has its own.

State is read with the hooks (`useTracksStore`, `usePlaybackStore`, `useSelectionStore`, `useTimelineEngine`) inside
components, and with the vanilla stores (`tracksStore`, `playbackStore`, ...) in event handlers and imperative code. Both come
from `@elah/editor`.

Clips are made with the factories (`createVideoClip`, `createAudioClip`, `createTextClip`, `createImageClip`,
`createShapeClip`, `createFreehandClip`) — never by writing the clip object literal, which skips defaults the engine relies on.

Projects round-trip with `serializeProject` / `deserializeProject`; export runs with `exportVideo` (or `lazyExportVideo` to
keep the encoder out of the first bundle) and reports `ExportProgress`.

## What `examples/` already proves

The repository's `examples/` folder holds three working apps installed from npm, not from the monorepo. They are the honest
starting point for a scaffold, and a scaffold that diverges from them for no reason is a scaffold that will not run:

- `examples/minimal` — plain Vite, player only, no editor chrome.
- `examples/react` — Vite + React, the full `ProductionEditor` (header, panels, timeline, export modal, text properties).
- `examples/next` — the same inside Next.js App Router.

If the repository is on disk, read the one that matches the chosen stack before writing files. If it is not, the shape above
plus the package exports are enough.

## Traps

- **Next.js:** the editor is browser-only. The page that holds it is a client component, and the editor itself is loaded with
  `next/dynamic` and `ssr: false`. Rendering it on the server throws on `window`.
- **React 18 or 19**, both fine; `lucide-react` is a real peer dependency of `@elah/timeline` and `@elah/editor` — install it
  or the icons fail to resolve at build.
- **StrictMode** double-invokes effects in development. The engine tolerates it; app code that attaches listeners in an effect
  must clean up, or playback fires twice.
- **No server.** Media the user adds stays in their browser; there is no upload, no account and no key anywhere in a
  scaffolded app. Do not add one unasked, and never tell the user the app stores their footage.
- **Export is the browser's work**: it needs WebCodecs, so it is Chrome, Edge or a recent Safari. Say so in the README rather
  than letting the user discover it.
- **Licence:** Apache-2.0. A scaffolded app may be commercial and closed. Keep the `NOTICE` requirement in mind for a
  redistributed build and leave the packages' own licence files alone.
