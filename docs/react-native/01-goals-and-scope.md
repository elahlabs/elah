# 01 — Goals and scope

> Status: proposed. Last verified: 2026-10-06 against `dev` @ `e9fe11c`.

## What `@elah/react-native` is

A React Native package that lets an iOS or Android app host the Elah engine the way
`@elah/editor` lets a browser host it:

- **The same document.** A project saved on the web (`serializeProject`, `PROJECT_VERSION`)
  opens on mobile through the same `readProjectDocument`, and vice versa. There is no mobile
  schema.
- **The same engine.** `TimelineEngine`, `PlaybackEngine`, `resolveTimeline`, the vanilla stores
  and the clip factories are imported from `@elah/core`, not copied.
- **The same React layer.** `useTimelineEngine`, `usePlaybackStore`, `useTracksStore`,
  `useSelectionStore` and the rest come from `@elah/react` unchanged.
- **A native output path.** A Skia renderer draws the `Scene`; a native module decodes video
  frames and encodes MP4; `react-native-audio-api` (or a native equivalent) plays audio. None of
  the browser-only modules in core (`renderer/gpu`, `media/*`, `export`, `assets/importFiles`)
  are used.

The result for an app developer should read like the web quick start with the stylesheets
removed:

```tsx
import { EditorProvider } from '@elah/react-native'          // re-exported from @elah/react
import { Preview, Timeline, useImportMedia } from '@elah/react-native'

export function Editor() {
  return (
    <EditorProvider fps={30} stage={{ width: 1080, height: 1920 }}>
      <Preview style={{ flex: 1 }} />
      <Timeline style={{ height: 240 }} />
    </EditorProvider>
  )
}
```

The component names are deliberately the web ones. The props will differ where the platform
differs (no `className`, no `demuxerFactory`), and those differences are listed in
[`03-architecture.md`](./03-architecture.md).

## What it is not

- **Not a WebView.** Embedding the web editor in a WebView would inherit WebCodecs and WebGL2
  availability from the OS browser engine, which is neither guaranteed nor fast on Android. It
  also gives up native file access and background export.
- **Not a port of the web UI.** `@elah/timeline` and the `@elah/editor` panels are DOM
  components with Tailwind styling, pointer events and HTML5 drag-and-drop. The mobile timeline
  is a new component built on `react-native-gesture-handler`, sharing only the math and the
  store hooks.
- **Not WebGL on mobile.** `expo-gl` does expose a WebGL2 context, but the shipped `GpuRenderer`
  needs an `HTMLCanvasElement`, uploads `ImageBitmap` / `VideoFrame` textures, and rasterises
  text through a 2D canvas. None of those exist in React Native, and `expo-gl`'s `texImage2D`
  accepts only an `ArrayBuffer` or a `file://` URI. Reusing the GL renderer would mean
  reimplementing every layer anyway, on a less capable surface than Skia. See
  [`05-decisions.md`](./05-decisions.md) D1.
- **Not FFmpeg.** See D4.

## Goals for v0.1

Ordered. Each maps to one or more workstreams in [`04-workstreams.md`](./04-workstreams.md).

| # | Goal | Measured by |
|---|------|-------------|
| G1 | `@elah/core` has a browser-free entry point that loads under Metro and Hermes. | `import { TimelineEngine } from '@elah/core/engine'` works in an Expo app with no Babel workaround. A core test fails if a browser global leaks into that entry. |
| G2 | A `Project` with text, image, shape and freehand clips previews on device at the project fps with no React re-render per frame. | Skia preview at 30 fps on a mid-range Android device and any supported iPhone; React DevTools shows zero commits during playback. |
| G3 | Geometry parity with the web for non-video clips. | For a fixture project, the draw rect of every clip at frames 0, N/2 and N-1 matches the web's `resolveDrawRect` output exactly, and text line breaks match for the bundled default font. |
| G4 | Video clips decode frame-accurately from local files. | Scrubbing to frame N shows source frame `sourceFrame(N)` per the resolver, not the nearest keyframe; verified with a numbered test clip. |
| G5 | Audio plays in sync with the clock, with per-clip and master gain. | A 60-second clip drifts less than one frame against the picture over its length. |
| G6 | Import from the device photo library and the file system populates the same `MediaAsset` model, with thumbnails. | The asset panel shows duration, dimensions, `hasAudio` and a filmstrip for a picked video. |
| G7 | Export to MP4 on device with audio, deterministic from `(project, frame)`. | Exporting the same project twice yields identical frame hashes; a text-and-image project exported on web and on device differs only by codec noise. |
| G8 | The package is on npm with an example app installing it from the registry, and a docs page. | `examples/react-native` builds against the published version; `/docs/react-native` exists on elah.dev. |

