# 04 — Workstreams

> Status: timeline-first track active (RN-T0 done 2026-10-08); RN-P* proposed.
> Last verified: 2026-10-08 against `dev` @ `63c74c5`.
> One workstream = one PR (or a short series of PRs if the ticket says so). Claim one by opening
> an issue titled `RN-Pn: <goal>`. When it lands, change its **Status** line here to
> `done (PR #...)` and record anything you learned that the next ticket needs.

Dependency order. P0 and P1 can start today; P1 and P2 are core/react changes that do not need a
device.

```
RN-P0 spike ---+
RN-P1 core/engine entry ---> RN-P3 package skeleton ---> RN-P4 Skia renderer ---> RN-P5 text parity
RN-P2 EditorProvider -> react -+                            |
                                                           +---> RN-P6 native decode ---> RN-P7 audio
                                                           +---> RN-P8 import
                                                           +---> RN-P9 timeline
                                                           +---> RN-P10 export (needs P6, P7)
RN-P11 example + docs (needs everything above and a publish)
```

Every ticket inherits these rules: TypeScript strict; vitest tests colocated as `*.test.ts(x)`;
no new dependency without a line in [`05-decisions.md`](./05-decisions.md); public API changes
update the barrels and READMEs listed in [`AGENTS.md`](../../AGENTS.md) under "When you change
the public API"; on-device evidence is a screenshot or recording in the PR.

---

## Timeline first (the current track, decided 2026-10-08)

The maintainer chose to ship the **timeline** before the preview, decode, audio and export.
The base is built; the rest is cut into small issues for contributors. This track replaces
**RN-P9** and pulls the parts of RN-P0 to RN-P3 the timeline needs. The renderer track (RN-P4
onwards) waits until the timeline works on a device.

```
RN-T0 base (done) ──┬── RN-T1 = RN-P1 core/engine entry ──┐
                    └── RN-T2 = RN-P2 EditorProvider move ─┴── RN-T3 Expo harness
                                                                    │
                                     RN-T4 lanes + clips (static) ──┤
                                     RN-T5 ruler, playhead, seek  ──┤ (T5..T8 in any order
                                     RN-T6 move gesture           ──┤  once T4 is merged)
                                     RN-T7 trim gesture           ──┤
                                     RN-T8 pinch zoom + fit       ──┤
                                     RN-T9 selection, delete, undo ─┘
```

Ready-to-file issue bodies for T1 to T9 are in [`issues/`](./issues/README.md).

### The contract every timeline issue builds on

The base lives in `packages/react-native/src/timeline/model/` and is **platform-free**: no
React, React Native, gesture-handler, Reanimated or Skia import is allowed there
(`src/dependencyRules.test.ts` fails the build). Components go in
`packages/react-native/src/timeline/components/` and may import anything the peers allow.

Every gesture has the same three-step shape. The component owns the recogniser; the model owns
the meaning.

| Step | Function | Called from | Returns |
|---|---|---|---|
| begin | `beginMove(clipId, snapshotFromStores())` / `beginTrim(...)` / `beginPinch(...)` | gesture `onStart` (JS thread) | a frozen session, or `null` (locked lane, missing clip) |
| update | `updateMove(session, { translationX, pointerY })` / `updateTrim` / `updatePinch` | gesture `onUpdate` | a preview: frames for the label, `dx`/`dy` or zoom + scroll for the visuals |
| end | `endMove(session, preview, snapshot)` / `endTrim(session, preview)` | gesture `onEnd` | an `EngineCommand`, or `null` for a tap |
| apply | `applyEngineCommand(defaultCommandTargets(engine), command)` | right after `end` | nothing; the engine and stores update, React re-renders |

Rules a component PR must keep (reviewers check them):

- **No project edit outside `applyEngineCommand`.** Not `engine.*`, not `store.setState`.
- **Visual feedback during a gesture is a transform**, never a `previewClip`. `previewClip` throws
  on an overlap; `moveClip`/`trimClip` reject silently after the model has already settled the
  drop into a gap.
- **No React state per frame of a gesture.** Drive the block's transform from a Reanimated
  shared value; commit once on release.
- **Pure math goes in `@elah/core` `utils/timelineMath.ts`** with a test, not in a component.

### RN-T0 — Base: shared timeline math and the gesture model

