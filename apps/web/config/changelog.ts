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
    version: '1.0.0',
    date: '2026-10-22',
    latest: true,
    summary:
      'The motion and programmatic layer: keyframes with the full ease set, springs, stagger and motion paths; HTML/CSS scenes and VideoSpec that compile to editable clips; effects, transitions, generators, compound and sequence clips, audio enhancement, Lottie and SVG import, and fonts in the package. The exported API is now a semver promise.',
    groups: [
      {
        kind: 'changed',
        scope: 'Stability',
        items: [
          'From 1.0.0 the exported API of @elah/core (the root entry and the browser-free @elah/core/engine entry), @elah/react, @elah/timeline and @elah/editor follows semver: a breaking change needs 2.0. Three AI-facing layers are live in 1.0 and follow semver too. They are not exported from the @elah/core root; each has its own subpath entry: @elah/core/spec (VideoSpec / AuthoredSpec, compileVideoSpec, buildVideo, layProject, specVocabulary), @elah/core/html (validateScene, sceneToClip), @elah/core/ops (EDITOR_OP_NAMES, applyOps, sanitizeOps, the describe* helpers) and @elah/core/icons (the vendored icon set, ICON_NAMES). The documents they produce are ordinary projects and stay readable; the authoring vocabulary and op shapes are what can move. @elah/editor does not re-export these layers: import them from the subpaths.',
        ],
      },
      {
        kind: 'changed',
        scope: 'Breaking',
        items: [
          'Project documents are version 5. PROJECT_VERSION went from 1 to 5. A project is stamped with the lowest version that can hold what it uses (adjustment clips 2; generator clips, shape draw-on and the newer transitions 3; compound clips 4; sequence clips 5), so a project that uses none of them is still version 1 and opens in 0.6.x. A project that does is refused by 0.6.x with ProjectDocumentError (code: unsupported-version). Every 0.6.x document opens unchanged in 1.0.0.',
          'Widened unions can break an exhaustive switch. ClipType gained adjustment, generator, compound and sequence (10 members); TransitionKind gained zoom, spin, whip, glitchCut, warpDissolve and lumaWipe (9). Code that switches on either with no default, or keeps a Record<ClipType, ...>, stops compiling until it handles the new members.',
          'Transitions are drawn by the WebGL2 renderer. <Preview> no longer lays a frozen CSS snapshot over a transition; both clips play through it, with their effects. A host that rendered its own transition overlay on top of <Preview> should remove it.',
          'mediabunny ^1.50.8 (was ^1.45.3) in @elah/core, @elah/cli and apps/web: the export worker retries a failed decoder with options older releases do not have.',
          'No exported name from 0.6.0 was removed, in any of the four packages.',
        ],
      },
      {
        kind: 'added',
        scope: '@elah/core',
        items: [
          'The motion layer: keyframes on every transform channel with the full ease set (sine, quad, cubic, quart, quint, expo, circ, back, elastic and bounce, each in / out / in-out, plus steps(n), cubic-bezier curves and named bezier presets) and closed-form springs (the gentle, snappy, bouncy, stiff and wobbly presets); hold keys; stagger from the start, end, centre, edges or at random, and across a grid; motion paths (a clip travels an SVG path and can orient to it); per-character, word and line text animators with their own tweens; scramble text; repeat and yoyo; skew; 3D tilt (rotateX / rotateY, on video, image, sequence and compound clips); expressions; 36 motion presets.',
          'HTML/CSS scene conversion (@elah/core/html, live). validateScene({ html, css }) checks a scene against a whitelisted HTML/CSS subset and names the supported substitute for everything it refuses; sceneToClip(measuredScene, { fps }) turns a measured scene into one compound clip of native shape, text and image clips with keys, from a one-line data-motion grammar. Measuring the scene in a browser is the host step: this release ships no DOM measurer.',
          'VideoSpec (@elah/core/spec, live). A seconds-based JSON document for models to write: compileVideoSpec compiles it to a Project and returns every problem as a path-addressed SpecIssue instead of throwing; buildVideo also expands 17 motion components and 6 motion systems and polishes the result; layProject lays a compiled project onto a live engine as one undo step; specVocabulary() renders the vocabulary block for a prompt.',
          'Editor ops (@elah/core/ops, live). 57 typed ops (EDITOR_OP_NAMES) that add text, shapes, generators, captions, effects, transitions, keyframes and edits; applyOps runs a plan against an engine as one undo step, sanitizeOps repairs a model plan, and the describe* helpers summarise a project for a prompt. Ops that need a provider (generateMedia, removeBackground) come back as deferred for the host to run.',
          'New clip types: adjustment (applies effects to everything beneath it), generator (8 built in: particles, energy lines, light leak, lens flare, gradient background, counter, bar chart, progress bar), compound (a nested project played as one clip; nestClips / unnestClip, component instances that re-expand) and sequence (an animated image or a numbered frame set, picked by frame index in preview and export).',
          'Effects, transitions, blend modes and mattes: 23 GPU effects (EFFECT_REGISTRY), effect bundles and looks, masks and track mattes, blend modes, and nine transitions (fade, slide, wipe, zoom, spin, whip, glitchCut, warpDissolve, lumaWipe), all drawn by one WebGL2 pipeline shared by preview and export.',
          'Clip audio: Clip.audio holds mute, boost (up to +12 dB), fades and Enhance (noise reduction and voice clarity). One gain envelope and one Web Audio chain serve the live preview and the export mix. Audio analysis (beats, silences, markers) and word-level captions are public too.',
          'Lottie and SVG import: lottieToClip and svgToProject turn an animation or drawing into editable native clips and keys, each with a report of what it could not map.',
          'Export containers: ExportOptions.container selects mp4 (default), webm (with transparency where the browser check passes), gif or a PNG sequence; codecs are avc, hevc, av1, vp9 and vp8 where the browser can encode them; range: inOut exports the marked range. A default MP4 export is unchanged.',
          'Fonts that ship in the package: twelve OFL families (Inter, Montserrat, Poppins, Space Grotesk, Playfair Display, DM Serif Display, Bebas Neue, Anton, Oswald, Archivo Black, Roboto Mono, Caveat; Latin subset, woff2) in fonts/<id>/ with each OFL.txt. The default font base URL stays /fonts/; packageFontsBaseUrl() opts in to the package copies for unbundled use (a CDN, native ESM).',
          'CDN-safe workers: the export, audio-analysis and capability-probe workers start from a cross-origin module URL through a blob module worker (jsDelivr /+esm included). Bundled hosts take the same new Worker(new URL(...)) path as before.',
          '@elah/core/engine, a browser-free entry point, now covers the whole converged engine: engine, resolver, PlaybackEngine, stores, clip factories, project documents and the pure placement and timeline math, without the WebGL2 renderer, WebCodecs, importers or the export worker (whose import.meta Metro and Hermes reject). A test pins every file it can reach.',
          'Timeline geometry: pure helpers shared by every timeline UI (timelineContentWidth, computeRulerTicks, formatRulerLabel, computeAnchoredScrollLeft, wheelZoomStep, pinchZoom, clampZoom, pxToFrames, xToFrame, seekFrameAtX, isClipAllowedOnTrack, and the trim limits maxTrimDuration, minTrimDuration, clampLeftTrim, clampRightTrim, among others).',
        ],
      },
      {
        kind: 'added',
        scope: '@elah/react',
        items: ['EditorProvider moved here from @elah/editor, which still re-exports it, so no import changes.'],
      },
      {
        kind: 'added',
        scope: '@elah/timeline and @elah/editor',
        items: [
          'Projects that use the new clip types open, play, save and export without losing a clip. The timeline draws adjustment, generator, compound and sequence clips as labelled blocks; trimming lets sourceless clips grow as engine.trimClip() does; paste copies shapes, drawings and the new types with cloneClip (pasting a shape used to throw); the transition picker shows a loaded kind outside fade / slide / wipe as the active choice. There is no editing UI for the new clip types in @elah/editor yet.',
        ],
      },
      {
        kind: 'changed',
        scope: '@elah/core',
        items: [
          'Package size: about 1.2 MB as an npm tarball (1,158,481 bytes packed, 3.0 MB unpacked, 735 files); 0.6.0 was about 106 KB. Roughly half is the bundled fonts, which a host loads only if it opts in; the rest is the converged engine. Everything stays tree-shakeable (sideEffects: false), and @elah/core/engine leaves out the renderer and the codec.',
          'Startup cost grew from 0.6.0, and the AI-facing layers are not why. Measured with scripts/measure-bundle.mjs (esbuild, minified, gzipped; react, lucide-react and mediabunny external): an editor app (EditorProvider, Preview, Timeline from @elah/editor) is 112 KiB gz, against 68 KiB gz in 0.6.0 and 133 KiB before effects, generators, sequence clips, roto masks and audio Enhance moved to first-use chunks (the same method read 130.5 KiB); the engine alone (TimelineEngine, resolveTimeline) is 45 KiB gz; engine plus GpuRenderer and exportVideo is 75 KiB gz. The growth is the renderer core (layers, shape and text painters, video decode), the resolver (keyframes, expressions, compounds) and media. spec, html, ops and icons cost a real app 0 bytes because the bundler drops what is not imported; imported on their own, @elah/core/spec is 71 KiB gz and @elah/core/html is 44 KiB gz. Optional renderer features load on first use: a project that uses no effects, generators, sequence clips, roto masks or Enhance downloads none of their code, and prepareFeatures(project) loads the features a project needs before the first frame.',
          'textStylePresetsStore.addPreset ids come from generateId() instead of crypto.randomUUID(), which Hermes does not provide.',
        ],
      },
      {
        kind: 'changed',
        scope: '@elah/timeline',
        items: [
          'The zoom-anchor, content-width and track-compatibility modules re-export from @elah/core, and the ruler computes its ticks with computeRulerTicks. No behaviour change.',
        ],
      },
      {
        kind: 'changed',
        scope: '@elah/react',
        items: ['Value imports from core go through @elah/core/engine; the build no longer emits *.test.tsx files into dist.'],
      },
      {
        kind: 'changed',
        scope: '@elah/cli',
        items: [
          '1.0.0: exports version 5 projects (shader and folder module imports, compound and sequence media, no hard-coded project version 1). Its @elah/core range is now ^1.0.0. It versions and ships on its own line.',
        ],
      },
    ],
  },
  {
    version: '0.6.0',
    date: '2026-10-02',
    summary:
      'The premium editor port lands in the open-source packages: multiple video tracks, clip speed, crop and corner radius, layered text animation with 14 templates, frame sequences, stored project documents with media re-linking - and the eight defects found while verifying it.',
    groups: [
      {
        kind: 'added',
        scope: '@elah/core',
        items: [
          'Reading a stored project: readProjectDocument / isReadableProjectDocument / PROJECT_VERSION, plus relinkProjectMedia, which points restored clips back at the media library and reports missing blob:/data: sources instead of dropping them. engine.loadProject gained { transport, history } options and emits project:loaded.',
          'Layered text and shape animation: TextAnimation.inMotion / outMotion are MotionSpecs (opacity, offset, scale, rotation, per-channel easing), with new back-*, elastic-out and bounce-out curves. The sampling helpers are public: sampleTextAnimation, resolveRampFrames, motionForKind.',
          'Text templates: BUILT_IN_TEXT_TEMPLATES (14 looks), findTextTemplate and applyTextTemplate, which returns an undoable Partial<Clip> patch for engine.updateClip.',
          'Clip.speed (0.25 to 4, video only; duration and export follow it), Clip.crop, Clip.cornerRadius, Track.protected and Track.pinned: "bottom".',
          'Frame sequences: createFrameSequence, FrameSequenceController (scrub, wrap / pingpong looping), createFramePreloader and frameSequenceToProject, which lays a sequence out as image clips so it can be edited and exported.',
          'Media library: beginImportUrl registers a pending remote asset that resolves later; probeHasAudio / determineAssetHasAudio; snapshotMediaLibrary / hydrateMediaLibrary carry the library across a page load. sourceBlobCache de-duplicates video downloads between the demuxer and the preview.',
          'Two vanilla stores: textStylePresetsStore and clipLoadStore (renderer state, never part of the project or undo history). PerfSummary reports render-loop tick cost once a second on the PERF trace channel.',
          'ExportOptions.outputHeight is now the short edge of the stage, so 1080 means 1920x1080 landscape and 1080x1920 portrait.',
        ],
      },
      {
        kind: 'added',
        scope: '@elah/timeline',
        items: [
          'TimelineRef.zoomAtAnchor zooms anchored on the playhead. growClipToAssetDuration inserts a clip with a fallback length before its media is probed and grows it once the real duration is known; clips still loading show a shimmer.',
        ],
      },
      {
        kind: 'added',
        scope: '@elah/react',
        items: ['useClipLoadStore and useTextStylePresetsStore.'],
      },
      {
        kind: 'added',
        scope: '@elah/editor',
        items: [
          'The barrel re-exports all of the above, including the vanilla clipLoadStore and textStylePresetsStore. New design tokens for the preview overlays and clip badge: --elah-overlay-*, --elah-spinner-*, --elah-clip-badge-bg, --elah-toast-shadow.',
        ],
      },
      {
        kind: 'changed',
        items: [
          'Multiple video tracks. addTrack("video") used to return the existing track; it now adds another. Video tracks composite in track order (the topmost lane draws on top), and a new video track goes directly below the last one.',
          'Playback preferences (zoom, volume, mute, rate, loop, snap) are written to localStorage when they change rather than on every frame of playback. Same key, same envelope - nothing is lost.',
          'serializeProject / deserializeProject are unchanged for consumers, now a facade over readProjectDocument. A document with no version stamp reads as version 1 instead of being rejected; one from a newer build throws ProjectDocumentError.',
          'The timeline mounts only the clips inside the scrolled viewport (horizontal virtualisation), and the ruler shares one timecode formatter with the rest of the UI.',
        ],
      },
      {
        kind: 'changed',
        scope: '@elah/cli',
        items: [
          '0.1.2 - the build spec places every video clip on one track, so overlapping video clips are now a build error in the spec rather than something the engine rejects; the engine has allowed several video tracks since the multi-track change.',
        ],
      },
      {
        kind: 'fixed',
        items: [
          'Video frames could upload into a disposed GPU texture after a clip source changed. The layer read the texture before replacing the provider; a replaced provider now also inherits the reference count of the clip.',
          'A preview loading spinner that could never clear after a failed decoder re-open.',
          'A borrowed frame stretched to the stage between clips; the held-over frame is now fitted by its own dimensions.',
          'The timeline ruler showed 00:90 instead of 01:30, and its ticks drifted from the clips at low zoom.',
          'The clip loading shimmer had no CSS, and horizontal clip virtualisation had been silently dropped in the port.',
          'Preview overlays and clip badges used hard-coded colours and could not be themed; they now read the --elah-* tokens.',
          'Web playground: deleted media was resurrected from IndexedDB and its object URLs were never revoked.',
        ],
      },
      {
        kind: 'added',
        items: [
          'playground/ is now examples/. New examples/AGENTS.md (the integration contract in one page) and a root npm run verify:examples, the only check in the repo that exercises the published tarballs rather than local source.',
          '/docs/installation corrected: the sample package.json pinned ^0.2.0, the transpilePackages and Vite optimizeDeps.exclude lists omitted @elah/react, and the peer-dependency section did not mention lucide-react.',
          'Bundle sizes re-measured and the method fixed. BUNDLE_STRATEGY.md now quotes what a browser downloads (esbuild, minified, gzipped, code-split) instead of the raw tsc output the old badges used: ~64 KiB at startup for the full SDK with the demuxer injected, ~11 KiB engine-only, and ~227 KiB on the quick-start path because createDefaultDemuxerFactory imports mediabunny statically. Reproduce with node scripts/measure-bundle.mjs.',
        ],
      },
    ],
  },
  {
    version: '0.4.1',
    date: '2026-08-02',
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
