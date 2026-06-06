# elah — V1 Stabilization & Launch TODO

> Grounded against the actual codebase (`video-editor/packages/editor/src`).
> Each item notes **what already exists**, **what's actually missing**, the **files to touch**,
> and **done-when** criteria. Ordered by recommended execution sequence, not just by label.

---

## ⚠️ Read first — the one cross-cutting constraint

There are **two independent renderers**, and they must stay pixel-identical:

- **Preview** = WebGL. [`GpuRenderer`](packages/editor/src/core/renderer/gpu/GpuRenderer.ts) with `VideoLayer` / `TextLayer` / `ImageLayer` shaders.
- **Export** = 2D canvas. [`ExportWorker.ts`](packages/editor/src/core/export/ExportWorker.ts) `renderFrame()` draws to an `OffscreenCanvas` 2D context.

They only share geometry/layout helpers ([`drawRect.ts`](packages/editor/src/core/renderer/gpu/layers/drawRect.ts), [`textLayout.ts`](packages/editor/src/core/renderer/gpu/layers/textLayout.ts)) and the resolver ([`resolveTimeline.ts`](packages/editor/src/core/resolver/resolveTimeline.ts)).

**Rule for every visual task below:** if it changes how a pixel lands, it must be implemented (or its math shared) in *both* paths, with a golden-frame test asserting parity. This is exactly why Enhancement #5 (export sync) is CRITICAL — treat it as a standing acceptance criterion, not a separate late task.

The shared contract is the `Scene` object ([`scene.ts`](packages/editor/src/core/resolver/scene.ts)) — it already carries `transform` per clip and a reserved `transitions: []` array. Push new state through `Scene`, never directly into a renderer.

---

## Phase 1 — CRITICAL: Playback correctness (reverse scrub + black frame)

Issues #2 and #3 share a root cause (cache miss on a frame that isn't decoded yet) and a single solution (a bidirectional, prefetching frame scheduler). Do them together.

**Already exists:** [`FrameCache`](packages/editor/src/core/media/video/FrameCache.ts), [`StreamingFrameProducer`](packages/editor/src/core/media/video/StreamingFrameProducer.ts), [`DecoderBackedVideoFrameProvider`](packages/editor/src/core/media/video/DecoderBackedVideoFrameProvider.ts), [`VideoDecoderManager`](packages/editor/src/core/media/video/VideoDecoderManager.ts), and tests for `BackwardSeekStability`, `DecodeScheduling`, `RapidSeekStress`. **This is a refinement of existing infra, not a rewrite.**

