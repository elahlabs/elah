/**
 * Single source of truth for the published package version and release notes.
 *
 * The Navbar version badge and the /changelog page both read from here, so a
 * new release is a one-file edit. Keep `releases[0]` as the current version —
 * `currentVersion` is derived from it. Mirror the repo-root CHANGELOG.md.
 */

export type ChangeKind = 'added' | 'changed' | 'fixed'

export interface ChangeGroup {
  kind: ChangeKind
  /** Optional scope label, e.g. "@elah/core". Omit for release-wide notes. */
  scope?: string
  items: string[]
}

export interface Release {
  version: string
  /** ISO date (YYYY-MM-DD). */
  date: string
  /** One-line summary shown under the version heading. */
  summary: string
  /** True for the newest release — badge/UI can highlight it. */
  latest?: boolean
  groups: ChangeGroup[]
}

export const releases: Release[] = [
  {
    version: '0.3.1',
    date: '2026-07-11',
    latest: true,
    summary: 'License changed from ECL v1.0 to Apache-2.0. No code changes.',
    groups: [
      {
        kind: 'changed',
        items: [
          'License changed from the Elah Community License (ECL) v1.0 to Apache-2.0, across @elah/core, @elah/timeline, and @elah/editor. Copyright remains with Elah Labs Private Limited.',
        ],
      },
    ],
  },
  {
    version: '0.3.0',
    date: '2026-07-03',
    summary:
      'Multi-track audio, shape & freehand clips, a programmatic asset-insertion API, and a fully themeable timeline. No breaking changes.',
    groups: [
      {
        kind: 'added',
        scope: '@elah/core',
        items: [
          'Multi-track audio playback — AudioPlaybackController mixes several audio tracks with per-clip control, replacing the single-track v1 constraint.',
          'Audio mixer hooks — useAudioMixer, useTrackLevels, useMasterVolume, plus a pluggable defaultAudioResolver / AudioResolver.',
          'Shape clips — createShapeClip, ShapeVariant, and a GPU ShapeLayer (scene.shapes).',
          'Freehand clips — createFreehandClip and a GPU FreehandLayer (scene.freehand).',
          'Image decode cache warming — warmImageSrc, preloadProjectImages to eliminate first-paint stalls.',
          'Expanded asset import — importUrl and importBlob alongside importFiles, plus the useAssets hook.',
          'transformFromCoverRect placement helper (object-fit cover).',
        ],
      },
      {
        kind: 'added',
        scope: '@elah/timeline',
        items: [
          'Programmatic insertion API — insertMediaAsset and insertElement place assets without a drag gesture (powers tap-to-add).',
          'classNames slot API + cn util — restyle every sub-component without forking; a passed class always wins.',
          '--elah-* CSS-variable theming with a backward-compatible timelineTheme facade.',
        ],
      },
      {
        kind: 'added',
        scope: '@elah/editor',
        items: [
          'SourcePanel — a fully slot-styled source/asset browser with an asset activation API for tap-to-add flows.',
          'Re-exports all of the new core and timeline API above.',
        ],
      },
      {
        kind: 'changed',
        items: [
          'Timeline UI redesigned (clips, headers, ruler, playhead) to the Figma cyan / cool-navy theme; editor retinted to match.',
          'Timeline gestures migrated to pointer events with pinch-to-zoom and touch tap-to-add.',
          'Export pipeline hardened: re-entrancy guard on exportVideo, improved audio mixing, shape/freehand parity with the live renderer.',
        ],
      },
      {
        kind: 'fixed',
        items: [
          'Backward-seek frame-cache stability and video-decoder pivot handling.',
          'Generated clips can grow left without being clamped by source bounds.',
        ],
      },
    ],
  },
  {
    version: '0.1.0',
    date: '2026-07-11',
    summary:
      'Initial release of @elah/cli — a headless CLI and self-hosted render server, bit-identical to browser export.',
    groups: [
      {
        kind: 'added',
        scope: '@elah/cli',
        items: [
          'CLI commands — elah split, trim, export, and build for headless project editing and MP4 export.',
          'elah serve — a long-lived HTTP render server (POST /render: spec JSON in, MP4 out) with a warm browser and concurrency control.',
          'Seconds-based build spec for programmatic and AI-generated projects, with path-addressed validation errors.',
          'Library API — build, exportProject, createRenderSession, startServe, validateSpec, probeMedia — importable directly from Node.',
        ],
      },
    ],
  },
  {
    version: '0.2.1',
    date: '2026-06-15',
    summary: 'Documented measured bundle sizes and improved package build scripts.',
    groups: [
      {
        kind: 'changed',
        items: [
          'Documented measured bundle sizes (~63 KiB gzipped full SDK).',
          'Improved package build scripts.',
        ],
      },
    ],
  },
  {
    version: '0.2.0',
    date: '2026-06-01',
    summary: 'First public release of the three-package split.',
    groups: [
      {
        kind: 'added',
        items: [
          'First public release of @elah/core, @elah/timeline, and @elah/editor.',
        ],
      },
    ],
  },
]

/** The current published version, derived from the newest release. */
export const currentVersion = releases[0].version
