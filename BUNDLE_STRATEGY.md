# Bundle Strategy

> What `@elah/*` costs a consumer, how it is measured, and why the dependency
> graph looks the way it does. The goal: a browser-native editor SDK that a
> React app can adopt without dragging in a media-processing toolchain it did
> not ask for.

---

## Measured size (1.0.0, 2026-10-23)

`node scripts/measure-bundle.mjs` after `npm run build:packages`. esbuild, minified,
gzipped; `react`, `react-dom`, `lucide-react` and `mediabunny` external (the app ships
its own React and icons, and mediabunny is a lazy import a code-splitting bundler puts
in its own chunk).

### What a real app pays

Each row is a one-line module importing only those names, so the bundler tree-shakes the
rest. **The "editor app" row is the startup number to quote.**

| App imports | gz | raw (min) | biggest contributors (minified) |
|---|---|---|---|
| **editor app**: `EditorProvider`, `Preview`, `Timeline` from `@elah/editor` | **112.0 KiB** | 369.3 KiB | renderer 92, resolver 56, timeline pkg 45, media 40, editor pkg 26, editor 20, elements 14 |
| engine only: `TimelineEngine`, `resolveTimeline` from `@elah/core` | 44.7 KiB | 138.5 KiB | resolver 56, editor 20, effects 12, elements 12, renderer 10 |
| render + export: `TimelineEngine`, `GpuRenderer`, `exportVideo` | 75.0 KiB | 243.2 KiB | renderer 92, resolver 30, media 29, export 21, editor 20 |
| `@elah/core/spec` on its own (every export) | 71.0 KiB | 214.4 KiB | spec 122, vector 29, elements 20, icons 17, effects 11 |
| `@elah/core/html` on its own (every export) | 44.3 KiB | 134.7 KiB | vector 87, elements 24, effects 11, resolver 7 |

**What "startup" means here (CONV-8).** The script leaves every relative dynamic
`import()` inside `@elah/core` out of the bundle, because a code-splitting bundler (Vite,
webpack, Next) makes each one its own chunk that loads on first use. Before CONV-8 the
same method read **130.5 KiB** for the editor app (133.0 KiB when those lazy imports were
counted as if inlined, which is how CONV-7 printed it). The change moved effects, generators,
sequence clips, roto masks and the audio Enhance denoiser behind `renderer/gpu/features.ts`:
**130.5 to 112.0 KiB gz, 18.5 KiB saved**. The 105 KiB target was **not reached**; see
below.

**What loads on first use** (gz, from the bundle of a consumer that imports `GpuRenderer`):

| Feature | Loads when | Chunk holds |
|---|---|---|
| effects | first clip with an effect, mask, matte, blend, an adjustment clip, a transition or a compound reaches the renderer | `EffectChain`, all 23 GPU effects, mask / blend shaders, GPU transitions (about 12.6 KiB gz) |
| generators | first generator clip | `GeneratorLayer` and the generator painter |
| sequences | first sequence clip | `SequenceLayer`, frame provider and reader |
| roto masks | first video clip with a roto run | `RotoMaskLayer`, its frame provider |
| Enhance | first clip with Enhance on, preview or export | the denoise worklet source (about 5 KiB min) |

A frame that needs a feature still loading draws without it, and the renderer redraws its
last scene by itself when the load finishes. `prepareFeatures(project)` loads everything a
project needs up front. Export is unchanged: the export worker keeps static imports, and
the main-thread mix awaits the Enhance chunk before the first clip.

**Why 112 and not 105.** What is left is startup code that is not one of these features:
`tailwind-merge` 20 KiB min and the timeline package 45 KiB min (editor and timeline
packages, outside CONV-8), the resolver 56 KiB min (must stay synchronous), the audio
player 11 KiB min, the video decode path (`StreamingFrameProducer`, `VideoDecoderManager`,
`VideoFrameProvider`) about 20 KiB min, and the shape and text painters (about 24 KiB min,
needed by almost every project). Further candidates that stay inside the renderer are the
debug panel (3 KiB min), the probe layer (3 KiB min) and the adjustment layer (2 KiB min),
about 3 KiB gz together, which would give about 109.