**Status:** done (uncommitted on `dev`, 2026-10-08)
**What landed:**

- `packages/core/src/utils/timelineMath.ts` (+ 55 tests): `timelineContentWidth`,
  `computeAnchoredScrollLeft`, `resolveZoomAnchorX`, `wheelZoomStep`, `isCompatibleTrackKind`,
  `isClipAllowedOnTrack` and `formatRulerLabel` moved from `@elah/timeline`; new
  `computeRulerTicks`, `pinchZoom`, `clampZoom`/`ZOOM_MIN`/`ZOOM_MAX`, `pxToFrames`, `xToFrame`,
  `snapThresholdFrames`, `maxTrimDuration`, `minTrimDuration`, `minLeftTrimStart`,
  `neighbourBounds`, `clampLeftTrim`, `clampRightTrim`. Exported from the core and editor barrels.
  `@elah/timeline`'s three modules are now re-exports and its `Ruler` uses `computeRulerTicks`;
  its tests stay green, so the web timeline is unchanged.
- `packages/react-native` 0.1.0: the model above plus 80 tests in Node against the real
  `TimelineEngine`, including "the gesture's command produces the same project the web
  timeline's call does".

**Surprise worth knowing:** the web trim handles only learn about the source's left bound and
the neighbouring clips on release, when `trimClip` silently rejects and the block snaps back.
The mobile model applies both bounds during the drag (`minLeftTrimStart`, `neighbourBounds`),
so the preview never shows a position the commit refuses. The web could adopt the same helpers.

**Not done here:** anything that needs Metro or a device. See RN-T1 to RN-T3.

### RN-T1 — Metro-safe imports

**Status:** done (uncommitted on `dev`, 2026-10-08). Covers RN-P1.
**What landed:** `packages/core/src/engine.ts` exported as `@elah/core/engine`;
`engine.no-browser.test.ts` walks the runtime import graph (type-only imports skipped) and pins
the 43 reachable files, the two allowed npm packages, no `import.meta`, no browser API, and
`document` / `window` / `localStorage` only behind `typeof` (mutation-checked: adding
`exportVideo` to the entry fails with `engine.ts -> export/index.ts -> export/exportVideo.ts`);
`engine.singletons.test.ts` proves both entries share store instances. `textStylePresets.store`
uses `generateId()` instead of `crypto.randomUUID()` (Hermes has no `crypto`). `@elah/react`
value imports moved to the engine entry; its media hook got a `.native` variant (D14).
`@elah/react-native` imports values only from the engine entry, enforced by its guard.
**Surprise:** the audit's "`@elah/react` reusable unchanged" was wrong for Metro (root-barrel
imports and the DOM importers), and `@elah/react`'s build emitted `*.test.tsx` into `dist`
(its exclude list lacked `.tsx`; fixed).

### RN-T2 — `EditorProvider` in `@elah/react`

**Status:** done (uncommitted on `dev`, 2026-10-08). Covers RN-P2.
**What landed:** `git mv` to `packages/react/src/EditorProvider.tsx`, imports via the engine entry
and local modules, exported from `@elah/react` and `@elah/react-native`; `@elah/editor`
re-exports it, so no consumer changes. New jsdom test: store mirroring, store seek moves the
engine exactly once (no echo seek), `project:loaded` rewinds the transport.

### RN-T3 — `apps/mobile` harness

**Status:** done (uncommitted on `dev`, 2026-10-08). Covers the harness half of RN-P0/RN-P3.
**What landed:** Expo SDK 57 (React Native 0.86.3, React 19.2.3) app with its own install (D10
amendment), a Metro config that loads the packages from `src` and refuses the root
`@elah/core`, the model-test fixture, and one screen: transport, a read-only debug view of the
lanes, buttons that run the real move / trim reducers and apply their commands, and the store
mirror. `npm run bundle:android` / `bundle:ios` produce Hermes bundles with no `import.meta`
workaround; the source map shows one React, zero files from the root `node_modules`, and
exactly the 43 core files the guard allows. On the web target every button produced the state
the Node tests predict, and playback advanced at 30 fps.
**Not verified:** a physical phone or emulator (none was attached). Do the first device run with
`npx expo start` and Expo Go, and attach a recording to the PR.
**Surprises:** Expo SDK 57 pins `react-native-gesture-handler` ~2.32, not the 3.x this folder
assumed. Expo's Metro honours `tsconfig.json` `paths` (turned off in `app.json`), and
`disableHierarchicalLookup` breaks Expo's own nested packages, so package-source imports are
re-rooted at the app instead.

