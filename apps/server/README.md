# @elah/server

A Node.js example harness that exercises `@elah/cli` against the local assets
in `assets/` (`scene-1.mp4` … `scene-5.mp4`, `audio.mp3`, `logo-single.png`).
Three ways to run it: a one-shot render, a minimal `/render` demo server, and
a Postman-friendly `/api/render` API.

## Setup

From the repo root:

```sh
npm install
npm run build:packages
```

`@elah/cli` is consumed via its published `exports` (`dist/`), so the
workspace packages must be built before either script below will resolve it.

## One-shot render

```sh
npm run render --workspace=apps/server
```

Probes each scene's real duration, assembles a demo timeline (5 scenes back
to back, a title card, a watermark logo, and a music bed), and renders it to
`apps/server/output/example.mp4`. See `src/example-spec.ts` for the spec.

## Serve mode

```sh
npm run serve --workspace=apps/server
```

Starts a warm-browser render server on `http://127.0.0.1:8080` with
`assets/` as the media root. `POST` a build spec (seconds-based JSON — see
`packages/cli/README.md` for the full format) and get back MP4 bytes:

```sh
curl -X POST --data-binary @spec.json http://127.0.0.1:8080/render -o out.mp4
```

A minimal spec against these assets:

```json
{
  "fps": 30,
  "stage": { "width": 1920, "height": 1080 },
  "assets": { "scene": "./scene-1.mp4", "music": "./audio.mp3" },
  "clips": [
    { "track": "video", "asset": "scene", "start": 0, "duration": 4 },
    { "track": "audio", "asset": "music", "start": 0, "duration": 4, "volume": 0.5 }
  ]
}
```

## Next step

This is the harness the Claude API integration will drive next — generating
the spec JSON, TTS voice-over audio, and subtitle text clips, then POSTing
the result to `/render`.