**Startup grew from 0.6.0**: the engine plus React UI was 68 KiB gz at startup in 0.6.0 and
the editor app is 112 KiB gz now (133 before CONV-8). The remaining growth is code the
editor app needs on first paint: the renderer core (layers, shape and text painters, video
decode), the resolver (keyframes, expressions, compounds) and media. It is **not** the
experimental layers: `spec`, `html`, `ops` and `icons` contribute 0 bytes to the first
three rows, because they are `sideEffects: false` and nothing in those apps imports them.

### Worst case: everything exported

The same bundler run on each package barrel, with every export kept (what `export *`
defeats tree-shaking into). No real app pays this; it is here so the number is never
mistaken for startup cost.

| Package | own code, gz | with its small runtime deps, gz |
|---|---|---|
| `@elah/core` | 199.2 KiB | 202.2 KiB |
| `@elah/react` | 1.5 KiB | 1.5 KiB |
| `@elah/timeline` | 14.9 KiB | 21.6 KiB |
| `@elah/editor` (layer only) | 18.0 KiB | 18.0 KiB |
| **Full SDK, everything exported** (`editor` with `core` + `react` + `timeline`) | **154.8 KiB** | **164.5 KiB** |

The `@elah/core` barrel includes the root only; the subpath entries are separate, so their
code is not in that 199 KiB.

---

## Measured size (0.6.0, 2026-10-02)

> **These tables are the 0.6.0 measurement and do not describe 1.0.0.** They are kept as
> the baseline the 1.0.0 numbers above are compared with; the packed tarball also grew
> about elevenfold (see "What `npm pack` ships in 1.0.0" below).

Reproduce with `node scripts/measure-bundle.mjs` after `npm run build:packages`.
Two measurements are printed because they answer different questions, and the
numbers in earlier versions of this file mixed them up.

### What a browser downloads

Each package barrel bundled with esbuild (`--bundle --minify --format=esm`,
then gzipped). `react`, `react-dom` and `lucide-react` are external because the
host app ships its own copy.

| Package | own code, gz | with its small runtime deps, gz |
|---|---|---|
| `@elah/core` | 40.5 KiB | 43.5 KiB |
| `@elah/react` | 0.9 KiB | 0.9 KiB |
| `@elah/timeline` | 14.7 KiB | 21.4 KiB |
| `@elah/editor` (layer only) | 18.5 KiB | 18.5 KiB |
| **Full SDK** (`editor` with `core` + `react` + `timeline` bundled in) | **69.1 KiB** | **78.7 KiB** |

"Small runtime deps" are `immer` (4.8 KiB gz), `zustand` (3.2), `clsx` (0.2)
and `tailwind-merge` (6.9). `mediabunny`, the demuxer and muxer, is **158.5 KiB
gz on its own** and is accounted for separately below, because whether it loads
at startup depends on how the app wires the demuxer.

### Three real app shapes, with code splitting

The same bundler run with `splitting: true`, which is what Vite, webpack and
Next do. "At startup" is every chunk the entry imports statically.

| App | at startup, gz | deferred to first decode / export |
|---|---|---|
| Engine only: `TimelineEngine`, `resolveTimeline`, `createTextClip` from `@elah/core` | **11 KiB** | nothing |
| Engine + React UI, demuxer injected or omitted | **68 KiB** | mediabunny, 158 KiB |
| The README quick start, which calls `createDefaultDemuxerFactory()` | **227 KiB** | export worker only |

The third row is the honest cost of the documented path. `createDefaultDemuxerFactory`
imports `mediabunny` **statically** (it is the only module in the packages that
does), so any bundle that references it pulls the codec into the startup graph.
Everything else reaches mediabunny through a dynamic `import()` in
`MediabunnyDemuxer` and `hasAudio`, which bundlers split into a chunk that loads
on first decode. An app that wants the 68 KiB startup either passes its own
factory via `createMediabunnyBackend` or passes no factory and lets the demuxer
lazy-load. Making `createDefaultDemuxerFactory` itself lazy is a tracked
follow-up; it needs a backend wrapper whose `open()` awaits the import, since
`DemuxerFactory` is synchronous.