### RN-T4 to RN-T9

Their bodies are in [`issues/`](./issues/README.md) so they can be pasted into GitHub as-is.
When one lands, add a `### RN-Tn` entry here with its status and its surprise, as above.

---

## RN-P0 — Feasibility spike on a device

**Status:** proposed
**Depends on:** nothing
**Goal:** Prove, on one iPhone and one mid-range Android phone, that the engine runs on Hermes and
that Skia can draw a resolved `Scene` at the project fps without React commits. Record the
numbers that later tickets design against.

**Allowed files:** `apps/mobile/**` (new Expo SDK 57 app, workspace member), `docs/react-native/**`.
No changes under `packages/`.

**Steps**

1. Create `apps/mobile` with `create-expo-app`, New Architecture on, Hermes. Add it to the root
   `workspaces` and `npm run typecheck`. Configure Metro `watchFolders: [repoRoot]` so the
   workspace symlinks resolve.
2. Import the engine. The barrel will fail with `'import.meta' is currently unsupported` (see
   [`02-platform-audit.md`](./02-platform-audit.md) section 2). For the spike only, set
   `unstable_transformImportMeta: true` in `babel-preset-expo` **or** import the needed modules by
   deep path from `packages/core/dist/`. Note which you used in the PR; neither is the real fix.
3. Build a fixture project in code: three text clips with entry/exit animation, one image clip
   with `transform` and `cornerRadius`, one shape, one freehand path. Drive `PlaybackEngine`,
   `resolveTimeline` and a hand-written Skia draw (no layers yet) into a `<Picture>` via a shared
   value, in a `requestAnimationFrame` loop.
4. Measure on both devices: resolver + record time per frame (p50/p95), dropped frames over 60 s,
   React commits during playback (React DevTools profiler), JS thread idle %.
5. Try text measurement: implement a `TextMeasurer` over `Skia.Font.measureText` and feed it to
   `computeTextLayout`. Compare line breaks against the web for one paragraph in a font both
   can load.

**Acceptance**

- `npm run typecheck` passes at the root with `apps/mobile` included.
- A table in the PR with the measurements above, both devices, device models named.
- A 10-second screen recording of playback on each device.
- `01-goals-and-scope.md` updated with the iOS floor Skia 3.x actually supports.

**Out of scope:** video, audio, gestures, anything in `packages/`.

---

## RN-P1 — `@elah/core/engine`: the browser-free entry point

**Status:** proposed
**Depends on:** nothing (informed by P0)
**Goal:** Add a second entry to `@elah/core` that reaches no browser-only module and no
`import.meta`, guarded by a test, so Metro can bundle the engine with zero workarounds.

**Allowed files:** `packages/core/src/engine.ts` (new), `packages/core/src/engine.no-browser.test.ts`
(new), `packages/core/package.json` (`exports` only), `packages/core/tsconfig.build.json` if the
build needs it, `packages/core/README.md`, `CHANGELOG.md`, `apps/web/config/changelog.ts`,
`docs/ai/ELAH_FOR_AI_AGENTS.md`, `AGENTS.md` (one line), `BUNDLE_STRATEGY.md` (one paragraph).

**Steps**

1. Write `engine.ts` re-exporting the list in [`03-architecture.md`](./03-architecture.md)
   section 3. Copy the names from `index.ts`; do not invent new ones. `textStylePresets.store.ts`
   references `crypto`: confirm it is guarded or make the id generation use `generateId`.
2. Add `"./engine": { "types": "./dist/engine.d.ts", "import": "./dist/engine.js", "default":
   "./dist/engine.js" }` to `exports`. Keep `"."` as is.
3. Write the guard test: resolve the import graph from `engine.ts` (regex over `from '...'` like
   `no-react-imports.test.ts`, following relative specifiers), assert every reached file is in an
   explicit allowlist, and assert none contains `import.meta`, `new Worker(`, `OffscreenCanvas`,
   `VideoDecoder`, `createImageBitmap`, or an unguarded `document.` / `window.`. Make the error
   message name the offending file and the path that reached it.
