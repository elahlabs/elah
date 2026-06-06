# @myeditor/playground

Development sandbox for `@elah/editor`. Runs the full GPU pipeline (WebGL2 +
WebCodecs via mediabunny) in a real browser. Use it for manual smoke tests,
visual regression comparisons, and Playwright E2E validation.

---

## Quickstart

```bash
# From the workspace root (npm workspaces)
npm install    # installs all workspace dependencies, including mediabunny
npm run dev    # runs the playground via the root script → http://localhost:5173
```

Or from this directory specifically:

```bash
npm run dev    # vite dev server
```

---

## Importing and playing a video

1. **Open** `http://localhost:5173` in Chromium or Firefox.
2. **Import** a video: click **+ Add** in the Media panel (top-left) and pick an
   MP4 or WebM file.
3. **Add a video track**: click **+ Video Track** in the toolbar.
4. **Drop the asset** from the Media panel onto the video track in the timeline.
5. **Scrub** the playhead or press **▶ Play**.
6. The **GPU Preview** panel renders decoded frames via WebGL2.

### What happens under the hood

1. `importFiles()` creates an object URL and registers a `MediaAsset` in
   `useMediaLibraryStore`.
2. Dragging the asset onto the timeline calls `addClip({ src: objectUrl })`.
3. `resolveTimeline` emits an `ActiveVideoClip` with the object URL.
4. `GpuPreview` passes `demuxerFactory: createPlaygroundDemuxerFactory()` to
   `GpuRenderer`. The factory selects a `StreamingFrameProducer` (push-based,
   mediabunny-backed) for that `src`.
5. On the first render tick for a new clip, `VideoLayer` calls `setPlayhead(N)`
   (fire-and-forget) and `getCurrent(N)` returns `null` (cache miss). The push
   pipeline runs out-of-band:
   - mediabunny opens the object URL → `Input + BlobSource`
   - seeks to the nearest keyframe, feeds a lookahead window of packets
   - `VideoDecoder` decodes → each `VideoFrame` is copied to an `ImageBitmap`,
     the frame is closed, and the bitmap lands in `FrameCache`
6. On a later tick (~1–3 ticks), `getCurrent(N)` hits, and the frame is uploaded
   to a WebGL texture and drawn.

---

## Debug panel

The GPU Preview has a green debug overlay (top-right of the canvas). Fields:

| Field | Meaning |
|---|---|
| FPS | Renderer framerate (RAF-measured) |
| Frame | Current playback frame |
| Clips | Active video clips in the scene |
| Textures | Live GL texture handles |
| Cache hit | % of render ticks that found a decoded frame |
| Render | GPU draw call duration (ms) |
| Dropped | Frames dropped due to decode errors |
| Outstanding | In-flight decode requests |
| Active providers | Unique src providers alive |
| Decoders | Per-provider decoder state |

The overlay is visible when `debugMode` is `true` (default in the playground).

---

## Query-string flags

| Flag | Effect |
|---|---|
| `?lab` | Show `MediaLimitsLab` (stress test panel) |
| `?debug` | Show raw JSON of the resolved `Scene` beneath the timeline |

Example: `http://localhost:5173?debug`

---

## E2E tests (Playwright)

```bash
npm run test:e2e          # headless Chromium
PW_HEADED=1 npm run test:e2e  # headed (watch the test run)
```

Tests live in `e2e/realPlayback.spec.ts`. They import the fixture MP4, add it
to the timeline, seek to frame 15, and assert that the SHA-256 hash of
`gl.readPixels` output is stable across 3 runs and after a WebGL context loss.

### Fixture MP4

The test fixture is committed at `e2e/fixtures/sample-h264-320x240-1s.mp4`.
To regenerate it (e.g. after changing the expected video content):

```bash
npm run fixture:gen
```

This runs `scripts/generateFixture.ts` via `tsx`. It tries `ffmpeg` first, then
falls back to downloading a public-domain test vector. After regenerating,
re-run the Playwright test once to see the new golden hash, then update
`GOLDEN_HEX` in `e2e/realPlayback.spec.ts`.

### Updating golden hashes

```bash
PW_HEADED=1 npm run test:e2e 2>&1 | grep "Frame hashes"
# Copy the hash → update GOLDEN_HEX in e2e/realPlayback.spec.ts
```

---

## Architecture notes

- **`createPlaygroundDemuxerFactory.ts`** — the only file that statically
  imports `mediabunny`. Keeps the editor SDK (`@elah/editor`) free of the
  dependency.
- **`window.__GPU__`** — dev-only handle exposing `readCanvas(): Promise<string>`
  for Playwright pixel reads. Removed in prod builds (`import.meta.env.DEV`).
- **`GpuPreview.tsx`** — thin React shell. Owns the RAF loop, resolves the scene
  each tick imperatively, calls `renderer.render(scene)`. No React re-renders at
  60 Hz.

See `packages/editor/src/core/renderer/gpu/IMPLEMENTATION_NOTES.md` for
deeper architectural rationale.
