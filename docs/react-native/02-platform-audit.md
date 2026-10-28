# 02 — Platform audit: what runs on Hermes today

> Status: measured. Last verified: 2026-10-06 against `dev` @ `e9fe11c` (`@elah/core` 0.6.0).
> Reproduce every number here with the commands in the last section before relying on it after
> a core change.

This document answers one question: **which parts of the existing packages can a React Native
app use unchanged, and which must be rebuilt on native seams?** The method was (a) a static scan
of every non-test source file in `packages/core/src` for browser identifiers, (b) reading the
hits to separate real usage from comments and parameter names, (c) bundling the core barrel and
executing it in plain Node with no DOM, and (d) checking the runtime dependencies and the
toolchain (Metro, Hermes) against vendor documentation.

---

## 1. `@elah/core` by directory

104 exports in the barrel (`packages/core/src/index.ts`). Source files exclude `*.test.ts`,
`__tests__/` and `__fixtures__/`.

| Directory | Source files | Files referencing browser APIs | Verdict | Notes |
|---|---|---|---|---|
| `types/` | 1 | 0 | **Portable** | The data model. |
| `editor/` | 2 | 1 (false positive) | **Portable** | `projectDocument.ts` has a *parameter* named `document`. `TimelineEngine.ts` is pure TypeScript + Immer. |
| `project/` | 1 | 0 | **Portable** | `serializeProject` / `deserializeProject`. |
| `resolver/` | 4 | 2 (false positives) | **Portable** | Both hits are the word "window" in comments. `resolveTimeline`, `textAnimation`, `scene` have no I/O. |
| `elements/` | 8 | 0 | **Portable** | Clip factories and text templates. |
| `actions/` | 3 | 0 | **Portable** | `splitClipAtPlayhead`. |
| `utils/` | 3 | 0 | **Portable** | frames, id, snap. `generateId` is `Math.random`-based, no `crypto`. |
| `visitor/` | 5 | 0 | **Portable** | Immer visitors behind `commit()`. |
| `track/` | 1 | 0 | **Portable** | |
| `stores/` | 6 | 1 (guarded) | **Portable** | `playback.store.ts` reads `localStorage` behind `typeof localStorage === 'undefined'`. On Hermes it is undefined, so prefs simply do not persist. `textStylePresets.store.ts` references `crypto`; check it is guarded before relying on it (RN-P1 does). |
| `playback/` | 1 | 1 (guarded) | **Portable on RN** | `PlaybackEngine` uses `requestAnimationFrame`, `cancelAnimationFrame`, `performance.now()` and `document.visibilitychange`. The `document` uses are behind `typeof document !== 'undefined'`. React Native provides the other three as globals. Verified in Node: `play()` throws `ReferenceError: requestAnimationFrame is not defined` with no RAF, and advances frames 0,1,2,3,4... once a RAF is present. |
| `debug/` | 2 | 2 (guarded) | **Portable** | `trace.ts` installs `window.__trace` only when `window` exists. `PerfSummary` uses `performance.now()`. |
| `assets/` | 6 | 3 | **Mixed** | `types.ts` and `store.ts` (the `mediaLibraryStore`) are portable. `importFiles.ts` is DOM through and through: `File`, `URL.createObjectURL`, `document.createElement('video' / 'img' / 'canvas')`, `AudioContext` for waveforms, `fetch(HEAD)`. `hasAudio.ts` needs mediabunny. `librarySnapshot.ts` is pure but imports `scheduleThumbnailById` from `importFiles.ts`. |
| `frames/` | 5 | 2 | **Mixed** | `frameSequence.ts`, `FrameSequenceController.ts`, `frameSequenceProject.ts` are portable. `framePreloader.ts` creates `<img>`; `frameSource.ts` uses `Image` behind a guard. |
| `renderer/` | 34 | 26 | **Browser-only, with four pure helpers** | `GpuRenderer`, `RenderGraph`, `WebGLContext`, `TexturePool`, every layer and the debug tooling need WebGL2 and canvases. The pure helpers are `gpu/layers/drawRect.ts`, `gpu/layers/objectFit.ts`, `gpu/viewport.ts` and `gpu/layers/textLayout.ts` (which takes an injected `TextMeasurer`, typed as `Pick<CanvasRenderingContext2D, 'font' \| 'measureText'>`). `renderer/types.ts` holds the `Renderer` interface; its `mount(container: HTMLElement)` is DOM-typed. |
| `media/` | 13 | 13 | **Browser-only, one reusable candidate** | WebCodecs (`VideoDecoder`, `VideoFrame`), `createImageBitmap`, mediabunny demux, `Blob`/`fetch`. `media/audio/AudioPlaybackController.ts` is the exception worth noting: it is a Web Audio *graph* (`createBufferSource`, `createGain`, `createAnalyser`, `decodeAudioData`, `linearRampToValueAtTime`, `ctx.currentTime`), and its only DOM touch is a `window.addEventListener('pointerdown' / 'keydown')` autoplay unlock behind `typeof window !== 'undefined'`. Given a Web-Audio-compatible `AudioContext` it may run as-is (section 5). |
| `export/` | 6 | 4 | **Browser-only** | `new Worker(new URL('./ExportWorker.ts', import.meta.url))`, `OffscreenCanvas`, `VideoEncoder`, `OfflineAudioContext`, mediabunny mux. |