4. Verify the dist: `npm run build --workspace=packages/core`, then
   `grep -rl import.meta packages/core/dist` must list only `export/exportVideo.js`, and a Node
   script importing `./dist/engine.js` must construct a `TimelineEngine` and resolve a `Scene`.
   (`dist` uses extensionless relative imports, so bundle with esbuild first as in the audit's
   reproduction section.)
5. Document the entry in `packages/core/README.md` ("Using the engine without a browser") and the
   AI guide; add to `BUNDLE_STRATEGY.md` that `@elah/core/engine` is the no-codec, no-GL subset.

**Acceptance**

- `npm run build:packages && npm run test && npm run typecheck` exit 0 (paste output).
- The new test fails when you temporarily add `export { exportVideo } from './export'` to
  `engine.ts` (paste the failure, then revert).
- In `apps/mobile` from P0, replace the deep imports / Babel flag with
  `import { TimelineEngine } from '@elah/core/engine'` and bundle with no workaround.

**Out of scope:** moving or editing any existing module. If something portable cannot be
reached without dragging a browser module along (for example `librarySnapshot` imports
`importFiles`), leave it out and list it in the PR.

---

## RN-P2 — Move `EditorProvider` to `@elah/react`

**Status:** proposed
**Depends on:** nothing
**Goal:** The engines-to-stores wiring becomes importable without `react-dom`, `lucide-react` or
CSS, so the mobile package uses the same provider as the web.

**Allowed files:** `packages/react/src/EditorProvider.tsx` (new, moved),
`packages/react/src/EditorProvider.test.tsx` (new), `packages/react/src/index.ts`,
`packages/react/package.json` (dependency on `@elah/core` is already there),
`packages/editor/src/editor/EditorProvider.tsx` (delete), `packages/editor/src/editor/index.ts`,
`packages/editor/src/index.ts` (re-export from `@elah/react`), `packages/react/README.md`,
`packages/editor/README.md`, `CHANGELOG.md`, `apps/web/config/changelog.ts`,
`docs/ai/ELAH_FOR_AI_AGENTS.md`.

**Steps**

1. `git mv` the file. Fix imports (`@elah/react` internals become relative).
2. `@elah/editor` keeps exporting `EditorProvider` and `EditorProviderProps` from `@elah/react`
   so no consumer changes.
3. Add a jsdom test: mount the provider, `engine.addClip`, assert `useTracksStore.getState()`
   mirrors it; seek through the store, assert the engine followed; assert no echo seek (spy on
   `playback.seek`).
4. Confirm `react/src` still has zero DOM references (`grep -nE "document|window|HTMLElement"`).

**Acceptance**

- Release gate exits 0; `examples/` untouched and `npm run verify:examples` still passes against
  the *published* 0.6.0 (this change is for the next release).
- `grep -rn "EditorProvider" packages/editor/src` shows only re-exports.

---

## RN-P3 — Package skeleton `packages/react-native` and the harness

**Status:** proposed
**Depends on:** P1, P2
**Goal:** An empty but buildable, testable, publishable `@elah/react-native` with the native
module scaffold, consumed by `apps/mobile`.

**Allowed files:** `packages/react-native/**` (new), `apps/mobile/**`, root `package.json`
(`build:packages` and `test` scripts, workspaces), `.github/workflows/ci.yml` (typecheck + vitest
for the new package only), `AGENTS.md`, `CONTRIBUTING.md`, `README.md` (layout tables).

**Steps**

1. Scaffold with `create-react-native-library` (TypeScript, New Architecture, module + view not
   needed yet). Package name `@elah/react-native`, version `0.1.0`, license Apache-2.0, `files`
   `dist`, `ios`, `android`, `cpp`, `*.podspec`, `README.md`, `LICENSE`.
2. `dependencies`: `@elah/core`, `@elah/react`. `peerDependencies` as in
   [`03-architecture.md`](./03-architecture.md) section 2. No `react-dom`.
3. Build: `tsc -p tsconfig.build.json` to `dist/` like the other packages; add to
   `build:packages` **after** `react`. Test: `vitest` with `environment: 'node'` and a
   `test/skiaMock.ts` that fakes the handful of Skia calls the renderer uses.
4. Barrel `src/index.ts` re-exporting `@elah/react` and the `@elah/core/engine` surface listed in
   `03-architecture.md` section 7, plus placeholders that throw `NotImplemented` for `Preview`,
   `Timeline`, `useImportMedia`, `exportProject`.
