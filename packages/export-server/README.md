# @elah/export-server

Node-only, browser-free video export for the [Elah](https://www.elah.dev) engine.

Elah's normal export path runs on WebCodecs, which only exists in a browser — server-side
export today means launching headless Chrome. This package renders the same project without
a browser at all: it resolves the project into the exact same `Scene` the editor's renderer
consumes, then draws and encodes it with system [ffmpeg](https://ffmpeg.org/) instead of
WebCodecs. Same brain, different codec I/O.

## Requirements

ffmpeg must already be installed on the machine running the export — it is invoked as a
system binary, never bundled or vendored. This keeps the package small, keeps it clear of
ffmpeg's GPL licensing, and preserves access to hardware encoders (`h264_videotoolbox`,
`h264_nvenc`, `h264_qsv`) that a vendored static build would not have.

Check that it's installed and discoverable:

```bash
which ffmpeg
ffmpeg -encoders
```

`ffmpeg -encoders` should list the encoder you intend to use (e.g. `libx264`,
`h264_videotoolbox`). The binary is located via, in order: an explicit path passed to the
export call, the `ELAH_FFMPEG` environment variable, then `ffmpeg` on `PATH`.

## Design principle

This package is another *consumer of the resolver*, not a second renderer. It calls the same
pure `resolveTimeline` and the same placement helpers (`resolveDrawRect`, `computeTextLayout`)
that the browser exporter uses, so its output matches the editor frame-for-frame. It never
imports `Project` or `Clip` internals — only the resolved `Scene` — which is what keeps this
package swappable: change the codec I/O, keep the brain.
