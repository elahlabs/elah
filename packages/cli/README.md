# @elah/cli

Headless command-line runtime for the Elah video engine. A thin consumer of
`@elah/core`'s public APIs — no rendering or timeline logic lives here.

[![npm](https://img.shields.io/npm/v/@elah/cli)](https://www.npmjs.com/package/@elah/cli)
[![node](https://img.shields.io/node/v/@elah/cli)](https://www.npmjs.com/package/@elah/cli)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/elahlabs/elah/blob/main/LICENSE)

---

## Install

```bash
npm install -g @elah/cli
```

Or without installing, via `npx @elah/cli <command>`. Requires Node >= 18.17. The published 0.1.2 depends on `@elah/core@^0.6.0`; the next release depends on `@elah/core@^1.0.0` and exports version 5 projects (adjustment, generator, compound and sequence clips, the nine transitions). That release is not out yet: until then, use `0.1.2` with 0.6.x projects.
`export`/`build --export`/`serve` additionally require a system Google Chrome
(or `--browser <path>` / `ELAH_BROWSER`) — see [Serve mode](#serve-mode) and
[Docker](#docker) for headless environments. Installing **ffmpeg 4.4+** is
recommended (`brew install ffmpeg`, `apt install ffmpeg`, `winget install ffmpeg`):
when the CLI finds it, ffmpeg encodes the MP4 — see [Encoding](#encoding-ffmpeg-or-chrome).

---

## Commands

```
elah split  --project <in.json> --clip <clipId> --at <frame|timecode> [--out <out.json>]
elah trim   --project <in.json> --clip <clipId> [--start <frame|timecode>] [--duration <frames|timecode>] [--out <out.json>]
elah export --project <in.json> --out <file.mp4|file.webm> [--container mp4|webm]
            [--codec avc|hevc|av1|vp9|vp8] [--height <N>] [--video-bitrate <bps>] [--audio-bitrate <bps>]
            [--encoder auto|ffmpeg|chrome] [--ffmpeg <path>] [--browser <path>] [--headed] [--timeout <s>]
elah build  --spec <spec.json> [--out <project.json>] [--export <file.mp4|file.webm>] [export options]
elah serve  [--port <n>] [--host <addr>] [--concurrency <n>] [--media-root <dir>]
            [--container mp4|webm] [--codec avc|hevc|av1|vp9|vp8] [--height <N>] [--video-bitrate <bps>]
            [--audio-bitrate <bps>] [--encoder auto|ffmpeg|chrome] [--ffmpeg <path>] [--browser <path>]
            [--timeout <s>] [--verbose]
```

### Containers and codecs

The container is `--container`, else the output file's extension (`.webm` → WebM, `.mp4`/`.m4v`
→ MP4), else MP4; `serve` uses `--container` (default MP4) and labels its responses to match.
Codecs follow `@elah/core`'s own matrix, so the CLI rejects (exit `2`) exactly what the Editor's
exporter would:

| Container | `--codec` | Audio |
| --- | --- | --- |
| MP4 | `avc` (default), `hevc`, `av1` | AAC |
| WebM | `vp9` (default), `vp8`, `av1` | Opus |

`--codec vp9 --out clip.mp4` is an error that points you at `.webm`. With the Chrome encoder,
`hevc` and `av1` also need Chrome's encoder for them on your machine; core reports it when it
is missing.

`--height` is the target for the stage's **short** edge (`1080` = 1920×1080 landscape or
1080×1920 portrait); the other edge follows the stage's aspect ratio, rounded to an even number.

`split`, `trim` and `build` run in plain Node against the engine. `export`
launches the system Google Chrome headlessly (or `--browser <path>` /
`ELAH_BROWSER`) and runs core's real `exportVideo` pipeline in it, so CLI
frames are identical to Editor frames by construction. Exit codes: `0` success,
`1` validation/runtime failure, `2` usage error. Diagnostics go to stderr;
`split`/`trim` print the resulting project JSON to stdout unless `--out` is given.

### Encoding: ffmpeg or Chrome

Chrome always draws the frames, so the picture matches the Editor either way. What changes
is who compresses them into the file:

| `--encoder` | Behaviour |
| --- | --- |
| `auto` (default) | ffmpeg when it is found and can write the codec; otherwise Chrome's WebCodecs encoder, with one `encoding with Chrome instead of ffmpeg: …` warning saying why. |
| `ffmpeg` | ffmpeg or fail. |
| `chrome` | Chrome's encoder; ffmpeg is never looked up. |

ffmpeg is found through `--ffmpeg <path>`, then `ELAH_FFMPEG`, then `ffmpeg` on `PATH`, and must
be 4.4 or newer. It is a system binary, never an npm dependency (no GPL code in your install,
and your platform's build keeps its hardware encoders). With ffmpeg, `avc` uses `libx264`,
`hevc` `libx265` (tagged `hvc1` for Apple players), `av1` `libsvtav1` or else `libaom-av1`,
`vp9` `libvpx-vp9` and `vp8` `libvpx`, at the same 8 Mbps / 128 kbps defaults as Chrome; audio
is `aac` in MP4 and `libopus` (at 48 kHz) in WebM. If the ffmpeg build lacks the encoder,
`auto` falls back to Chrome. The audio is core's own mix (the one the Editor plays). The output
is tagged BT.709, limited range, like Chrome's.

The finished line says which encoder ran: `wrote out.mp4 (5297250 bytes, encoded by ffmpeg (libx264))`.

Today the ffmpeg path is slower than Chrome's encoder (8.8 s against 3.5 s for 5 s of 1080p30
on the machine it was measured on): each frame is compressed to PNG in the page before ffmpeg
sees it. ffmpeg's own encode was 1.3 s of that.

### Sources Chrome cannot decode

Before an export, the CLI asks the browser it is about to use whether it can decode each video
and audio source, using the exact stream (WebCodecs `isConfigSupported` on the track's decoder
config). When it cannot, and ffmpeg is installed, the source is converted first:

| Source | Why Chrome fails | What ffmpeg does |
| --- | --- | --- |
| ProRes `.mov` | no ProRes decoder | re-encodes the video, converts PCM audio to AAC |
| HEVC, where Chrome has no HEVC decoder (most Linux, Chromium) | no decoder | re-encodes the video, copies AAC |
| AVI, WMV, FLV | container cannot be read | re-encodes everything |
| `.mkv` with AC-3/DTS audio | no audio decoder | copies the video, converts the audio |
| MPEG-TS (`.ts`) | Web Audio cannot read the container | remuxes (no re-encode) |

```
footage.mov: Chrome cannot decode prores video; converting to H.264/AAC MP4 with ffmpeg
footage.mov: converted in 0.3s
```

The converted copy is H.264/AAC MP4 (`libx264 -crf 14`, a near-lossless scratch file), or
VP9/Opus WebM for a browser without H.264. Frame timing is passed through untouched, and every
stream is shifted so the first video frame is at 0 (MPEG-TS often starts at ~1.4 s). Copies live
in a temporary directory until the export (or `elah serve`) ends; `serve` converts each source
once. `build` also reads AVI/WMV/FLV durations through ffmpeg.

Without ffmpeg, the CLI warns and hands the source to Chrome as before (an undecodable video
fails the export; undecodable audio exports as silence). Not handled: HDR sources are converted
to 8-bit SDR without tone mapping, and an alpha channel (ProRes 4444) is dropped.

---

## The build spec — the AI-generation contract

`elah build` consumes a seconds-based spec, probes each media asset's real
duration, and constructs the project through `TimelineEngine`, so overlaps
and source bounds are validated with precise, path-addressed
errors (`clips[2].duration must be …`) that a generating model can self-correct
from.

```json
{
  "fps": 30,
  "stage": { "width": 1920, "height": 1080 },
  "assets": {
    "footage": "./media/clip.mp4",
    "music": "./media/song.mp3",
    "logo": "./media/logo.png"
  },
  "clips": [
    { "track": "video", "asset": "footage", "start": 0, "duration": 8, "sourceStart": 2, "volume": 0.8 },
    { "track": "text",  "text": "Hello", "start": 0.5, "duration": 4,
      "fontSize": 96, "color": "#ffffff", "fontFamily": "Arial", "fontWeight": "bold",
      "align": "center", "x": 0.5, "y": 0.15 },
    { "track": "image", "asset": "logo", "start": 1, "duration": 6, "x": 0.9, "y": 0.1, "scale": 0.3, "opacity": 0.8 },
    { "track": "audio", "asset": "music", "start": 0, "duration": 8, "volume": 0.5 }
  ]
}
```

Rules:

- **Times are seconds** (floats fine), converted to integer frames at `fps`
  (default 30; rounding to nearest frame). `stage` defaults to 1920×1080.
- **`assets`** maps names to paths relative to the spec file, or `http(s)` URLs.
  Duplicate keys follow JSON semantics (last one wins) — avoid them.
- **video/audio** clips: `duration` defaults to the media's remainder after
  `sourceStart`; exceeding it is an error (with a one-frame rounding tolerance,
  which clamps). The real media length is recorded as
  the clip's source bounds so later `trim`/`split` behave correctly.
- **text** clips need `text` + `duration`; **image** clips need `duration`.
- **`x`/`y`** are the normalized (0..1) stage position of the clip's center;
  `scale` is relative to native size.
- **Overlaps**: every spec video clip is placed on **one** video track, so overlapping
  video clips are a **spec error** — the build fails, naming the clips. (Since 0.1.2; the engine
  itself allows several video tracks, but the spec has no way to say which one a clip belongs
  to.) Overlapping text, image and audio clips are automatically placed on additional
  tracks. Note: a clip bumped to a later track renders *beneath* the one it
  overlaps — list the clip you want on top first.
- Unknown or misspelled fields are rejected by name.

Then: `elah build --spec spec.json --export final.mp4` (add `--out project.json`
to keep the editable project; export options like `--height` pass through).

---

## Library API

`@elah/cli` is also importable — no shelling out, no stderr parsing:

```ts
import { build, exportProject } from '@elah/cli'

const { project } = await build({ spec: mySpecObject, baseDir: '/path/to/assets' })

const { bytes } = await exportProject(
  { project, outPath: 'out.mp4' },
  { onProgress: ({ frame, totalFrames }) => console.log(`${frame}/${totalFrames}`) }
)
```

For repeated renders, `createRenderSession()` keeps a browser warm across
calls instead of launching Chrome per export — this is what `elah serve`
uses internally:

```ts
import { createRenderSession } from '@elah/cli'

const session = createRenderSession()
await session.warmup()
const mp4 = await session.render(project, '/path/to/assets')
// ... more session.render() calls reuse the same browser ...
await session.close()
```

Errors throw `CliError` (aliased `ElahError`) with a `.message` that is
already the human-readable, path-addressed text (`clips[2].duration must be …`).

Also exported: `validateSpec` / `specToProject` (the spec layer on its own), `probeMedia`,
`startServe` (the `elah serve` server, with `Semaphore`), `CODECS`, and the types `BuildSpec`,
`SpecClip`, `RenderSession`, `RenderJobOptions`, `ProgressPayload`, `ServeOptions` and `Project`.
`exportProject` and `session.render` take `outputHeight` (short edge), `videoCodec`,
`videoBitrate`, `audioBitrate` and `timeoutMs`.

---

## Serve mode

`elah serve` runs a long-lived HTTP render server with a warm browser, so
each request only pays for a new browser tab instead of a fresh Chrome
process:

```sh
elah serve --port 8080 --concurrency 2 --media-root ./assets
```

| Route | Behavior |
|---|---|
| `GET /healthz` | `200 { status, browser: "connected" \| "disconnected" }` |
| `POST /render` | body = a build spec JSON document; blocks until the render finishes and returns the MP4 bytes. `422` on spec/asset validation errors, `503` + `Retry-After` when at capacity (`--concurrency`), `500` on render failure. |

```sh
curl -X POST --data-binary @spec.json http://127.0.0.1:8080/render -o out.mp4
```

There is no job queue — this is a synchronous, retry-on-503 contract. See
[docs/deploy-render-server.md](../../docs/deploy-render-server.md) for the
full contract, security notes, and deployment options.

---

## Docker

A Dockerfile that installs branded Chrome + fonts and runs `elah serve` is at
[`Dockerfile`](./Dockerfile) (build from the repo root — see
[docs/deploy-render-server.md](../../docs/deploy-render-server.md)).

---

## Validation tooling

- `ELAH_E2E=1 npm test --workspace=packages/cli` additionally runs a browser
  end-to-end test (exports the no-media fixture through headless Chrome and
  probes the MP4). Add `ELAH_FFMPEG=<path-to-ffmpeg>` to also run the ffmpeg
  encoder suites (they generate their own test media with that ffmpeg).
- `node packages/cli/scripts/parity-compare.mjs <editor.mp4> <cli.mp4>` compares
  an editor UI export against a CLI export of the same project (export it with
  `--encoder chrome`: the ffmpeg encoder draws the same frames but compresses
  them differently, so its hashes never match the Editor's): stream params,
  decoded-video hashes (expected bit-identical), and the audio null-test
  residual (−91 dB = digital silence; a small residual is a systematic
  editor-page vs harness-page environment delta in the AAC encode stage —
  both pipelines are individually deterministic).

See `elah --help` for the full flag list.

---

## Package layers

```
@elah/core      — engine, playback, resolver, vanilla stores, media, export (framework-agnostic)
@elah/react     — React bindings: EditorContext, store hooks, audio hooks
@elah/timeline  — React timeline UI components and hooks
@elah/editor    — EditorProvider, Preview, AssetPanel + re-exports everything above
@elah/cli       — headless split/trim/build/export/serve on top of @elah/core (this package)
```

`@elah/cli` depends only on `@elah/core` — it never touches `@elah/react`,
`@elah/timeline`, or React at all, so it has no peer dependencies on React or
`lucide-react`.

Use `@elah/cli` for automation, AI-generation pipelines, and server-side rendering.
Use `@elah/editor` when you need an interactive, in-browser editing UI.

---

## Links

- [Website](https://www.elah.dev)
- [GitHub](https://github.com/elahlabs/elah)
- [Engine — @elah/core](https://www.npmjs.com/package/@elah/core)
- [React bindings — @elah/react](https://www.npmjs.com/package/@elah/react)
- [React timeline UI — @elah/timeline](https://www.npmjs.com/package/@elah/timeline)
- [Full editor SDK — @elah/editor](https://www.npmjs.com/package/@elah/editor)
- [License](https://github.com/elahlabs/elah/blob/main/LICENSE)
- [Commercial licensing](mailto:paul@elah.dev)