5. Native module `ElahMedia` with one method, `probe(uri)` returning `{ durationSec, width,
   height, fps, hasAudio }`, on both platforms. This is the smallest real native round trip and
   unblocks P8.
6. `apps/mobile` depends on `@elah/react-native` via the workspace, aliases `@elah/*` to
   `packages/*/src` in `metro.config.js` for Fast Refresh (mirror of `apps/web`'s
   `next.config.mjs`), and shows `probe()` output for a bundled test clip.
7. `packages/react-native/README.md`: install, peers, "nothing works yet" status table.

**Acceptance**

- `npm run build:packages`, `npm run test`, `npm run typecheck` exit 0 at the root.
- `probe()` output for the test clip on both platforms in the PR, and the clip's real values
  from `ffprobe` or `mediainfo` beside it.

---

## RN-P4 — `SkiaRenderer` v0: image, text, shape, freehand, fade

**Status:** proposed
**Depends on:** P3
**Goal:** `<Preview>` plays a project with every non-video clip type, composited by `zIndex`,
with correct geometry, no React commit per frame.

**Allowed files:** `packages/react-native/src/renderer/**`, `src/Preview/**`, `src/index.ts`,
tests, `README.md`; `apps/mobile` fixture screens.

**Steps**

1. `SceneRenderer` interface and `SkiaRenderer` per `03-architecture.md` section 4.2;
   `ImageLayer`, `TextLayer`, `ShapeLayer`, `FreehandLayer`; a local enter/leave diff.
2. `<Preview>`: owns the RAF loop with the same dirty-flag logic as the web `Preview.tsx`
   (re-render only when the frame or the project changed while paused), `resize` from `onLayout`
   with `PixelRatio.get()`, `clipLoadStore` wiring for image loads.
3. Unit tests (node, Skia mocked): for the fixture project, the `dstRect` passed for each clip at
   frames 0, N/2, N-1 equals `resolveDrawRect(...)` from core; draw order equals the sorted
   `zIndex` list; equal `Scene` reference means no draw calls; a leaving clip releases its image.
4. Fade: keep the last `SkPicture`, rasterise to an image on transition start, draw it at alpha
   `1 - t`.

**Acceptance**

- Tests above pass in CI.
- Recording on both devices: fixture plays 60 s at project fps; profiler shows zero React
  commits during playback; p95 render time from P0 not regressed by more than 20 %.
- Side-by-side screenshot at frame N/2: web playground vs device, same fixture, same font.

---

## RN-P5 — Text parity

**Status:** proposed
**Depends on:** P4
**Goal:** Line breaks and block placement match the web for the bundled default font.

**Allowed files:** `packages/react-native/src/renderer/text/**`, `src/fonts/**`, tests,
`README.md`; if `computeTextLayout` needs a baseline-offset parameter,
`packages/core/src/renderer/gpu/layers/textLayout.ts` and its test (additive, default-preserving).

**Steps**

1. Pick and bundle the default font (D8). Register it in the harness and in the web playground's
   fixture so both sides measure the same glyphs.
2. `SkiaTextMeasurer implements TextMeasurer`; baseline correction from `getMetrics()`.
3. Golden test: 12 paragraphs (short, long, with `\n`, with a very long word, three alignments,
   three sizes) produce `computeTextLayout(...).lines` identical between a CanvasKit-headless
   Skia measurer (runs in Node) and a recorded web result (checked in as JSON from the playground).
4. Document the font caveat in `README.md`.

**Acceptance**

- Golden test green; screenshots of two wrapped paragraphs web vs device.

---

## RN-P6 — Native decode: `NativeFrameProvider` and `VideoLayer`

**Status:** proposed
**Depends on:** P3 (and P4 for drawing)
**Goal:** Video clips scrub frame-accurately from local files, one active clip at a time.

**Allowed files:** `packages/react-native/{ios,android,cpp}/**`, `src/media/**`,
`src/renderer/VideoLayer.ts`, tests, `README.md`; `apps/mobile` fixture.

**Steps**

1. Decide the frame hand-off to Skia on the installed version (native buffer to `SkImage`), and
   write it down in [`05-decisions.md`](./05-decisions.md) D6 with the API names.
