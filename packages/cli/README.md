# @elah/cli

Headless command-line runtime for the Elah video engine. A thin consumer of
`@elah/core`'s public APIs — no rendering or timeline logic lives here.

```
elah split  --project <in.json> --clip <clipId> --at <frame|timecode> [--out <out.json>]
elah trim   --project <in.json> --clip <clipId> [--start <frame>] [--duration <frames>] [--out <out.json>]
elah export --project <in.json> --out <file.mp4> [--codec avc|vp9|vp8] [--height <N>]
```

`split` and `trim` run in plain Node against the engine. `export` launches the
system Google Chrome headlessly and runs core's real `exportVideo` pipeline in
it, so CLI output is identical to Editor output by construction.

Full documentation lands with the release phase; for now see the source and
`elah --help`.