### What `npm pack` ships

The tsc ESM output, unminified and not tree-shaken. This is the tarball, not
the runtime cost, and it overstates the latter by roughly 60 percent.

| Package | files | raw | gz |
|---|---|---|---|
| `@elah/core` | 99 | 335.9 KiB | 64.4 KiB |
| `@elah/react` | 7 | 3.8 KiB | 1.0 KiB |
| `@elah/timeline` | 26 | 105.3 KiB | 20.2 KiB |
| `@elah/editor` | 19 | 119.9 KiB | 22.5 KiB |

The 0.2.1 figures that used to live here (~41 / ~12 / ~10 / ~63 KiB) were this
tarball measurement, presented in the badges as if they were a bundle size.
They are retired. (The README badges that quoted the 0.6.0 bundle were removed for
1.0.0 rather than left stating a number that no longer holds.)

### What `npm pack` ships in 1.0.0

`npm pack --dry-run --json --workspace=packages/<name>`, 2026-10-22. Packed size is the
tarball a consumer downloads; the fonts are woff2 and do not compress further.

| Package | files | packed | unpacked |
|---|---|---|---|
| `@elah/core` | 735 | 1,158,481 B (about 1.2 MB) | 3,028,695 B (3.0 MB) |
| `@elah/react` | 21 | 9,331 B | 29,817 B |
| `@elah/timeline` | 56 | 35,442 B | 151,711 B |
| `@elah/editor` | 42 | 41,961 B | 177,555 B |

About 623 KB of `@elah/core` is the twelve bundled font families (`fonts/<id>/`, with each
`OFL.txt`). A host loads them only if it serves them or opts in with `packageFontsBaseUrl()`.
`@elah/core` was about 106 KB packed in 0.6.0.

---

## Dependency budget

Runtime dependencies, per package, as published:

| Package | Runtime dependencies | Why |
|---|---|---|
| `@elah/core` | `immer` | Structural-sharing mutations and undo/redo in `TimelineEngine` |
| | `zustand` | Vanilla stores (`tracksStore`, `playbackStore`, …) that `@elah/react` mirrors into React |
| | `mediabunny` | Demux for decode, mux for export, audio-track probing. Lazy except through `createDefaultDemuxerFactory`, see above |
| `@elah/react` | `zustand` | The `useStore` bridge |
| `@elah/timeline` | `clsx`, `tailwind-merge` | The `classNames` slot API and `cn` |
| `@elah/editor` | `immer`, `zustand` | Re-exported for consumers who build on the stores directly |

`react` and `react-dom` (`>= 18`) are **peer** dependencies of `react`,
`timeline` and `editor`; `lucide-react` (`>= 0.400`) is a peer of `timeline`
and `editor`. The host app owns all three.

`@elah/cli` is a **binary, not a library**: nothing it depends on reaches a
consumer bundle. Its budget:

| Dependency | Why |
|---|---|
| `@elah/core` | The engine itself. esbuild bundles it into `dist/bin.js` at build time and tree-shakes the browser-only modules out of the Node binary |
| `playwright-core` | Drives the system Chrome so `elah export` runs core's real `exportVideo` pipeline (WebCodecs and OffscreenCanvas are browser-only). No browser download |
| `mediabunny` | Probes media duration and dimensions for `elah build` in plain Node (pure-JS demux, ranged reads for remote URLs) |
| `esbuild` (dev) | Build-time bundling of the binary |

Everything else the engine needs is a browser-native API, not a dependency:
WebCodecs (`VideoDecoder`, `VideoEncoder`), WebGL2, Web Audio, `OffscreenCanvas`,
`createImageBitmap`. No WASM runtime ships in any package.

---

## Where mediabunny is allowed to appear

Demuxing and muxing are the heaviest piece of a video editor, so the rule is
that they are reachable but never load unless the app decodes or exports.

