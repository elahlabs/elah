# Bundle Strategy

> How `@elah/editor` stays small and why the dependency graph looks the way it
> does. The goal: a browser-native editor SDK that a React app can adopt without
> dragging in a media-processing toolchain it didn't ask for.

---

## Measured size

Per-package `dist/` (ESM output of `tsc`, no app bundler), measured on the
current `main`:

| Package | gzipped | raw |
|---|---|---|
| `@elah/core` | ~41 KiB | 218 KiB |
| `@elah/timeline` | ~12 KiB | 61 KiB |
| `@elah/editor` (layer only) | ~10 KiB | 51 KiB |
| **Full SDK** (`core` + `timeline` + `editor`) | **~63 KiB** | 330 KiB |

Runtime deps that ship with the SDK: `immer` (~9 KiB gz) and `zustand`
(<1 KiB gz). `react` / `react-dom` are peers and not counted. `mediabunny`
(the heavy media codec layer) is injected by the host app and never bundled —
see below.

---

## Dependency budget

The published package depends on exactly two runtime libraries:

| Dependency | Why it's in |
|---|---|
| `immer` | Structural-sharing mutations + undo/redo in `TimelineEngine` |
| `zustand` | Ring 1 reactive store mirrors for React consumers |

`react` / `react-dom` are **peer** dependencies (`>= 18`) — the host app owns the
React copy.

`@elah/cli` is a **binary, not a library** — nothing it depends on can reach a
consumer bundle. Its budget is still enumerated:

| Dependency | Why it's in |
|---|---|
| `@elah/core` | The engine itself — the CLI is a thin consumer of its public APIs |
| `playwright-core` | Drives the system Chrome so `elah export` runs core's real `exportVideo` pipeline (WebCodecs/OffscreenCanvas are browser-only); no bundled browser download |
| `mediabunny` | Probes media duration/dimensions for `elah build` in plain Node (pure-JS demux, no WebCodecs; ranged reads for remote URLs); already a core dependency, bundled into the binary, never reaches a consumer bundle |
| `esbuild` (dev, build-time only) | core's tsc dist uses extensionless relative imports (bundler resolution) that plain Node cannot resolve; the CLI bundles at build time and tree-shakes core's browser-only modules out of the Node binary |

`@elah/export-server` is a **server-side library** — it imports `node:child_process`
and a native addon, so it can never be pulled into a browser bundle even by
accident:

| Dependency | Why it's in |
|---|---|
| `@elah/core` | The resolver and the placement helpers (`resolveDrawRect`, `computeTextLayout`); the package is a `Scene` consumer and shares core's geometry so server output matches the editor |
| `@napi-rs/canvas` | The 2D compositor in Node (Skia-backed). Ships prebuilt per-platform binaries, so a deploy box needs no build toolchain; `GlobalFonts.registerFromPath` is what makes text render at all in a container with no system font stack |
| `mediabunny` | Probes source duration/dimensions, supplies the packet PTS index that drives frame-accurate seeking, and re-opens the finished MP4 to validate it; already a core dependency, and none of these paths need WebCodecs |
| `esbuild` (dev, build-time only) | Same reason as the CLI — resolves core's extensionless imports and tree-shakes its browser-only modules out of the Node bundle |

**ffmpeg is deliberately not a dependency.** It is discovered as a system binary
(`opts.ffmpegPath` → `ELAH_FFMPEG` → `PATH`), the same way
`packages/cli/src/lib/browser.ts` discovers system Chrome rather than bundling
one. Vendoring a static build would add ~80 MiB per platform, drop the hardware
encoders (`h264_videotoolbox`, NVENC, QSV) that are a main reason to run this
path at all, and mean redistributing a GPL binary from an Apache-2.0 package.

Everything else the engine needs is a **browser-native API**, not a bundled
dependency: WebCodecs (`VideoDecoder`), WebGL2, Web Audio (`OfflineAudioContext`),
`OffscreenCanvas`, `createImageBitmap`. No WASM runtime ships in the core.

---

## mediabunny is injected, never bundled

Demuxing/muxing is the heaviest piece of a video editor, and `@elah/editor`
deliberately does **not** depend on it. The core defines a `DemuxerBackend`
interface and accepts a `demuxerFactory`; the consuming app imports `mediabunny`
and wires it in:

```ts
import { GpuRenderer, createMediabunnyBackend } from '@elah/editor'
import * as mediabunny from 'mediabunny'

const demuxerFactory = () => createMediabunnyBackend(mediabunny, { /* … */ })
new GpuRenderer({ demuxerFactory })
```

Consequences:

- Apps that only need the timeline/engine never pull in mediabunny.
- `@elah/editor`'s `index.ts` never statically imports mediabunny — the
  `createMediabunnyBackend` adapter takes the module as an argument.
- Without a `demuxerFactory`, the renderer falls back to a synthetic provider, so
  the engine is usable (and testable) with zero media dependencies.

The export path *does* use mediabunny directly inside the worker, because muxing
an MP4 has to happen somewhere; that import lives in `ExportWorker.ts` and is only
pulled when an app actually bundles and spawns the worker.

---

## One package, folders not packages

The repo is a single package (`@elah/editor`) with three internal layers
(`core/` → `timeline/` → `editor/`). No micro-packages (`@app/types`,
`@app/utils`, …) — they add build steps and version-skew without buying
isolation that folders + a dependency rule don't already provide
(`ARCHITECTURE.md` § 9, A6). Extraction stays mechanical if real pressure
(a non-React consumer, independent adoption) ever appears.

---

## Tree-shaking & dead-code boundaries

- **Named exports only** from `index.ts` — no namespace re-exports — so bundlers
  can drop unused symbols.
- **Debug tooling is import-only-when-needed.** `GpuRendererDebugPanel`,
  `DebugGpuRenderer`, `DebugOverlay`, and the scenario harness are not on the
  production render path; an app that never calls `setDebug(true)` doesn't pay
  for them.
- **The export worker is a separate module graph.** It's loaded via
  `new Worker(new URL('./ExportWorker.ts', import.meta.url), { type: 'module' })`,
  which Vite (and compatible bundlers) code-split automatically. An app that
  never exports never loads the worker chunk.
- **Trace logging is a cheap no-op when off.** `trace()` is a single `Set`
  lookup; disabled channels cost nothing on hot paths.

---

## Consumer build requirements

- A bundler that understands the `new URL(..., import.meta.url)` worker pattern
  (Vite, recent webpack). The playground uses Vite.
- WebCodecs / WebGL2 / Web Audio at runtime — i.e. a modern Chromium or Firefox.
  There is a WebGL1 fallback in `WebGLContext`, but decode requires WebCodecs.

---

## Future

- Optional sub-path exports (e.g. `@elah/editor/export`) if apps want the timeline
  without the export worker in their module graph.
- A formal `@public` API surface marking so internal symbols can change without a
  major version bump.
