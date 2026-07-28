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

Or without installing, via `npx @elah/cli <command>`. Requires Node >= 18.17.
`export`/`build --export`/`serve` additionally require a system Google Chrome
(or `--browser <path>` / `ELAH_BROWSER`) — see [Serve mode](#serve-mode) and
[Docker](#docker) for headless environments.

---

## Commands

```
elah split  --project <in.json> --clip <clipId> --at <frame|timecode> [--out <out.json>]
elah trim   --project <in.json> --clip <clipId> [--start <frame|timecode>] [--duration <frames|timecode>] [--out <out.json>]
elah export --project <in.json> --out <file.mp4> [--codec avc|vp9|vp8] [--height <N>]
elah build  --spec <spec.json> [--out <project.json>] [--export <file.mp4>]
elah serve  [--port <n>] [--host <addr>] [--concurrency <n>] [--media-root <dir>]
```

`split`, `trim` and `build` run in plain Node against the engine. `export`
launches the system Google Chrome headlessly (or `--browser <path>` /
`ELAH_BROWSER`) and runs core's real `exportVideo` pipeline in it, so CLI
output is identical to Editor output by construction. Exit codes: `0` success,
`1` validation/runtime failure, `2` usage error. Diagnostics go to stderr;
`split`/`trim` print the resulting project JSON to stdout unless `--out` is given.

---

## The build spec — the AI-generation contract

`elah build` consumes a seconds-based spec, probes each media asset's real
duration, and constructs the project through `TimelineEngine`, so overlaps,
track caps and source bounds are all validated with precise, path-addressed
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
- **Overlaps**: video clips must not overlap (single video track, engine-enforced);
  overlapping text/image/audio clips are automatically placed on additional
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
  probes the MP4).
- `node packages/cli/scripts/parity-compare.mjs <editor.mp4> <cli.mp4>` compares
  an editor UI export against a CLI export of the same project: stream params,
  decoded-video hashes (expected bit-identical), and the audio null-test
  residual (−91 dB = digital silence; a small residual is a systematic
  editor-page vs harness-page environment delta in the AAC encode stage —
  both pipelines are individually deterministic).

Full documentation lands with the release phase; see `elah --help`.

---

## Package layers

```
@elah/core      — engine, playback, resolver, stores, media, export (framework-agnostic)
@elah/timeline  — React timeline UI components and hooks
@elah/editor    — EditorProvider, Preview, AssetPanel + re-exports everything above
@elah/cli       — headless split/trim/build/export/serve on top of @elah/core (this package)
```

Use `@elah/cli` for automation, AI-generation pipelines, and server-side rendering.
Use `@elah/editor` when you need an interactive, in-browser editing UI.

---

## Links

- [Website](https://www.elah.dev)
- [GitHub](https://github.com/elahlabs/elah)
- [Engine — @elah/core](https://www.npmjs.com/package/@elah/core)
- [React timeline UI — @elah/timeline](https://www.npmjs.com/package/@elah/timeline)
- [Full editor SDK — @elah/editor](https://www.npmjs.com/package/@elah/editor)
- [License](https://github.com/elahlabs/elah/blob/main/LICENSE)
- [Commercial licensing](mailto:paul@elah.dev)