- [ ] **Reproduce reverse-scrub desync in a test first.** Extend [`BackwardSeekStability.test.ts`](packages/editor/src/core/media/video/__tests__/BackwardSeekStability.test.ts) with a stepping-backward scrub that asserts the *displayed* frame matches the requested frame. Make it fail before fixing.
- [ ] **Bidirectional cache window.** Audit `FrameCache` eviction — confirm it warms frames on *both* sides of the playhead, not forward-only. Add a `direction` hint from the playback clock.
- [ ] **Prefetch / decode queue.** Keep N (2–5) frames warm ahead *in the current scrub direction*; warm clip-edge frames during idle (RAF gaps).
- [ ] **Black-frame fix (#3): last-good-frame fallback.** When the target frame for a clip transition isn't decoded yet, render the previously displayed frame (or the clip's first decoded frame) instead of clearing to black. Locate the clear/miss path in `GpuRenderer.render()` + the provider's "no frame available" branch.
- [ ] **Preload neighboring clip frames** at clip boundaries so switches never hit a cold decoder.
- [ ] **Done when:** stepping the playhead backward frame-by-frame shows the correct frame every time (test + manual), and scrubbing across a clip boundary in either direction shows no black flash. Verify with `/verify`.

---

## Phase 2 — CRITICAL: Text edit desync (#4)

**Reframe:** the "centralized text architecture" the roadmap asks for **mostly already exists.** [`TextOverlay`](packages/editor/src/editor/Preview/TextOverlay.tsx) streams edits through `engine.previewClip()` → `commitInteraction()`, the engine is the single source of truth, and both renderers read text off the resolved `Scene`. So this is a **bug hunt for a specific sync gap**, not a from-scratch store. Build the store only if the hunt proves the current model can't hold.

- [ ] **Pin down the repro.** Which surface lags — preview, timeline label, or export? Edit text, then check each. Note exact steps.
- [ ] **Check the preview live-paint path.** Text edits stream via `previewClip(id, trackId, { content })` ([TextOverlay.tsx:337](packages/editor/src/editor/Preview/TextOverlay.tsx#L337)). Confirm the RAF loop in [Preview.tsx:128](packages/editor/src/editor/Preview/Preview.tsx#L128) re-resolves and the `TextLayer` re-uploads the glyph texture every edit (stale glyph cache is the likely culprit — text rendered to a texture and not invalidated on `content` change).
- [ ] **Check timeline binding.** Does [`ClipBlock.tsx`](packages/editor/src/timeline/ClipBlock.tsx) subscribe to `clip:updated` and re-render its label?
- [ ] **Check export serialization.** Export reads `project` at call time; confirm an in-flight `previewClip` (uncommitted) is folded before export. Edits must be `commitInteraction`'d, not left in preview-only state.
- [ ] **Stable IDs / undo:** verify `previewClip`→`commitInteraction` produces exactly one undo entry (a test already lives in [`TimelineEngine.interaction.test.ts`](packages/editor/src/core/editor/TimelineEngine.interaction.test.ts) — extend it for content edits).
- [ ] **Done when:** a text edit reflects immediately in preview + timeline, survives export, and is a single undo step. Add a regression test.

---

## Phase 3 — CRITICAL: Export ↔ preview parity (Enhancement #5)

This is the standing guarantee from the "Read first" section, made explicit. Do it *continuously* alongside every visual feature, and lock it with a test harness now.

> **Status of the concern:** export currently looks *visually* right for video/image/text/audio, but it has **never been checked at the frame level** — and the two paths are known to address frames differently (see 3a). Treat current export as "spatially correct, temporally unverified."

### 3a. Frame-accuracy audit (deep dive — do this FIRST, it gates the harness design)

The placement *math* is shared (`resolveDrawRect`, `computeTextLayout`, `resolveTimeline`), so **spatial** parity is largely safe. The risk is **which source frame each path samples** — they use different decode backends *and different sampling conventions*:

| | Preview | Export |
|---|---|---|
| Backend | `StreamingFrameProducer` + WebCodecs `VideoDecoderManager` + `FrameCache` | mediabunny `CanvasSink` |
| Addressing | integer **source-frame index** | **time in seconds** = `sourceFrame / fps` |
| Frame mapping | `Math.round(timestamp / usPerFrame)` → **nearest / center-of-frame** ([VideoDecoderManager.ts:61](packages/editor/src/core/media/video/VideoDecoderManager.ts#L61)) | `sink.getCanvas(sourceFrame / fps)` → frame **at/just-before** that time = **start-of-frame / floor** ([ExportWorker.ts:348](packages/editor/src/core/export/ExportWorker.ts#L348)) |

Concrete, fixable divergences to chase:

- [ ] **Half-frame phase offset (most likely culprit).** Preview rounds PTS to the *nearest* frame (samples the frame center); export seeks at the frame's *start* time. On any source with timestamp jitter — or simply at frame boundaries — these pick different source frames → systematic ±1-frame mismatch on roughly half the timeline. **Likely fix:** export should seek at the frame midpoint, `(sourceFrame + 0.5) / fps`, to match preview's `round()` semantics. Verify against a known frame-numbered test clip.
- [ ] **Source fps ≠ project fps.** `sourceFrame` is in *project* frame units and both paths divide by *project* `fps`. If the media's native fps differs (e.g. 24fps clip in a 30fps project), preview's `round(PTS·projectFps)` maps decoded frames to project indices **non-uniformly** (gaps → cache misses → it holds the last frame), while export's continuous time-seek returns a frame every time. Result: guaranteed frame-by-frame divergence on mismatched-fps media (and preview stutter independently). **Decide the model:** is source assumed == project fps? If not, both paths need an explicit source-fps→project-fps resample map, applied identically.
- [ ] **Variable frame rate (VFR) sources.** Both conventions assume uniform `n/fps` spacing. VFR (common in screen recordings / phone video) breaks the `index ↔ time` identity for *both* paths, differently. At minimum detect VFR on import and warn/normalize.
- [ ] **A/V tail length.** Audio length is `ceil(sampleRate · totalFrames/fps)` ([exportVideo.ts:55](packages/editor/src/core/export/exportVideo.ts#L55)) while video is exactly `totalFrames · (1/fps)`. Audio is padded slightly longer → sub-frame A/V length mismatch at the tail. Confirm it's <1 frame and that per-clip audio offsets (`startFrame/fps`, `sourceStartFrame/fps`) land on the intended frame.
- [ ] **Fonts in the worker.** `drawText` measures+renders with the worker's `OffscreenCanvas` 2D context; if a web/custom font isn't registered in the worker (`self.fonts.add(new FontFace(...))`), metrics and glyphs differ from the main-thread preview → text wraps/positions differently. Ensure the same fonts are loaded worker-side before the frame loop.
- [ ] **Done (audit) when:** a deterministic, frame-numbered test clip exports such that decoded frame N visibly carries source frame N, matching what preview shows at the same playhead — confirmed for matched-fps, and a documented decision (support or reject) for mismatched/VFR.

### 3b. Golden-frame parity harness (lock it so it can't regress)

- [ ] Render the same `Scene` through `GpuRenderer` (preserveDrawingBuffer readback) and through `ExportWorker.renderFrame()`; assert per-pixel (or perceptual-hash) equality. Build on [`GoldenFrameHash.test.ts`](packages/editor/src/core/renderer/gpu/__tests__/GoldenFrameHash.test.ts).
- [ ] Use a **synthetic frame-numbered video** (each source frame painted with its own index) so a 1-frame temporal slip is caught, not just spatial drift. The existing `probeLayer` path already paints "frame N" per clip — reuse that idea for the fixture.
- [ ] **Cover each layer type:** video frame-selection (3a), image object-fit, text (baseline/lineHeight/font), opacity, z-order, rotation.
- [ ] **Make parity a PR gate** so future transform/transition/animation work can't silently diverge.
- [ ] **Done when:** the harness passes for a multi-layer project and runs in CI.

---

## Phase 4 — HIGH: Interactive transform for video & images (#1)

**Already exists:** the `Transform` data model (`x, y, scale, rotation, anchor`) and its flow through `Scene` → both renderers. The generic edit API (`previewClip`/`commitInteraction`/`cancelInteraction`/`findClip`) is already proven by `TextOverlay`. **What's missing is the interaction layer for video/image** — there's no overlay for them today.

- [ ] **Generalize the overlay.** Extract the gesture machinery from [`TextOverlay`](packages/editor/src/editor/Preview/TextOverlay.tsx) into a shared `TransformOverlay` that operates on `transform.scale` / `transform.x/y` / `transform.rotation` for any clip type. (Note: today `TextOverlay` resizes via `fontSize`, not `transform.scale` — decide whether text adopts the unified scale path or stays special-cased.)
- [ ] Render it for `scene.videos` and `scene.images` (mounted in [Preview.tsx](packages/editor/src/editor/Preview/Preview.tsx) next to `TextOverlay`).
- [ ] **Corner resize handles** → write `transform.scale` (uniform). **Aspect-ratio lock** by default; modifier key for free.
- [ ] **Rotation handle** → write `transform.rotation` (radians; renderers already consume it).
- [ ] **Bounding box** mapped through `computeContainViewport` (same letterbox math the text overlay uses) so handles stay glued under letterboxing.
- [ ] **Snap guides** — reuse [`snap.ts`](packages/editor/src/core/utils/snap.ts) if applicable; snap to stage center / edges.
- [ ] **Done when:** video & image clips can be moved, uniformly scaled (aspect-locked), and rotated in the preview, results persist through undo and match in export (Phase 3 harness).

---

## Phase 5 — HIGH: Media-on-drop pipeline (Enhancements #1 & #2)

Both are greenfield worker pipelines. Group them — they share a "background extraction worker + cache" shape.

### 5a. "Extract audio?" dialog on video drop (Enhancement #1)

When a video asset that contains an audio track is dropped onto the timeline, show a dialog asking how to place it. Currently `dropMediaAsset` in [`useTimelineDrop.ts:96`](packages/editor/src/timeline/useTimelineDrop.ts#L96) calls `engine.addClip()` immediately with no prompt.

**Step 1 — detect audio presence at import time** ([`importFiles.ts`](packages/editor/src/core/assets/importFiles.ts))
- [ ] In `probeVideo()`, after `loadedmetadata` fires, read `el.audioTracks.length > 0` (`AudioTrackList`, available in Chrome/Safari; Firefox uses `el.mozHasAudio`). Add `hasAudio?: boolean` to [`MediaAsset`](packages/editor/src/core/assets/types.ts).
- [ ] Update `importSingleFile` to set `hasAudio` from the probe result when `kind === 'video'`.

**Step 2 — intercept the drop and show the dialog** ([`useTimelineDrop.ts`](packages/editor/src/timeline/useTimelineDrop.ts))
- [ ] Make `dropMediaAsset` async. When `asset.kind === 'video' && asset.hasAudio`, **pause before `addClip()`** and open a dialog.
- [ ] Dialog — three choices (no Cancel; dropping already implies intent to place):
  - **Video + Audio** — add a video clip on the current track *and* an audio clip on an audio track at the same `startFrame`.
  - **Video only** — current behaviour; skip audio.
  - **Audio only** — add only an audio clip; skip the video track.
- [ ] For **Video + Audio**: find the first audio track (`useTracksStore.getState().tracks.find(t => t.kind === 'audio')`), or create one if none exists. Add both clips via two `engine.addClip()` calls at the same `startFrame`.
- [ ] If `asset.hasAudio` is `false`/`undefined`, skip the dialog and proceed as today (no regression for audio-less video or images).

**Step 3 — linked media (deferred, not blocking the dialog)**
- [ ] Ripple-safe edits (move one → move both) need a `linkedClipId` field on `Clip`. Log as follow-on — the dialog is already useful without it.

**Done when:** dropping a video with audio shows the dialog; all three choices produce the correct clips; dropping a video without audio (or an image/audio asset) skips the dialog. Verify with `/verify`.

### 5b. Real timeline thumbnails + waveforms (Enhancement #2)
- [ ] **Note:** the waveform in [`ClipBlock.tsx:44`](packages/editor/src/timeline/ClipBlock.tsx#L44) is **fake/decorative static bars** — replace with real data.
- [ ] **Thumbnail worker:** interval-extract frames off the demuxer, lazy-load, cache (mirror the `FrameCache` pattern). Render strips in `ClipBlock`.
- [ ] **Waveform generation:** decode peaks off the audio buffer in a worker; cache per asset.
- [ ] **Done when:** clips show real scene thumbnails and audio clips show a real waveform.

---

## Phase 6 — HIGH/MEDIUM: Transitions (Enhancements #3 & #4)

**Already exists:** `Scene.transitions: SceneTransition[]` is a reserved, typed-for-growth array ([scene.ts:78](packages/editor/src/core/resolver/scene.ts#L78)). Define its real shape here.

- [ ] **Clip transitions (#3, HIGH):** fade / slide / blur / zoom / wipe. Roadmap says start with an HTML/CSS overlay layer above the preview for fast iteration — fine for preview, **but export uses the 2D-canvas path**, so the transition timing/blend must also be reproduced in `ExportWorker` (Phase 3 harness guards this). Define `SceneTransition` fields: `kind, fromClipId, toClipId, startFrame, durationFrames`.
- [ ] **Text entry/exit transitions (#4, MEDIUM):** fade in / typewriter / scale / slide / blur reveal, driven off the same descriptor.
- [ ] **Done when:** at least fade + one wipe work identically in preview and export.

---

## Phase 7 — HIGH: UI / layout polish

- [ ] Responsive dock-based panel layout (Asset / Elements / Preview / Timeline).
- [ ] Dark, premium spacing hierarchy; modern timeline ergonomics.
- [ ] Adaptive behavior for long videos (zoom already partly handled in the timeline pass).

---

## Later — only after core is stable

Documentation → public APIs → plugin architecture → SDK. The roadmap is right that these get *much* easier once the renderer-parity harness (Phase 3) and the unified transform/scene contract are locked. Don't start before then.

---

### Suggested order
1. **Phase 1** (playback) and **Phase 3** harness in parallel — both unblock everything visual.
2. **Phase 2** (text desync) — small, high user-visible payoff.
3. **Phase 4** (transform UI) — leans on the Phase 3 harness.
4. **Phase 5** (media pipeline), **Phase 6** (transitions), **Phase 7** (UI) — independent, parallelizable.
