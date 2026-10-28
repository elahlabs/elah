# elah

## Write motion as code. It stays editable.

**Open source. Renders in the browser.** New in 1.0: the motion layer.

[![npm](https://img.shields.io/npm/v/@elah/editor?label=%40elah%2Feditor)](https://www.npmjs.com/package/@elah/editor)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![types](https://img.shields.io/npm/types/@elah/editor)](https://www.npmjs.com/package/@elah/editor)

[**Website**](https://www.elah.dev) · [**Docs**](https://www.elah.dev/docs) · [**Playgrounds**](https://www.elah.dev/playgrounds) · [**elah for Claude**](https://www.elah.dev/claude) · [**Changelog**](https://www.elah.dev/changelog) · [**Discord**](https://discord.gg/qKJXvc4Pwu)

![A video made by Claude, playing in the elah artifact: preview and timeline, then Edit with the properties panel, tracks and keyframes](./docs/demo.gif)

*Program · a video Claude wrote, playing on the engine. Preview, then Edit: clips, keys and the properties panel. Export MP4 runs in the same browser tab. [Watch the full clip](./docs/demo.mp4).*

> **elah 1.0 is out: the motion and programmatic layer.** [Read the changelog →](https://www.elah.dev/changelog)

You write motion as code, or a model does, and elah converts it into ordinary clips and keyframes on a timeline. You can open it, change any key, and export an MP4 in the browser: no upload, no account, no key. Any aspect ratio.

| 01 · GitHub stars | 02 · npm downloads | 03 · Packages · Apache-2.0 | 04 · Release |
|---|---|---|---|
| [![stars](https://img.shields.io/github/stars/elahlabs/elah?style=for-the-badge&label=&color=0e0e10)](https://github.com/elahlabs/elah) | [![downloads](https://img.shields.io/npm/dm/@elah/core?style=for-the-badge&label=&color=0e0e10)](https://www.npmjs.com/package/@elah/core) | **5** | [![version](https://img.shields.io/npm/v/@elah/editor?style=for-the-badge&label=&color=0e0e10)](https://www.npmjs.com/package/@elah/editor) |

| You want to… | Use | Live |
|---|---|---|
| Put a video editor in your product | `@elah/editor` | [playground/production](https://www.elah.dev/playground/production) |
| Just the timeline UI | `@elah/timeline` | [playground/timeline](https://www.elah.dev/playground/timeline) |
| Generate video from code or an AI | `@elah/core/spec`, `@elah/core/html` | [playground/motion](https://www.elah.dev/playground/motion) · [samples](./artifact/samples) |
| Render on a server or in CI | `@elah/cli` | — |
| Make a video by chatting with Claude | [the Claude Code plugin](./plugins/elah) | [elah.dev/claude](https://www.elah.dev/claude) |

All of them produce the **same `Project` document**, so a video an AI generates opens in the timeline with real keyframes and can be edited by hand.

---

`SC 01 · WRITE` · *Write · Timeline · Export*

## Write it like a web page, edit it like a timeline, render it in the browser.

**1 · write** — the motion lives in a `data-motion` attribute:

```html
<section id="tc" data-scene="title-card" data-at="0" data-duration="4">
  <div id="bar" data-motion="in: slide-in-left 0.5s @0.1"></div>
  <h1 id="title" data-motion="split: word 3f; each: y: 0.5 -> 0 0.5s quad-out; each: opacity: 0 -> 1 0.5s quad-out">Quarterly results</h1>
  <p id="sub" data-motion="in: fade-in 0.6s @0.9">Revenue up 24 percent on the year</p>
</section>
```

**2 · timeline** — it lands as native clips and keyframes. Each key has an id, a frame, a value and an easing.

**3 · export** — MP4 export runs on your own machine in Chrome or Edge. No render server, and nothing is uploaded.

Two ways to write it, both landing as the same project:

**HTML/CSS scenes** (`@elah/core/html`) — author in ordinary HTML and CSS animation, convert to native clips and keys:

```ts
import { validateScene, sceneToClip } from '@elah/core/html'

validateScene({ html, css })            // refusals name the supported substitute
sceneToClip(measuredScene, { fps: 30 }) // → one compound clip of real keys
```

**VideoSpec** (`@elah/core/spec`) — seconds-based JSON aimed at models. Problems come back as path-addressed issues instead of throwing, so a generator can correct itself:

```ts
import { buildVideo } from '@elah/core/spec'

const { project, issues } = buildVideo({
  version: 1,
  format: { width: 1920, height: 1080, fps: 30 },
  duration: 6,
  design: { colors: [{ name: 'bg', value: '#0b1020' }, { name: 'ink', value: '#ffffff' }] },
  background: '$bg',
  elements: [
    { id: 'title', kind: 'text', at: 0, duration: 3, text: 'Ship it', font: '$sans', enter: 'blur-in' },
  ],
})
// issues: [{ path: 'elements[0].font', message: '…' }] — never a throw
```

It expands 17 motion components and 6 motion systems. Real inputs to read: [`artifact/samples/`](./artifact/samples) (launch, data story, logo, title card, camera moves, sound cues).

**`layProject(project, engine)`** drops either onto a live editor as a single undo step. **`@elah/core/ops`** gives an agent 57 typed ops to edit an existing project instead.

These sit on their own subpath entries, off the `@elah/core` root, so an app that never imports them **pays zero bytes** ([`BUNDLE_STRATEGY.md`](./BUNDLE_STRATEGY.md)).

---

`SC 02 · BIND` · *Keys, not pixels*

## The motion is bound to the timeline.

Code, or a model, describes the motion, and elah lands it as keyframes: not a video, not a black-box layer. Every animated property is a channel on a clip, so it can be inspected, retimed, split and diffed like any other data.

```ts
clip.keyframes = {
  channels: {
    opacity: { source: { kind: 'keyframes' }, keys: [
      { id: 'o0', frame: 0,  value: 0, easing: 'cubic-out' },
      { id: 'o1', frame: 10, value: 1, easing: 'linear' },
    ] },
    x: { source: { kind: 'keyframes' }, keys: [/* … */] },
  },
}
```

---

`SC 03 · KEYS` · *Rendered live on the site*

## Everything is a key you can read.

| | What | One line |
|---|---|---|
| **Easing and springs** | Named eases including back, elastic and bounce, any cubic-bezier, and springs. | `{ channel: 'x', at: 1.4, value: 0.85, curve: 'back-out' }` |
| **Stagger** | From the start, centre, end or edges, at random, or across a grid. | `stagger: children 4f` |
| **Text animators** | Animate by character, word or line, or scramble text into place. | `reveal: { preset: 'char-rise', stagger: 0.04 }` |
| **Motion paths and draw-on** | A clip travels an SVG path, and strokes draw on. Path morph is keyable too. | `motionPath: { d: 'M 80 270 C 200 40, 440 40, 560 270' }` |
| **Expressions** | Drive a channel with wiggle, loop, sin and more. | `{ channel: 'y', source: 'wiggle(3, 0.06)' }` |
| **3D tilt for media and groups** | `rotateX` and `rotateY` with perspective, on video, image, sequence and compound clips. | `channels: { rotateY: { keys: [{ frame: 45, value: 0.6 }] } }` |
| **Effects and transitions** | GPU effects and nine transitions, between clips of one track. | `effects: [{ kind: 'glow' }]  // + a zoom transition` |

Every transform channel is keyframeable, with the full ease set (sine through bounce, `steps(n)`, cubic-bezier) and closed-form springs, plus hold keys, 36 ready presets, repeat/yoyo and skew. [See the loops running](https://www.elah.dev/#capabilities).

**Transitions** — 9 kinds, one shader, identical in preview and export:

```
fade · slide · wipe · zoom · spin · whip · glitchCut · warpDissolve · lumaWipe
```

**23 GPU effects** in one WebGL2 pipeline shared by preview and export:

```
colorGrade · gaussianBlur · vignette · grain · rgbSplit · letterbox · chromaticAberration
scanlines · bloom · glow · flash · strobe · lightRays · wave · twirl · bulge · fisheye
displace · vhs · crt · pixelate · glitchBlocks · motionBlur
```

**8 generators** that draw their own picture from params and time:

```
particles · energyLines · lightLeak · lensFlare · gradientBackground · counter · barChart · progressBar
```

**Clip types**: `video`, `audio`, `text`, `image`, `shape`, `freehand`, `adjustment`, `generator`, `compound` (a nested project as one clip) and `sequence` (animated image or numbered frames). Plus masks, track mattes, blend modes, per-clip audio (mute, boost, fades, noise reduction), and **Lottie & SVG import** that produces editable clips and keys.

---

`SC 04 · CLAUDE` · *Claude Code · claude.ai*

## Make a video from Claude Code.

| | Status | What it is |
|---|---|---|
| **Claude Code plugin** | Available | Claude writes the video as HTML + CSS motion, the plugin validates it with the elah engine, and an artifact opens it for preview, editing and MP4 export. The plugin never renders a video itself. |
| **claude.ai artifact** | Available | Ask Claude for a video in a chat, see it on a timeline, and export the MP4 in your own browser. No server, nothing uploaded. |

```
/plugin marketplace add elahlabs/elah
/plugin install elah@elah
```

| Skill | Run | What it does |
|---|---|---|
| `motion` | `/elah:motion a 20 second explainer on how DNS works` | Every kind of video: launch, explainer, data story, recap, words in motion, logo sting, vertical social. Asks one round of questions, plans the beats, writes it, validates it, publishes the artifact. |
| `brand` | `/elah:brand #1e90ff` | Saves a brand kit (palette, fonts, look, logo) that every later video in that folder uses. |
| `revise` | `/elah:revise make it 10 seconds and Poster Shout` | Reopens the last video, changes it as asked, keeps your edits, updates the same artifact link. |
| `saas` | `/elah:saas a podcast clip editor for agencies` | Scaffolds your own editor app on the `@elah/*` packages — a real Vite or Next.js project you own. |

In the artifact: Preview, Edit (keyframes and curves), Export MP4, and Download project. Run `/reload-plugins` if the skills do not show up. See [`plugins/elah`](./plugins/elah).

An unofficial, open-source plugin from the elah project. Not made or endorsed by Anthropic.

---

`SC 05 · PLAYGROUNDS` · *Running in your browser*

## Try it before you install.

| | Status | What it is |
|---|---|---|
| [Motion](https://www.elah.dev/playground/motion) | Preview | Write a scene as HTML and CSS, convert it to clips and keyframes, read the keys in a table, and export an MP4 in your browser. |
| [Full Editor](https://www.elah.dev/playground/production) | Live | Complete editor with asset panel, GPU-accelerated preview, interactive overlays, timeline, and export pipeline. The full `@elah/editor` composition. |
| [Timeline Only](https://www.elah.dev/playground/timeline) | Live | Isolated timeline UI demo. Tracks, clips, snapping, keyboard shortcuts, and the `TimelineEngine` without the full editor stack. |
| [Full Editor Demo](https://www.elah.dev/playground/raw) | Preview | Guided demo with pre-loaded sample media: cut, trim, text, transitions and export in a single session. |

---

`SC 06 · LIBRARIES` · *Five packages*

## Choose a library.

Five composable packages. Drop in the whole editor, or take only the layer you need.

| Package | What it is |
|---|---|
| [`@elah/editor`](https://www.npmjs.com/package/@elah/editor) | **Editor SDK.** Full editor — `EditorProvider`, `Preview`, `AssetPanel` and `Timeline` in one composition, and a barrel re-exporting the three below. **Install this one** unless you want less. |
| [`@elah/timeline`](https://www.npmjs.com/package/@elah/timeline) | **Timeline UI.** React timeline — tracks, clips, drag/trim/split, ruler, playhead. |
| [`@elah/react`](https://www.npmjs.com/package/@elah/react) | **React bindings.** `EditorContext`, `useEditor`, store hooks, and the audio mixer hooks. |
| [`@elah/core`](https://www.npmjs.com/package/@elah/core) | **Media runtime.** Framework-agnostic engine: resolver, WebGL2 renderer, WebCodecs decode, MP4 export, and the 1.0 motion layer. No React. |
| [`@elah/cli`](https://www.npmjs.com/package/@elah/cli) | **Headless rendering.** The `elah` command — split/trim/build/export, and an HTTP render server. |

**`@elah/core` subpaths** — live in 1.0, on separate entries so an app that does not import them pays nothing:

| Subpath | What |
|---|---|
| `@elah/core/spec` | VideoSpec JSON to a project |
| `@elah/core/html` | HTML + CSS scenes to clips and keys |
| `@elah/core/ops` | Edit operations an AI can call |
| `@elah/core/icons` | The vendored icon set |

### Install the editor

```bash
npm install @elah/editor lucide-react
```

```tsx
// All three stylesheets — each package compiles its own, so they do not
// contain each other's classes.
import '@elah/timeline/styles.css'
import '@elah/editor/styles.css'
import '@elah/editor/styles/tokens.css'

import { EditorProvider, Preview, Timeline, AssetPanel, createDefaultDemuxerFactory } from '@elah/editor'

const demuxerFactory = createDefaultDemuxerFactory()

export default function App() {
  return (
    <EditorProvider fps={30}>
      <div className="elah-root" style={{ display: 'flex', height: '100vh' }}>
        <AssetPanel style={{ width: 220 }} />
        <Preview demuxerFactory={demuxerFactory} style={{ height: 480 }} />
        <Timeline style={{ height: 300 }} />
      </div>
    </EditorProvider>
  )
}
```

Drag a file into the asset panel, drop it on the timeline, press **Space**. Theming is the `--elah-*` tokens redefined under `.elah-root`.

Edits go through one funnel, `TimelineEngine`, so undo, history and events come free:

```ts
const track = engine.addTrack('video')
engine.addClip({ trackId: track.id, type: 'video', src: '/clip.mp4', startFrame: 0, durationFrames: 90 })
engine.batch(() => { /* several edits, one undo step */ })
```

Runnable apps: [`examples/minimal`](./examples/minimal) (smallest complete editor), [`examples/react`](./examples/react) (Vite), [`examples/next`](./examples/next) (App Router).

### Render headless

```jsonc
// spec.json — seconds, assets by path or URL
{
  "fps": 30,
  "assets": { "footage": "./media/clip.mp4" },
  "clips": [
    { "track": "video", "asset": "footage", "start": 0, "duration": 8 },
    { "track": "text", "text": "Hello", "start": 0.5, "duration": 4, "fontSize": 96 }
  ]
}
```

```bash
npx @elah/cli build --spec spec.json --export final.mp4
elah serve --port 8080          # warm-browser HTTP render server; POST /render → MP4
```

`export` runs core's real `exportVideo` in headless Chrome, so CLI output matches editor output by construction. A [`Dockerfile`](./packages/cli/Dockerfile) with Chrome and fonts ships with the package.

### Versions and peers

Every package above is at **1.0.0** and follows semver — a breaking change needs 2.0. The four UI/engine packages release in lockstep; `@elah/cli` keeps its own version line and `cli-v*` tag. The AI-facing subpaths (`/spec`, `/html`, `/ops`, `/icons`) are live too; they sit off the root so the root stays small. The one exception is `@elah/react-native`, early at 0.x — see [`docs/react-native/`](./docs/react-native/README.md).

Peers: `react`, `react-dom` >= 18; `lucide-react` for the UI packages. Export needs WebCodecs (Chromium).

---

`SC 07 · COMPARE` · *From public docs*

## How elah compares.

| | elah | Remotion | HyperFrames |
|---|---|---|---|
| **Open-source licence** | Apache-2.0 | Remotion License: free for individuals and for-profit organizations up to 3 employees; a Company License is required beyond that | Apache-2.0 |
| **Motion written as code** | Yes: html scenes and VideoSpec | Yes: React components | Yes: html with data attributes |
| **Renders in the browser with no server** | Yes, in Chrome or Edge | Experimental web renderer, a subset of html and css | Renders with headless Chrome and FFmpeg |

Sources: [Remotion license](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md), [Remotion web renderer](https://www.remotion.dev/docs/web-renderer/), [HyperFrames on GitHub](https://github.com/heygen-com/hyperframes). Checked against their public pages; check them for current terms.

---

`SC 08 · ENGINE` · *Frames in, frames out*

## One mutation funnel. One pure resolver.

Time is integer frames, every edit goes through the engine, and renderers only read the resolved scene. Same input, same output.

```
01 · react ui          Timeline · Preview · AssetPanel · TransformOverlay
02 · react bindings    EditorContext · useEditor · store hooks · audio mixer hooks
03 · engine layer      TimelineEngine · PlaybackEngine · AudioPlaybackController
04 · pure resolver     resolveTimeline(frame, project) → Scene
05 · renderers         GpuRenderer (WebGL2) · Video · Image · Text layers · Shape · Freehand layers · ExportWorker (OffscreenCanvas)
06 · media pipeline    StreamingFrameProducer · WebCodecs · mediabunny demux
```

A single immutable `Project` tree owns all timeline data. `TimelineEngine` is the only place mutations happen — every edit is an Immer-backed commit with structural sharing, history, batching and typed events. Time is **integer frames**, never floating-point seconds. A pure `resolveTimeline(frame, project) → Scene` decides what is visible and audible, and is the only thing renderers consume. The shipped renderer is a WebGL2 `GpuRenderer`; video frames come from a push-based WebCodecs pipeline that decodes ahead of the playhead and copies each frame to an `ImageBitmap` so the decoder's output pool never starves. Export reuses the same resolver and the same placement math in a worker, so **preview and export never drift**.

[Read the architecture docs →](https://www.elah.dev/docs/architecture)

---

## Questions

<details>
<summary><b>What is elah?</b></summary>

An open-source video engine. You write motion as code, or a model does, and elah converts it into ordinary clips and keyframes on a timeline. You can open it, change any key, and export an MP4 in the browser. [See how it works](https://www.elah.dev/motion)
</details>

<details>
<summary><b>What does “bound to the timeline” mean?</b></summary>

Every animated property is a channel on a clip, and every key has an id, a frame, a value and an easing. The motion is not a video and not a black box, so it can be inspected, retimed, split and diffed like any other data. [Read the motion docs](https://www.elah.dev/docs/motion)
</details>

<details>
<summary><b>Does elah need a server to export video?</b></summary>

No. Decoding, rendering and MP4 export all run in the browser, and footage is never uploaded. Export needs a Chromium browser (Chrome or Edge), and effects and the six newer transitions need WebGL2. For headless rendering, `@elah/cli` runs the same export pipeline with headless Chrome. [Read about export](https://www.elah.dev/docs/export)
</details>

<details>
<summary><b>Can I edit keyframes visually?</b></summary>

Yes, in 1.0. A selected clip shows its keyframes as diamonds on its bottom edge (`<KeyframeLane>` in `@elah/timeline`): click to seek and select, drag to retime with snapping as one undo step, Shift+click for multi-select. They are plain data too, so you can read, write and diff every key through the API or the project JSON, and the motion playground shows them in a table you can edit as numbers. [Open the motion playground](https://www.elah.dev/playground/motion)
</details>

<details>
<summary><b>Is the exported video identical to the preview?</b></summary>

Yes. Preview and export run the same pure resolver, `resolveTimeline(frame, project) → Scene`, and the same placement math, so the frame you scrub is the frame you ship.
</details>

<details>
<summary><b>Are HTML scenes and VideoSpec stable?</b></summary>

Yes, they are live in 1.0. HTML scenes (`@elah/core/html`), VideoSpec JSON (`@elah/core/spec`) and edit operations (`@elah/core/ops`) have their own subpath entries, so an app that never imports them pays nothing for them. The projects they produce are ordinary projects and stay readable. [Read about scenes and VideoSpec](https://www.elah.dev/docs/scenes)
</details>

<details>
<summary><b>Can Claude or another model make videos with elah?</b></summary>

Yes. The elah plugin for Claude Code turns a short brief into a video: Claude writes it as HTML and CSS motion, the plugin validates it, and an artifact opens it for preview, editing and MP4 export. The standalone claude.ai artifact is live. The plugin is unofficial, not made or endorsed by Anthropic. [See elah for Claude](https://www.elah.dev/claude)
</details>

<details>
<summary><b>Is 1.0 on npm?</b></summary>

Yes. It shipped in 1.0, so `npm install @elah/core` installs it. Keyframes, springs, stagger, motion paths, effects and transitions are in the root entry and follow semver. HTML scenes, VideoSpec and edit operations are live on their own subpath entries. [Read the changelog](https://www.elah.dev/changelog)
</details>

<details>
<summary><b>Is elah open source?</b></summary>

Yes. elah is open source under the Apache-2.0 license, copyright Elah Labs Private Limited. It is free to use, modify, embed, self-host, and ship in commercial products.
</details>

<details>
<summary><b>What export formats does elah support?</b></summary>

MP4 with H.264 video by default (VP9 and VP8 are also available) and AAC or Opus audio, at any aspect ratio, up to the project's native resolution. HEVC, AV1, WebM transparency and GIF depend on what the browser can encode.
</details>

---

`FINAL CUT`

## Write the motion. Keep the timeline.

elah is open source. Let Claude write the video, then edit its keyframes and export an MP4 in your browser.

[**Try the Claude plugin**](https://www.elah.dev/claude) · [**Open a playground**](https://www.elah.dev/playgrounds) · [**Read the docs**](https://www.elah.dev/docs)

## Read next

| | |
|---|---|
| [`docs/ai/ELAH_FOR_AI_AGENTS.md`](./docs/ai/ELAH_FOR_AI_AGENTS.md) | Self-contained SDK guide for AI tools — full API, bundler setup, 12 recipes. No checkout needed. |
| [`AGENTS.md`](./AGENTS.md) | Working inside this repo: layout, commands, the src/dist asymmetry |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | The engine in depth |
| [`docs/STATUS.md`](./docs/STATUS.md) · [`ROADMAP.md`](./ROADMAP.md) · [`CURRENT_LIMITATIONS.md`](./CURRENT_LIMITATIONS.md) | Per-feature status, what is next, known gaps |
| [`BUNDLE_STRATEGY.md`](./BUNDLE_STRATEGY.md) · [`PERFORMANCE.md`](./PERFORMANCE.md) | Measured bundle sizes and performance technique |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | Conventions and the invariants every renderer change must preserve |

The libraries ship **no telemetry**. Questions: [Discord](https://discord.gg/qKJXvc4Pwu) · [issues](https://github.com/elahlabs/elah/issues) · [paul@elah.dev](mailto:paul@elah.dev).

Apache-2.0. Copyright (c) 2026 Elah Labs Private Limited. See [`LICENSE`](./LICENSE).