Identifier counts across core (files, non-test): `WebGL2RenderingContext` 14, `VideoDecoder` 13,
`document.` 12, `window.` 14, `Blob` 10, `performance.now` 9, `fetch(` 8,
`HTMLCanvasElement` 8, `ImageBitmap` 7, `CanvasRenderingContext2D` 7, `AudioContext` 6,
`File` 5, `URL.createObjectURL` 3, `createImageBitmap` 3, `OffscreenCanvas` 2,
`HTMLVideoElement` 2, `new Worker` 1, `requestAnimationFrame` 1, `VideoEncoder` 1,
`navigator.` 0, `indexedDB` 0.

### Module evaluation is side-effect free

The whole barrel was bundled with esbuild (browser target, no externals) and imported in Node
24 with no DOM shims. It evaluated (104 exports), and this ran correctly:

```
barrel evaluated with no DOM; exports: 104
scene: texts 1 videos 1 text opacity mid-fade 1.00 total 90 tc 00:00:03:00
undo -> total 60 canRedo true
serialize -> readProjectDocument roundtrip fps: 30
placement math: drawRect {"x":0,"y":656.25,"width":1080,"height":607.5,"rotation":0}
                viewport {"x":0,"y":76,"width":390,"height":693}
play() without a RAF global -> ReferenceError: requestAnimationFrame is not defined
with RAF + performance.now the clock advanced: 0,1,2,3,4,4 ...
```

So importing `@elah/core` does not *execute* anything browser-specific at load time. What stops
it loading under Metro is a *parse-time* problem, next.

---

## 2. The one Metro blocker: `import.meta`

`packages/core/src/export/exportVideo.ts` spawns the export worker with
`new URL('./ExportWorker.ts', import.meta.url)`. The built file `dist/export/exportVideo.js` is
the **only** file in `@elah/core`'s dist, and the only file in the dependency graph that core
reaches, containing `import.meta`.

Metro and Hermes do not support `import.meta`. Projects hit this as
`'import.meta' is currently unsupported` at bundle time (reported across React Native 0.79 to
0.82 for several libraries). The documented workarounds are a Babel transform
(`unstable_transformImportMeta: true` in `babel-preset-expo`) or steering Metro's export
conditions towards CommonJS builds (`resolver.unstable_conditionNames = ['browser', 'require',
'react-native']`). Neither helps here: `@elah/core` ships only ESM, and the `import.meta.url`
is load-bearing on the web (`AGENTS.md` explains why the `.ts` literal must stay).

**Consequence:** an app that does `import { TimelineEngine } from '@elah/core'` fails to bundle
under Metro today even though the engine itself is fine. The fix is additive: a second entry
point, `@elah/core/engine`, that never reaches `export/`, `renderer/gpu/*` (except the pure
helpers), `media/*` or `assets/importFiles.ts`. That is workstream **RN-P1**.

Metro's package `exports` support, which the subpath relies on, is on by default since Metro
0.82 / React Native 0.79; it asserts the conditions `import` or `require`, `react-native`,
`browser` and `default`, and falls back to `main` for unlisted subpaths with a warning rather
than an error.

---

## 3. Runtime dependencies

| Package | Installed | On React Native | Evidence |
|---|---|---|---|
| `immer` | 10.2.0 | **Fine.** Needs `Proxy`; Hermes has had `Proxy`/`Reflect` since 0.7.0 (React Native 0.64). Immer's `exports` even carries a `react-native` condition pointing at `dist/immer.legacy-esm.js`. | `node_modules/immer/package.json`; Hermes `doc/Features.md`. |
| `zustand` | 5.0.13 | **Fine for what core uses.** Core imports only `zustand/vanilla` (7 sites); `@elah/react` imports the root entry (3 sites). Neither contains `import.meta`. The `zustand/middleware` ESM build *does* contain `import.meta.env`, and nothing in these packages imports it; keep it that way (the `no-react-imports` test already restricts entry points). | `grep import.meta node_modules/zustand/esm/*.mjs` lists `middleware.mjs` only. Zustand 5.0.4 fixed the CJS build's `import.meta` for RN (PR #3087). |
| `mediabunny` | 1.45.x | **Never import on RN.** Browser and Node only (its Node entry imports `node:fs/promises`). Only `createDefaultDemuxerFactory` imports it statically; the engine entry must not reach that file. | `node_modules/mediabunny/dist/modules/src/node.js`. |