## Non-goals for v0.1

Deferred, not rejected. Each has a note on why.

- **Transitions other than `fade`.** `slide` and `wipe` need the snapshot-overlay trick; on
  Skia that is a `makeImageSnapshot` of the previous frame. Fade first, the other two once the
  snapshot path is proven.
- **Several video clips decoding at once.** The web has no decode scheduler either
  ([`CURRENT_LIMITATIONS.md`](../../CURRENT_LIMITATIONS.md)). One active video clip at a time
  is the tested path on both platforms until the scheduler layer exists.
- **Freehand *drawing* input.** Freehand *clips* render (they are SVG path data). The
  pen-input overlay is UI work for later.
- **Text template `stagger` / `tracking`.** Inert on the web too; nothing to port.
- **Interactive transform overlays on the preview** (drag / resize / rotate handles).
  Selection and property editing go through the timeline and an inspector first; the on-canvas
  gesture overlay is a follow-up.
- **Persistence adapters.** Core ships the seam (`snapshotMediaLibrary`,
  `readProjectDocument`); the mobile package will ship an `expo-file-system` adapter only after
  the import path is stable.
- **Web platform output of the RN package** (react-native-web). Use `@elah/editor` on the web.
- **macOS / tvOS.** Skia v3 runs on macOS; nothing here prevents it, nothing here targets it.

## Target platforms and versions

Verified against the npm registry and vendor docs on 2026-10-06. These are floors for the
*library*; the dev harness in `apps/mobile` pins current versions.

| Requirement | Floor | Why |
|---|---|---|
| React Native | **0.79**, New Architecture on | `react-native-skia` v3 requires it (its docs say 0.79 + New Architecture; its `peerDependencies` say `>=0.78`). Metro resolves `package.json` `exports` by default from 0.82 (RN 0.79), which the `@elah/core/engine` entry relies on. Current release: 0.87.1. |
| React | 19 | Skia v3 peer. RN 0.79+ ships React 19. |
| JS engine | Hermes | Default on both platforms. Proxy (needed by Immer) has been supported since Hermes 0.7 / RN 0.64. |
| Android | API 26+ | `react-native-skia` v3 floor. |
| iOS | Whatever `react-native-skia` 3.x supports | Not stated on its installation page; confirm in RN-P0 and record it here. |
| Expo | SDK 57 (bundles RN 0.86) | The dev harness is an Expo app. The library must also work in a bare RN app; the harness being Expo is a convenience, not a requirement. |
| `react-native-skia` | 3.x (`react-native-skia` on npm; the `@shopify/react-native-skia` name is the 2.x line) | Graphite backend, Paragraph API, offscreen surfaces. Current: 3.0.5. |
| `react-native-reanimated` / `react-native-worklets` | 4.x / 0.7+ | Peers of Skia v3 and of `react-native-audio-api`. Current: 4.7.1. |
| `react-native-gesture-handler` | 2.x (Expo SDK 57 pins ~2.32; 3.x is on npm) | Timeline gestures. The harness uses what `npx expo install` picks. |
| `react-native-audio-api` | 0.13+ | Optional peer; see D5. Current: 0.13.6. |

## Success criteria for the whole effort

The React Native binding is "shipped" when a project authored in the elah.dev playground,
saved as JSON, opens in the `apps/mobile` harness, plays with audio, scrubs frame-accurately,
exports to an MP4 that plays in the device gallery, and that MP4's first, middle and last frames
match the web export of the same project to within codec noise. Everything in
[`04-workstreams.md`](./04-workstreams.md) is in service of that sentence.