2. Native `openDecoder(uri)`, `setPlayhead(sourceFrame, lookahead)`, `getFrame(sourceFrame)`
   (sync, returns a handle or null), `close()`. Forward decode into a ring of `lookahead + 8`
   frames keyed by rounded source frame index; discontinuity means seek to keyframe, flush,
   decode. One decoder per URI, idle-closed after a timeout (mirror `VideoDecoderManager`).
3. JS `NativeFrameProvider` over it; `VideoLayer` draws `getCurrent(sourceFrame)` or the last
   frame on miss; `prewarm(scene)` opens providers for upcoming clips.
4. Test clip: a 10-second 30 fps video with the frame number burned in (generate it with the web
   export from a text project; check it into `apps/mobile/assets`).

**Acceptance**

- Scrub to frames 0, 29, 30, 150, 299: the burned-in number equals `sourceFrame` for a clip with
  `sourceStartFrame = 0`, and `sourceFrame + 15` for one trimmed by 15. Screenshots.
- Playback of the clip at 1x holds project fps on both devices; a backward jump of 100 frames
  recovers within 500 ms.
- A second decoding clip is **not** required to be smooth; note the behaviour.

---

## RN-P7 — Audio playback through `react-native-audio-api`

**Status:** proposed
**Depends on:** P3 (P6 helps for A/V sync checks)
**Goal:** `AudioPlaybackController` runs on device with per-clip, track and master gain, and the
transport follows the audio clock.

**Allowed files:** `packages/react-native/src/audio/**`, tests, `README.md`; if the controller is
added to `@elah/core/engine`: `packages/core/src/engine.ts` and its allowlist.

**Steps**

1. Construct `new AudioPlaybackController(playback, () => engine.getProject(), {
   audioContextFactory: () => new AudioContext(), audioResolver })` with `AudioContext` from
   `react-native-audio-api`. Run it against a project with two overlapping audio clips.
