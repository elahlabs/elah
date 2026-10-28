# 05 — Decisions

> Status: living document. Last verified: 2026-10-06.
> Each entry has a status: **decided** (change it with a PR that argues the reversal),
> **recommended** (the default unless a ticket's evidence says otherwise; the ticket that
> confirms or overturns it updates this file), or **open** (needs a decision before the named
> ticket starts). Keep the reasoning; a decision without its "why" is a rule nobody can revisit.

| # | Decision | Status | Owner ticket |
|---|---|---|---|
| D1 | Skia (`react-native-skia` v3) is the renderer, not WebGL via `expo-gl` | decided | RN-P4 |
| D2 | Mobile code is one package, `@elah/react-native`, versioned independently | decided | RN-P3 |
| D3 | The engine is consumed through a new `@elah/core/engine` entry, not a `react-native` export condition on `.` | decided | RN-P1 |
| D4 | No FFmpeg. Platform codecs via a first-party native module | decided | RN-P6, RN-P10 |
| D5 | Audio playback through `react-native-audio-api` as an optional peer | recommended | RN-P7 |
| D6 | Native module tooling and the frame hand-off to Skia | open | RN-P3, RN-P6 |
| D7 | Core's `Renderer.mount(HTMLElement)` stays; mobile defines `SceneRenderer` locally | decided for v0.1 | RN-P4 |
| D8 | One bundled default font for parity | open | RN-P5 |
| D9 | Render on the JS thread first; worklets only if measured necessary | recommended | RN-P0, RN-P4 |
| D10 | Expo dev harness in `apps/mobile`; the library stays bare-RN compatible | decided | RN-P0, RN-P3 |
| D11 | `EditorProvider` moves to `@elah/react` | decided | RN-P2 |
| D12 | Timeline math moves to `@elah/core`; UI is rewritten, not ported | decided | RN-P9 |
| D13 | Reuse `@elah/cli`'s `elah serve` as an optional server-side export | recommended | after RN-P10 |
| D14 | `@elah/react`'s media-library hook gets a `.native` variant instead of an API change | decided | RN-T1 |

---

## D1 — Skia, not WebGL

**Decided.** `expo-gl` 57 does expose a `WebGL2RenderingContext` and headless contexts, so the
question was real. It loses on three facts from the audit: the shipped `GpuRenderer` needs an
`HTMLCanvasElement` and uploads `ImageBitmap` / `VideoFrame` textures; `expo-gl`'s `texImage2D`
takes only an `ArrayBuffer` or a `file://` URI, so every frame would be a CPU copy; and text,
shapes and freehand strokes are rasterised through a 2D canvas on the web, which React Native
does not have. Reusing the GL code would mean rewriting every layer on a less capable surface.

Skia v3 gives GPU compositing (Graphite), `Paragraph` text, path rendering, offscreen surfaces
and image snapshots, plus a headless Node mode for parity tests. Cost: a hard floor of React
Native 0.79 + New Architecture, React 19 and Reanimated 4. Accepted; those are the current
defaults anyway (RN 0.87, Expo SDK 57).

## D2 — One package, independent version

**Decided.** `ARCHITECTURE.md` section 9 A6: a package exists where the dependency set or the
audience differs. Renderer, timeline, import and the native module all ship to the same consumer
with the same peers. The native module could become its own package later if a non-Elah app wants
frame-accurate decode on its own; not before.

Independent versioning follows `@elah/cli`'s precedent: the four web packages release in
lockstep because they are consumed together; mobile is at 0.x while they are at 0.6+, and
coupling the version numbers would force empty releases on one side or the other.

## D3 — A subpath export, not a conditional `.`

**Decided.** Adding a `react-native` condition to core's `"."` export that maps to the engine
barrel would make `import { GpuRenderer } from '@elah/core'` *silently* resolve to nothing on
Metro, and would change what the same import means per bundler. An explicit `@elah/core/engine`
says what it is, is greppable, and is useful on the web too (an engine-only app pays 11 KiB gz
per `BUNDLE_STRATEGY.md`, and this entry makes that path a first-class import). Metro resolves
`exports` subpaths by default since 0.82 / RN 0.79.

## D4 — No FFmpeg

