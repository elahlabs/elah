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
    version: '0.4.1',
    date: '2026-08-02',
    latest: true,
    summary:
      'Export works out of the box for npm consumers, and @elah/editor finally re-exports its full public API.',
    groups: [
      {
        kind: 'fixed',
        scope: '@elah/core',
        items: [
          'The MP4 export worker now resolves in installed packages. exportVideo spawned the worker via new URL("./ExportWorker.ts", …), but the published package ships only the compiled ExportWorker.js — so the specifier was unresolvable and any consumer bundler (Turbopack, webpack, Vite) failed on the @elah/editor barrel, on first page load rather than on export. The build now rewrites the extension in dist/ as its final step. Apps no longer need a postinstall patch script; if you added one, delete it.',
        ],
      },
      {
        kind: 'fixed',
        scope: '@elah/editor',
        items: [
          'The barrel re-exports the full public API. 40+ identifiers were missing, including ones the docs told you to import from it: snapFrame, buildSnapPoints, resolveOverlapEdgeSnap, clipsOverlap, DEFAULT_OVERLAP_TOLERANCE, useTransitionsStore, useAssets, importBlob, createShapeClip, createFreehandClip, serializeProject, deserializeProject, warmImageSrc, preloadProjectImages, cn, EditorContext, the vanilla stores (tracksStore, playbackStore, selectionStore, transitionsStore, mediaLibraryStore), and their types. Renderer and debug internals stay @elah/core-only by design.',
        ],
      },
      {
        kind: 'added',
        items: [
          'AGENTS.md — the brief for coding agents working in the repo — plus docs/ai/ELAH_FOR_AI_AGENTS.md, a single self-contained integration guide for AI tools with no repo access (Lovable, Google AI Studio, Emergent, v0).',
          'New playground/minimal example: the smallest complete custom editor UI, meant as the thing you point an AI at.',
          'The playground/next and playground/react examples now import all three required stylesheets and declare the lucide-react peer dependency explicitly.',
          'Corrected the /examples code samples, which did not compile against 0.4.x (exportVideo options, ExportProgress shape, the DemuxerBackend interface, and ActiveTextClip field access).',
        ],
      },
    ],
  },
  {
    version: '0.4.0',
    date: '2026-07-28',
    summary:
      'New @elah/react package — all React bindings split out of @elah/core, which is now truly framework-agnostic.',
    groups: [
      {
        kind: 'added',
        scope: '@elah/react',
        items: [
          'New package @elah/react — all React bindings in one place: the editor context (EditorContext, useEditor, useTimelineEngine, usePlaybackEngine), store hooks (useTracksStore, usePlaybackStore, useSelectionStore, useTransitionsStore, useMediaLibraryStore, useMediaLibrary / useAssets), and the audio hooks (useAudioMixer, useMasterVolume, useTrackLevels). Store hooks keep the imperative surface too (useTracksStore.getState() still works).',
          '@elah/editor now also re-exports the audio hooks.',
          'Test coverage for @elah/react, mirroring the vitest/jsdom conventions already used by @elah/timeline and @elah/editor.',
        ],
      },
      {
        kind: 'changed',
        scope: '@elah/core',
        items: [
          'BREAKING: core is now truly framework-agnostic — zero React in its module graph (fixes #42; importing @elah/core from Vue/Nuxt/Node no longer requires React).',
          'All React hooks moved to @elah/react (re-exported unchanged by @elah/editor, so @elah/editor users are unaffected).',
          'The Zustand mirrors are now vanilla stores exported as tracksStore, playbackStore, selectionStore, transitionsStore, and mediaLibraryStore (previously the React-bound useXStore exports). Imperative call sites migrate as useTracksStore.getState() → tracksStore.getState().',
        ],
      },
    ],
  },
  {
    version: '0.1.1',
    date: '2026-07-12',
    summary: 'elah serve gets a browser-friendly welcome page and a copy-paste startup example.',
    groups: [
      {
        kind: 'added',
        scope: '@elah/cli',
        items: [
          'elah serve welcome page — GET / now serves an HTML orientation page (route table, browser-connected status, copy-paste /render example) instead of a bare 404.',
          "Copy-paste startup example — elah serve now prints a ready-to-run render example on startup: curl on macOS/Linux, Invoke-RestMethod on Windows (PowerShell's curl alias doesn't accept -H/-d).",
        ],
      },
    ],
  },
  {
    version: '0.3.2',
    date: '2026-07-12',
    summary: 'Documentation only — reworked package READMEs to cross-link @elah/cli. No code changes.',
    groups: [
      {
        kind: 'changed',
        items: [
          'Reworked @elah/core, @elah/timeline, and @elah/editor READMEs to cross-link @elah/cli and stay consistent with its README pattern.',
        ],
      },
    ],
  },
  {
    version: '0.3.1',
    date: '2026-07-11',
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
