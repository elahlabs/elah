# Changelog

All notable changes to the Elah packages (`@elah/core`, `@elah/react`,
`@elah/timeline`, `@elah/editor`, `@elah/cli`) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the packages follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
`@elah/core`, `@elah/react`, `@elah/timeline`, and `@elah/editor` are released
together and share a version number. `@elah/cli` is a separate package and
versions independently, starting from its own 0.1.0.

## [Unreleased]

### Added

- **New package `@elah/react`** — all React bindings in one place: the editor
  context (`EditorContext`, `useEditor`, `useTimelineEngine`,
  `usePlaybackEngine`), store hooks (`useTracksStore`, `usePlaybackStore`,
  `useSelectionStore`, `useTransitionsStore`, `useMediaLibraryStore`,
  `useMediaLibrary`/`useAssets`), and the audio hooks (`useAudioMixer`,
  `useMasterVolume`, `useTrackLevels`). Store hooks keep the imperative
  surface too (`useTracksStore.getState()` still works).
- `@elah/editor` now also re-exports the audio hooks.

### Changed

- **BREAKING (`@elah/core`)**: core is now truly framework-agnostic — zero
  React in its module graph (fixes [#42](https://github.com/elahlabs/elah/issues/42);
  importing `@elah/core` from Vue/Nuxt/Node no longer requires React).
  - All React hooks moved to `@elah/react` (re-exported unchanged by
    `@elah/editor`, so `@elah/editor` users are unaffected).
  - The Zustand mirrors are now vanilla stores exported as `tracksStore`,
    `playbackStore`, `selectionStore`, `transitionsStore`, and
    `mediaLibraryStore` (previously the React-bound `useXStore` exports).
    Imperative call sites migrate as
    `useTracksStore.getState()` → `tracksStore.getState()`.

## `@elah/cli` [0.1.1] — 2026-07-12

### Added

- **`elah serve` welcome page** — `GET /` now serves an HTML orientation page
  (route table, browser-connected status, copy-paste `/render` example)
  instead of a bare 404, for humans who open the listen address in a browser.
- **Copy-paste startup example** — `elah serve` now prints a ready-to-run
  render example on startup: `curl` on macOS/Linux, `Invoke-RestMethod` on
  Windows (PowerShell's `curl` alias doesn't accept `-H`/`-d`).

## [0.3.2] — 2026-07-12

Documentation only — reworked `@elah/core`, `@elah/timeline`, and
`@elah/editor` READMEs to cross-link `@elah/cli` and stay consistent with its
README pattern. No code changes.

## [0.3.1] — 2026-07-11

License changed from the Elah Community License (ECL) v1.0 to Apache-2.0,
across `@elah/core`, `@elah/timeline`, and `@elah/editor`. Copyright remains
with Elah Labs Private Limited. No code changes.

## `@elah/cli` [0.1.0] — 2026-07-11

Initial release of `@elah/cli` — a headless CLI and self-hosted render
server. Rendering runs core's real `exportVideo` pipeline in headless
branded Chrome, so output is bit-identical to the browser editor by
construction.

### Added

- **CLI commands** — `elah split`, `trim`, `export`, and `build` for headless
  project editing and MP4 export.
- **`elah serve`** — a long-lived HTTP render server (`POST /render`: spec
  JSON in, MP4 bytes out) with a warm browser and `--concurrency` control.
- **Seconds-based build spec** for programmatic and AI-generated projects,
  with path-addressed validation errors a generating model can self-correct
  from.
- **Library API** — `build`, `exportProject`, `createRenderSession`,
  `startServe`, `validateSpec`, `probeMedia` — importable directly from Node.
- Dockerfile (`packages/cli/Dockerfile`) with branded Chrome + fonts,
  entrypoint `elah serve --host 0.0.0.0 --port 8080`.

## [0.3.0] — 2026-07-03

A feature release focused on **multi-track audio**, **shapes & freehand
drawing**, a **programmatic asset-insertion API**, and a fully **themeable
timeline**. Additive — no breaking changes to the 0.2.x public API.

### Added

#### `@elah/core`

- **Multi-track audio playback.** `AudioPlaybackController` now mixes multiple
  audio tracks against the `PlaybackEngine` clock with independent per-clip
  control, replacing the single-track v1 constraint.
- **Audio mixer hooks** — `useAudioMixer`, `useTrackLevels`, `useMasterVolume`
  for building level meters and volume UIs, plus a pluggable
  `defaultAudioResolver` / `AudioResolver` for custom audio fetch + decode.
- **Shape clips** — `createShapeClip`, `ShapeVariant`, and a GPU `ShapeLayer`.
  `Scene` now exposes `scene.shapes` (`ActiveShapeClip`).
- **Freehand clips** — `createFreehandClip` and a GPU `FreehandLayer`, surfaced
  on `Scene` as `scene.freehand` (`ActiveFreehandClip`).
- **Image decode cache warming** — `warmImageSrc`, `preloadProjectImages`, and
  the `ImageLoader` / `LoadedImage` types for eliminating first-paint stalls on
  image clips.
- **Expanded asset import** — `importUrl` and `importBlob` alongside
  `importFiles`; new `useAssets` hook, `mediaDragKindMime` helper, and
  `ImportUrlOptions` / `ImportBlobOptions` / `UseMediaLibraryApi` types.
- **`transformFromCoverRect`** placement helper (object-fit **cover**) added
  next to the existing `transformFromContainRect`.

#### `@elah/timeline`

- **Programmatic insertion API** — `insertMediaAsset` and `insertElement` place
  assets and elements on the timeline without a drag gesture, returning a typed
  `InsertAssetResult`. Powers tap-to-add on touch devices.
- **`classNames` slot API + `cn` util** — every timeline sub-component accepts a
  `TimelineClassNames` slot map so consumers can restyle without forking. A
  passed class always wins over defaults.
- **`--elah-*` CSS-variable theming** with a backward-compatible `timelineTheme`
  facade (deprecated in favor of the `classNames` prop / CSS variables). See
  [THEMING.md](./packages/timeline/THEMING.md).
- New public types — `TimelineDropState`, `ShapeVariant`.

#### `@elah/editor`

- **`SourcePanel`** — a new, fully slot-styled source/asset browser component
  (`SourcePanelProps`, `SourcePanelClassNames`) with an asset **activation** API
  (`AssetActivationPayload`, `AssetActivationHandler`) for tap-to-add flows.
- Re-exports all of the new `core` and `timeline` API above, including
  `insertMediaAsset` / `insertElement`, `importUrl`, audio mixer hooks, and
  `transformFromCoverRect`.

### Changed

- Timeline UI redesigned (clips, headers, ruler, playhead) to the Figma
  cyan / cool-navy theme; editor retinted to match.
- Timeline gestures migrated to **pointer events** (unifying mouse + touch) with
  pinch-to-zoom and touch tap-to-add.
- Video tracks capped at one and track-lock enforced on edits (single video
  track remains the v1 renderer constraint; audio is now multi-track).
- Export pipeline hardened: re-entrancy guard on `exportVideo`, improved audio
  mixing, and shape/freehand parity with the live renderer.

### Fixed

- Backward-seek frame-cache stability and video-decoder pivot handling.
- Generated clips can grow left without being clamped by source bounds.

## [0.2.1] — 2026-06-15

- Documented measured bundle sizes and improved package build scripts.

## [0.2.0]

- First public release of the three-package split: `@elah/core`,
  `@elah/timeline`, `@elah/editor`.

[0.3.1]: https://github.com/elahlabs/elah/releases/tag/v0.3.1
[0.3.0]: https://github.com/elahlabs/elah/releases/tag/v0.3.0
[0.2.1]: https://github.com/elahlabs/elah/releases/tag/v0.2.1
[0.2.0]: https://github.com/elahlabs/elah/releases/tag/v0.2.0
[@elah/cli 0.1.0]: https://github.com/elahlabs/elah/releases/tag/cli-v0.1.0
