# Changelog

All notable changes to the Elah packages (`@elah/core`, `@elah/timeline`,
`@elah/editor`) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the packages follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
All three packages are released together and share a version number.

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

[0.3.0]: https://github.com/elahlabs/elah/releases/tag/v0.3.0
[0.2.1]: https://github.com/elahlabs/elah/releases/tag/v0.2.1
[0.2.0]: https://github.com/elahlabs/elah/releases/tag/v0.2.0