---

## 4. The other packages

### `@elah/react`: reusable unchanged

13 source files, zero references to `document`, `window`, `HTMLElement`, `AudioContext`,
`navigator` or `localStorage`. It depends on `react` (peer `>=18`) and `zustand`. The three audio
hooks take an `AudioPlaybackController` *type* and call its methods; they do not construct one.
Everything here works on React Native as published.

### `@elah/timeline`: math reusable, components not

`Timeline.tsx`, `ClipBlock.tsx`, `Ruler.tsx`, `Playhead.tsx` are pointer/mouse/drag components
(44 DOM-event call sites between them); `useTimelineDrop.ts` is HTML5 drag-and-drop (17
`dataTransfer`/`DragEvent` references). The package peer-depends on `react-dom` and ships
Tailwind CSS. Not importable in RN.

Pure modules worth lifting: `zoomAnchor.ts` (anchored zoom arithmetic), `contentWidth.ts`
(`timelineContentWidth(totalFrames, zoom)`), `trackCompat.ts` (`isCompatibleTrackKind`), and
`insertAsset.ts` (`insertMediaAsset` / `insertElement` / `growClipToAssetDuration`, zero DOM,
built on the engine and the stores). Only the last group is exported today. RN-P9 proposes
moving the first three into `@elah/core` `utils/` so both timelines share them.

**Update 2026-10-08 (RN-T0):** done. The first three, the ruler tick and label logic, and new
trim / pinch helpers live in `packages/core/src/utils/timelineMath.ts`; the timeline modules
are re-exports.

**Correction 2026-10-08:** "`@elah/react`: reusable unchanged" (above) holds for the DOM but not
for Metro. `@elah/react` imports `@elah/core`'s root barrel by value, which reaches the
`import.meta` file, and `useMediaLibrary.ts` imports the browser importers (`importFiles`,
`importUrl`, `importBlob`). RN-T1 moves its value imports to `@elah/core/engine` and splits the
importers out.

### `@elah/editor`: one file reusable

`editor/EditorProvider.tsx` constructs the two engines, wires `change`/`history:change` into
`tracksStore` and `transitionsStore`, bridges `PlaybackEngine` and `playbackStore` with the echo
guard, and handles `project:loaded` rewinds. It imports nothing DOM-specific
(`installTraceGlobal` is window-guarded). It is the exact wiring the mobile provider needs, and it
lives in a package that peer-depends on `react-dom`, `lucide-react` and ships CSS. RN-P2 proposes
moving it to `@elah/react` with `@elah/editor` re-exporting it (non-breaking).

`Preview.tsx` and the overlays are DOM (canvas, `getBoundingClientRect`, CSS transforms).
`AssetPanel`, `ElementsPanel`, `SourcePanel` are DOM.

### `@elah/cli`: not involved

Node + Playwright. Irrelevant to mobile, except that `elah serve` is a fine *server-side* export
fallback for a mobile app that would rather upload a project document than encode on device.

---

## 5. Native capabilities the rebuilt pieces can stand on

Checked against vendor docs and the npm registry on 2026-10-06.