- `@elah/editor`, `@elah/timeline` and `@elah/react` never import mediabunny.
- In `@elah/core`, `MediabunnyDemuxer.open()` and `hasAudio` use `import('mediabunny')`.
  The export worker imports it statically, but the worker is its own module
  graph, loaded through `new Worker(new URL('./ExportWorker.ts', import.meta.url))`
  only when `exportVideo` runs.
- `createDefaultDemuxerFactory` is the one static import, documented above.
- The `DemuxerBackend` interface and `createMediabunnyBackend(mb, opts)` let an
  app supply its own mediabunny build, or a different decoder entirely:

```ts
import { GpuRenderer, createMediabunnyBackend } from '@elah/editor'
import * as mediabunny from 'mediabunny'

const demuxerFactory = () => createMediabunnyBackend(mediabunny)
new GpuRenderer({ demuxerFactory })
```

- Without any `demuxerFactory`, the renderer falls back to a synthetic provider,
  so the engine is usable and testable with zero media loaded.

---

## Five packages, one dependency direction

```
@elah/core  ←  @elah/react  ←  @elah/timeline  ←  @elah/editor
@elah/core  ←  @elah/cli
```

`core` has no React. `react` is the only package that imports it for the store
bridge. `timeline` and `editor` are React components. A consumer who wants the
engine alone installs `core` and imports `@elah/core/engine`, which leaves out the
renderer, the codec and the export worker.
`ARCHITECTURE.md` § 9 (A6) is the rule against splitting further into
micro-packages; these five exist because each has a real, separately adopted
consumer.

**`@elah/core/engine`** is a second entry into the same package: the engine,
resolver, playback clock, stores, clip factories and pure placement / timeline
math, with no renderer, no codec, no mediabunny, no export worker and no DOM
importers. It is what React Native (Metro + Hermes cannot parse the export
worker's `import.meta`) and engine-only consumers import.
`src/engine.no-browser.test.ts` pins exactly which source files it may reach.
`@elah/react` imports core's values through it. `@elah/react-native` (pre-release)
sits beside the web UI packages: `core ← react ← react-native`.

---

## Tree-shaking and dead-code boundaries

- **Named exports only** from every barrel, no namespace re-exports, so bundlers
  can drop unused symbols. The engine-only row above is this working.
- **Debug tooling is import-only-when-needed.** `GpuRendererDebugPanel`,
  `DebugGpuRenderer`, `DebugOverlay` and the scenario harness are not on the
  production render path.
- **The export worker is a separate module graph**, code-split by any bundler
  that understands the `new URL(..., import.meta.url)` worker pattern.
- **Trace logging is a cheap no-op when off.** `trace()` is a single `Set`
  lookup, and `PerfSummary` is silent unless the `PERF` channel is on.

---

## Consumer build requirements

- A bundler that understands the `new URL(..., import.meta.url)` worker pattern
  and splits dynamic imports: Vite, webpack 5, Next. The `examples/` apps use
  Vite and Next.
- WebCodecs, WebGL2 and Web Audio at runtime, which today means Chromium. There
  is a WebGL1 fallback in `WebGLContext`, but decode requires WebCodecs.

---

## Future

- Make `createDefaultDemuxerFactory` lazy so the quick-start path no longer pulls the
  codec (about 159 KiB gzipped) into the startup graph.
- Trim what the editor app pays at startup further (112 KiB gz after CONV-8 loaded effects,
  generators, sequence, roto and audio Enhance on first use, against 68 KiB in 0.6.0 and a
  target of 105 KiB). What is left is outside those features; see "Why 112 and not 105"
  above. The model-facing layers are already subpath entries (`@elah/core/spec`, `/html`,
  `/ops`, `/icons`) and cost an app nothing unless imported, so they are not where the
  startup goes.
- Optional sub-path exports (for example `@elah/editor/export`) if apps want the
  timeline without the export worker in their module graph.
- A formal `@public` / `@experimental` marking in the type declarations. For 1.0.0 the
  policy is by layer: the exported surface of `@elah/core` (root and `/engine`),
  `@elah/react`, `@elah/timeline` and `@elah/editor` is a semver promise, while the
  `@elah/core/spec`, `/html`, `/ops` and `/icons` entries are experimental and may change
  in a minor release (see `CHANGELOG.md`).