**Decided.** `ffmpeg-kit-react-native` was retired on 2025-01-06 after the author's legal advice
on licensing and patents; binaries were pulled by April 2025, the repository was archived on
2026-07-02 and the npm package is deprecated. FFmpegKitNext is source-only and puts the same
licensing question on us. Platform codecs (VideoToolbox / `AVAssetReader` / `AVAssetWriter` on
iOS; `MediaCodec` / `MediaExtractor` / `MediaMuxer` on Android) are hardware-accelerated, ship
with the OS and carry no distribution question. The cost is two platform implementations of the
decode ring and the encoder, which is the bulk of RN-P6 and RN-P10.

Note for D5: `react-native-audio-api`'s README says its engine "utilizes FFmpeg binaries" for
decoding. That is their distribution decision, not ours, but an app that must avoid FFmpeg
entirely should know. The alternative is a native `decodeAudioData` in our module.

## D5 — `react-native-audio-api` for playback

**Recommended.** Its coverage page (checked 2026-10-06) lists exactly the nodes
`AudioPlaybackController` builds: `AudioBufferSourceNode`, `GainNode`, `AnalyserNode`,
`AudioParam` fully; `BaseAudioContext` with `currentTime`, `destination`, `sampleRate`, `state`,
`decodeAudioData`; `AudioContext` with `close` / `suspend` / `resume`. If the controller runs
unmodified against it, mobile audio is a wrapper and the web and mobile share one scheduler.
`OfflineAudioContext` is listed as not available, so export mixes natively regardless (D4 note).

Why optional: an app that uses the engine for silent previews should not carry an audio engine.
`<Preview enableAudio={false}>` must work with the peer absent.

Falls back to: a native `AVAudioEngine` / `AudioTrack` scheduler driven by `scene.audios`, with
the same gain graph, if RN-P7 finds a gap that cannot be shimmed.

## D6 — Native module tooling and the Skia hand-off

**Open.** Decide in RN-P3 (tooling) and RN-P6 (hand-off).

Tooling candidates: **Expo Modules API** (Swift/Kotlin, lowest friction with the Expo harness,
supports synchronous functions) and **Nitro Modules** (`react-native-nitro-modules` 0.37,
C++/Swift/Kotlin with typed codegen, synchronous JSI HostObjects, `ArrayBuffer` hand-off). The
deciding requirement is invariant I4: `getCurrent(sourceFrame)` must be a *synchronous* call that
returns a frame handle or null, on every render tick. Prototype that one call in both; pick the
one that is synchronous, cheap, and keeps the frame off the JS heap.

Hand-off candidates for a decoded frame to become an `SkImage` without a CPU copy: Skia's
native-buffer image constructor (the path `react-native-vision-camera` Skia frame processors
use), an `ImageReader` / `HardwareBuffer` on Android and `CVPixelBuffer` on iOS. Confirm the
exact API on the installed Skia 3.x and record it here with the version.

## D7 — `Renderer.mount(HTMLElement)` stays in core for now

**Decided for v0.1.** Making core's `Renderer` generic over its mount target is correct and
small, but it is a public type change in a package that releases in lockstep with three others.
Shipping the mobile renderer behind a local `SceneRenderer` first costs one interface and keeps
core's release independent of mobile's timeline. Revisit after RN-P10 with the real mobile
signature in hand.

## D8 — A bundled default font

**Open.** Decide in RN-P5. The web defaults to `fontFamily: 'sans-serif'`, resolved by the
browser to whatever the OS has. Mobile has no such alias with identical metrics, and parity tests
(RN-P5) need the same glyph widths on both sides. Options: bundle one open-licensed family
(Inter or Noto Sans, OFL) in both the harness and the playground fixture and make it the mobile
default when `fontFamily` is unset; or keep `sans-serif` mapped to the system font and accept
different breaks. Recommendation: bundle; a video editor that wraps a title differently on two
devices has a bug, not a style.

## D9 — JS thread first

**Recommended.** Record the `SkPicture` on the JS thread inside the RAF loop and publish it to a
shared value; the UI thread repaints. This is the simplest design that satisfies M1 (no React
commit per frame). Moving `resolveTimeline` + recording into a worklet is possible because the
resolver is pure and `Scene` is plain data, but it doubles the surface to debug. Only do it if
RN-P0's numbers on the floor Android device miss the frame budget.

## D10 — Expo harness, bare-compatible library

