# @elah/cli

Headless command-line runtime for the Elah video engine. A thin consumer of
`@elah/core`'s public APIs — no rendering or timeline logic lives here.

```
elah split  --project <in.json> --clip <clipId> --at <frame|timecode> [--out <out.json>]
elah trim   --project <in.json> --clip <clipId> [--start <frame|timecode>] [--duration <frames|timecode>] [--out <out.json>]
elah export --project <in.json> --out <file.mp4> [--codec avc|vp9|vp8] [--height <N>]
elah build  --spec <spec.json> [--out <project.json>] [--export <file.mp4>]
```

`split`, `trim` and `build` run in plain Node against the engine. `export`
launches the system Google Chrome headlessly (or `--browser <path>` /
`ELAH_BROWSER`) and runs core's real `exportVideo` pipeline in it, so CLI
output is identical to Editor output by construction. Exit codes: `0` success,
`1` validation/runtime failure, `2` usage error. Diagnostics go to stderr;
`split`/`trim` print the resulting project JSON to stdout unless `--out` is given.

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
  `sourceStart`; exceeding it is an error. The real media length is recorded as
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

Full documentation lands with the release phase; see `elah --help`.