2. List every missing method or property in the PR (compare against the library's coverage page).
   Shim what is small; file upstream issues for the rest.
3. `useAudioMixer`, `useTrackLevels`, `useMasterVolume` from `@elah/react` wired in the harness.
4. iOS audio session category / Android audio focus in the native module.

**Acceptance**

- A 60-second clip with a click track against a burned-in frame counter: drift at the end
  under one frame (show the last frame with the audio waveform in a video editor, or use a
  phase-measurement clip).
- Mute/solo/track volume/master volume audible and reflected by `useTrackLevels`.

---

## RN-P8 — Import and the media library

**Status:** proposed
**Depends on:** P3
**Goal:** Pick a video, image or audio file and get a complete `MediaAsset` with thumbnails.

**Allowed files:** `packages/react-native/src/import/**`, native `probe` / `thumbnail` methods,
tests, `README.md`; `apps/mobile` asset panel screen.

**Steps**

1. `useImportMedia()` with `pickFromLibrary()`, `pickDocument()`, `importUri(uri)`; all converge
   on one `registerAsset(uri, kind)` that copies the file into the app documents directory,
   calls `probe`, adds the asset with `status: 'pending'`, then patches metadata and thumbnails.
2. Thumbnails: `thumbnail(uri, atSec)` natively to a PNG file URI; four evenly spaced for the
   strip (same count as the web).
3. Waveform peaks: `decodeAudioData` + the same peak reduction the web uses, or natively.
4. A minimal asset list screen in the harness with "Add to timeline" calling `insertMediaAsset`
   (from `@elah/timeline`'s pure module once P9 moves it, or a local copy until then; note which).

**Acceptance**

- Picked video shows name, duration, dimensions, `hasAudio`, filmstrip; audio shows a waveform;
  image shows a thumbnail. Screenshot. Re-launching the app keeps the files readable (the copy
  step).

---

## RN-P9 — Timeline v0 (gestures)

**Status:** superseded by the timeline-first track (RN-T0 to RN-T9, top of this file). Step 1
(the math move) is done in RN-T0; the rest is split across RN-T4 to RN-T9. Kept for the reasoning.
**Depends on:** P3 (P4 for the preview beside it)
**Goal:** Scroll, zoom, select, move, trim and seek on device, every edit through the engine.

**Allowed files:** `packages/react-native/src/timeline/**`, tests, `README.md`;
`packages/core/src/utils/timelineMath.ts` (new: `timelineContentWidth`, zoom-anchor functions,
`isCompatibleTrackKind` moved from `@elah/timeline` with their tests),
`packages/timeline/src/{contentWidth,zoomAnchor,trackCompat}.ts` (become re-exports from core),
both barrels and READMEs, `CHANGELOG.md`.

**Steps**

1. Move the pure math into core first, as its own commit; the web timeline must behave
   identically (its tests are the proof).
2. Component: track lanes in a horizontal `ScrollView` driven by Reanimated; ruler; playhead;
   clip blocks with filmstrip tiles from `MediaAsset.thumbnailStrip`.
3. Gestures: pan scrolls; pinch calls `setZoom` anchored under the fingers; tap selects; long
   press + drag calls `previewClip({ startFrame })` with `snapFrame` then `commitInteraction()`
   on release; edge drag trims with the source-window invariant enforced by the engine; ruler tap
   calls `playbackStore.setCurrentFrame`.
4. Tests (node): gesture reducers are pure functions `(gestureState, storeState) -> engine calls`;
   test them without a renderer.

**Acceptance**

- Recording: move a clip, trim it, undo both, redo; the web timeline shows the same project
  after a JSON round-trip.
- `npm run test --workspace=packages/timeline` unchanged and green after the math move.

---

## RN-P10 — Export to MP4 on device

**Status:** proposed
**Depends on:** P4, P6, P7
**Goal:** `exportProject()` writes an MP4 with audio to the device, deterministically.

**Allowed files:** `packages/react-native/src/export/**`, native encoder + audio mix, tests,
`README.md`; `apps/mobile` export screen.

**Steps**

1. Native `openEncoder(options)`, `appendFrame(buffer | imageHandle, frameIndex)`,
   `appendAudio(pcm)` or `mixAudio(clips)`, `finish()` returning a uri, `cancel()`. H.264 default,
   HEVC optional. Report capability (`getValidEncoderConfigurations`-style) before starting.
2. JS loop per `03-architecture.md` section 4.7 with `ExportProgress` and cancellation; yield
   every 10 frames.
3. Audio: decode each clip once per `src`, place with clip/track/master gain, sum, clip to
   [-1, 1], encode AAC.
4. Determinism test on device: export the text-and-image fixture twice, hash every decoded
   frame of both outputs (use the native decoder from P6), assert equal.
5. Parity test: export the same fixture on the web playground; compare frames 0, N/2, N-1 by
   PSNR; record the number in the README.

**Acceptance**

- The MP4 opens in the system gallery on both platforms with audio.
- Determinism hashes equal; PSNR against the web export reported (target >= 40 dB for the
  text-and-image fixture).
- Progress UI and cancel work; a cancelled export leaves no partial file.

---

## RN-P11 — Example app, docs page, release notes

**Status:** proposed
**Depends on:** P4 to P10 merged and `@elah/react-native` 0.1.0 published by the maintainer
(agents do not publish; see `AGENTS.md`).
**Goal:** An outside developer can install it and ship.

**Allowed files:** `examples/react-native/**` (new, installs from npm, **not** a workspace
member, lockfile gitignored like the others), `examples/AGENTS.md`, `examples/README.md`,
`apps/web/app/docs/react-native/page.tsx` (new) + docs nav, `docs/ai/ELAH_FOR_AI_AGENTS.md`
(new section), `README.md`, `CHANGELOG.md`, `apps/web/config/changelog.ts`, root `package.json`
(`verify:examples`).

**Acceptance**

- `cd examples/react-native && npm install && npm run typecheck` passes against the registry
  version; the app previews, scrubs and exports the bundled fixture on a device.
- `/docs/react-native` on the site: install, peers, the Metro note (`@elah/core/engine`), the
  font caveat, the limitations list.
- `npm run verify:examples` extended and green.

---

## Later (not tickets yet)

- `slide` / `wipe` transitions via the snapshot path; `up` / `down` need resolver and web work
  first.
- On-canvas transform gestures (drag / resize / rotate overlays) on the preview.
- A storage adapter (`expo-file-system` + SQLite or MMKV) for `snapshotMediaLibrary` /
  `readProjectDocument`.
- Background export on Android (foreground service) and iOS (background task limits).
- Generic `Renderer<Target>` in core so `SceneRenderer` disappears (D7).
- The decode scheduler, shared with the web, when it exists.