**Decided.** `apps/mobile` is an Expo SDK 57 app because it is the fastest way to a device for a
contributor, and because `expo-image-picker` / `expo-file-system` are the obvious import
primitives. The *library* must not require Expo: no `expo-*` import inside
`packages/react-native/src` outside an adapter the app passes in (the pickers are injected
through `useImportMedia({ pickers })` or live in the harness). `examples/react-native` (RN-P11)
should be a bare React Native app to prove it.

**Amended 2026-10-08 (RN-T3): the harness is not a root workspace member.** Expo SDK 57 pins
React 19.2.3 and React Native 0.86.3; the root workspace hoists React 18 for the web packages.
As a member, `npm install` at the root would either nest a second React or rewrite the root
lockfile around Expo. So `apps/mobile` has its own `node_modules` and lockfile, the root
`workspaces` lists `apps/web` and `apps/server` explicitly, and Metro loads the `@elah`
packages from `src` and resolves their npm imports from the harness (one React in the bundle,
verified from the source map). TypeScript reads the packages' built `.d.ts` files.

## D11 — `EditorProvider` to `@elah/react`

**Decided.** The file has no DOM reference and is the exact wiring mobile needs. Copying it into
the mobile package would fork the trickiest plumbing in the codebase (the echo guard, the
`project:loaded` rewind). Moving it is non-breaking because `@elah/editor` re-exports it.

## D12 — Timeline math to core; UI rewritten

**Decided, and done for the math (RN-T0, 2026-10-08).** The gesture *meaning* (move, trim,
pinch) also lives outside the components, in `packages/react-native/src/timeline/model/`, as
pure reducers that return an `EngineCommand`. The timeline is built first, before the preview;
see the top of `04-workstreams.md`. `zoomAnchor.ts`, `contentWidth.ts` and `trackCompat.ts` are pure, tested and have no
React dependency, so they belong in `@elah/core` by the "what lives where" rule. The components
are DOM and Tailwind; a gesture-handler timeline shares nothing with them but the math and the
stores. "Port the web timeline" is not a ticket anyone should take.

## D13 — Server-side export via `elah serve`

**Recommended, later.** A phone exporting a long 4K timeline will be slow and hot. `@elah/cli`'s
`elah serve` already accepts a build spec over HTTP and returns an MP4, and `serializeProject`
output is a stable document. An "export in the cloud" option that posts the project document is
cheap to add once a server exists for it, and is independent of RN-P10. Not v0.1.

---

## D14 — A `.native` media-library hook, not an API change

**Decided (RN-T1, 2026-10-08).** `@elah/react`'s `useMediaLibrary` returns `importFiles`,
`importUrl` and `importBlob`, imported by value from core's root entry. That import is what kept
`@elah/react` out of Metro. The options were: inject the importers (a breaking change for apps
that use `@elah/react` without `@elah/editor`), move them to `@elah/editor` (also breaking), or
add `useMediaLibrary.native.ts`. Metro prefers a `.native` file on iOS and Android, including in
`node_modules`; browsers, Node and every web bundler ignore it. The variant has the same API and
store; its importers throw with a pointer to RN-P8. Zero change for web consumers. A test pins
that the variant imports nothing from `@elah/core` by value. Revisit when RN-P8 gives mobile a
real importer: the `.native` file could then call it.

---

## Rejected alternatives (so nobody re-litigates them without new facts)

- **WebView wrapper around `@elah/editor`.** Codec and GL availability depend on the OS browser
  engine; no native file access; export runs in a sandboxed WebView process. See D1.
- **`@azzapp/react-native-skia-video` as the decoder.** Useful reference, wrong dependency: its
  README calls it "a beta in a very unstable state" and it peers on `@shopify/react-native-skia
  >= 2` (the 2.x line), which conflicts with Skia v3. Read its decode ring and composition export
  before writing RN-P6/P10; do not depend on it.
- **Skia's `useVideo` as the frame source.** Frames arrive as Skia images, but delivery is
  playback-driven with millisecond `seek`; it cannot promise "frame N shows `sourceFrame(N)`",
  which is the whole point of the resolver. Fine for a demo in RN-P0; not the provider.
- **`react-native-video` / `expo-video`.** Players, not frame sources.
- **A separate `@elah/native-media` package now.** A6. Revisit when someone outside Elah asks.