| Need | Web implementation | Native option | Status |
|---|---|---|---|
| Draw a `Scene` | `GpuRenderer` (WebGL2) | **`react-native-skia` 3.0.5.** Offscreen surfaces (`Skia.Surface.MakeOffscreen`, `getCanvas`, `flush`, `makeImageSnapshot`), `Paragraph` API with `layout(width)`, `getHeight()`, `getLongestLine()`, `getLineMetrics()`, custom fonts via `useFonts` / `Skia.TypefaceFontProvider`, `Path.MakeFromSVGString` for freehand data, `drawImageRect` with a source rect for crop, `clipRRect` for corner radius. Also runs headless in Node via CanvasKit, which matters for parity tests. | Ready. Requires RN >= 0.79 + New Architecture, React 19, Reanimated 4 / worklets 0.7. Android API 26+. |
| WebGL2 instead | | `expo-gl` 57.0.2 exposes `WebGL2RenderingContext` (older Android devices may lack WebGL2) and headless contexts via `createContextAsync()`, but `texImage2D` accepts only `ArrayBuffer` or `{ localUri }`, and there is no 2D canvas for text. | Rejected for the renderer; see D1. |
| Frame-accurate video decode | WebCodecs `VideoDecoder` + mediabunny | **A native module** over `AVAssetReader` (iOS) and `MediaExtractor` + `MediaCodec` (Android), decoding ahead into a per-source frame cache and handing frames to Skia as `SkImage`. Skia's own `useVideo` (since 1.3) delivers frames as Skia images but is playback-driven with millisecond `seek`, which does not satisfy "frame N shows `sourceFrame(N)`". `@azzapp/react-native-skia-video` 0.10.1 (2026-08) decodes to Skia frames and exports compositions with AAC audio, but its README calls it "a beta in a very unstable state" and its peer is `@shopify/react-native-skia >= 2` (the v2 line), not v3. | **Must build.** The largest native workstream (RN-P6). Evaluate skia-video as a reference implementation, not a dependency. |
| Audio playback graph | Web Audio (`AudioContext`) | **`react-native-audio-api` 0.13.6** (Software Mansion, MIT). Its coverage page lists `AudioBufferSourceNode`, `GainNode`, `AnalyserNode` and `AudioParam` as fully implemented; `AudioContext` partial (`close`, `suspend`, `resume`) and `BaseAudioContext` partial with `currentTime`, `destination`, `sampleRate`, `state`, `decodeAudioData`. That is every call `AudioPlaybackController` makes. Its README notes the engine "utilizes FFmpeg binaries" for decoding; weigh that in D5. | Promising; RN-P7 verifies by running the controller unmodified against it. |
| Offline audio mix for export | `OfflineAudioContext` | `react-native-audio-api` lists `OfflineAudioContext` as **not yet available**. | Export audio must be mixed natively (RN-P10). |
| MP4 encode | `VideoEncoder` + mediabunny mux in a Worker | `AVAssetWriter` + VideoToolbox (iOS); `MediaCodec` + `MediaMuxer` (Android), fed with frames read back from an offscreen Skia surface. | **Must build** (RN-P10). |
| FFmpeg | | `ffmpeg-kit-react-native` was retired on 2025-01-06 after legal advice on licensing and patents; binaries below 6.0 were removed by 2025-02-01 and 6.0 by 2025-04-01; the GitHub repository was archived on 2026-07-02; the npm package is deprecated. The author's continuation, FFmpegKitNext, is distributed as source only. | Not a dependency. See D4. |
| File import | `File`, `URL.createObjectURL`, `<video>` probe | `expo-image-picker` / `expo-document-picker` yield `file://` URIs; duration, dimensions, fps and `hasAudio` come from the decode module's probe; thumbnails from the same decoder via Skia. | RN-P8. |
| Workers | `new Worker(...)` | No Web Workers. Heavy work belongs in the native module or in worklets. The frame-step export loop runs on the JS thread with yielding, or on a native thread. | Design constraint, RN-P10. |

---

## 6. Reproduce this audit

From the repository root, after `npm install`:

```bash
# 1. Browser identifiers per core directory (non-test files)
cd packages/core/src
for d in $(find . -mindepth 1 -maxdepth 1 -type d | sort); do
  n=$(grep -rlE "\b(WebGL2RenderingContext|VideoDecoder|VideoEncoder|VideoFrame|OffscreenCanvas|HTMLCanvasElement|HTMLVideoElement|HTMLImageElement|createImageBitmap|ImageBitmap|AudioContext|OfflineAudioContext|new Worker|requestAnimationFrame|cancelAnimationFrame|document\.|window\.|navigator\.|URL\.createObjectURL|fetch\(|new Image\(|CanvasRenderingContext2D|getContext\(|performance\.now|indexedDB|localStorage|Blob|File\b)" --include=*.ts "$d" | grep -v '\.test\.ts' | wc -l)
  t=$(find "$d" -name '*.ts' ! -name '*.test.ts' | wc -l)
  echo "$d: $n of $t"
done

# 2. The import.meta blocker
grep -rl "import.meta" packages/core/src --include=*.ts | grep -v test     # one file
grep -rl "import.meta" packages/core/dist --include=*.js                   # one file

# 3. Evaluate the barrel with no DOM (esbuild is a devDependency of @elah/cli)
node_modules/.bin/esbuild packages/core/src/index.ts --bundle --format=esm --outfile=/tmp/core.bundle.mjs
node --input-type=module -e "const m = await import('/tmp/core.bundle.mjs'); console.log(Object.keys(m).length)"
```

Then run the smoke script from the snippet in section 1 (construct a `TimelineEngine`, add a
text clip with `{ type: 'text', text: { content } }`, `resolveTimeline`, `undo`,
`serializeProject(engine)` then `readProjectDocument`, construct a `PlaybackEngine` with and
without a `requestAnimationFrame` global).

If any number in this document changes, update the table **and** the date in the header.
