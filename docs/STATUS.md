# Status: what is built, layer by layer

The exhaustive per-feature table. The README carries a short summary and links here.
Status is descriptive of the **current codebase**, not a plan.

| Layer | Status |
|---|---|
| Timeline data model (`Clip`, `Track`, `Project`) | ✅ Stable, frame-based |
| `TimelineEngine` (Immer + history + events + batch) | ✅ Stable |
| `PlaybackEngine` (RAF clock + subscribe) | ✅ Stable |
| `resolveTimeline(frame, project) → Scene` (pure resolver) | ✅ Stable, solo/mute/zIndex correct |
| Timeline UI (`Timeline`, `Ruler`, `TrackRow`, `ClipBlock`, `Playhead`) | ✅ Working |
| Media import + library store | ✅ Working |
| Media gallery UI + drag-drop | ✅ Working |
| **WebGL2 GPU renderer** (`GpuRenderer`, `RenderGraph`, `VideoLayer`, `ImageLayer`, `TextLayer`) | ✅ Working — textured-quad compositing, context-loss recovery |
| **Real video playback** (WebCodecs decode + mediabunny demux) | ✅ Working — push-based `StreamingFrameProducer`, copy-and-close frame cache |
| **`<Preview>` component** (mounts renderer + drives RAF) | ✅ Working — library component in `@elah/editor` |
| **Project aspect ratio / letterbox** | ✅ Working — canvas `gl.viewport` contain-fit + per-clip object-fit **contain** (off-aspect clips letterboxed *within* the frame, never stretched); switchable stage aspect via `TimelineEngine.setStage` (16:9 ↔ 9:16) with a `<StageBorder>` frame outline |
| **Text overlays** (GPU `TextLayer` + interactive `TextOverlay`) | ✅ Working — paint via 2D-canvas→texture; drag / resize / inline-edit; rotate knob (Shift snaps to 15°); `transform.scale` (re-rasterized to stay crisp) + `transform.rotation` applied |
| **Video & image transform overlay** (`MediaTransformOverlay`) | ✅ Working — click-select, drag-move, 8 resize handles (4 corners + 4 edges) with non-uniform scale (**Shift** keeps aspect), and a Resize/Crop toggle that edits `Clip.crop`; `transform` flows to both renderers so export matches preview automatically. There is **no rotate handle** for video/image clips (text clips have one) |
| **Audio playback** (`AudioPlaybackController` on the `PlaybackEngine` clock) | ✅ Working — **multi-track**, per-clip control, master/track volume via `useAudioMixer` / `useTrackLevels` / `useMasterVolume` (from `@elah/react`); mounted by `<Preview enableAudio>` |
| **Image clips** (GPU `ImageLayer`) | ✅ Working — static image load → textured quad, same object-fit contain as video; decode cache warming (`warmImageSrc`, `preloadProjectImages`) |
| **Shape & freehand clips** (GPU `ShapeLayer`, `FreehandLayer`) | ✅ Working — `createShapeClip` / `createFreehandClip`; resolver exposes `scene.shapes` + `scene.freehand`; interactive `ShapeOverlay` for select / move / scale |
| **Timeline thumbnails + waveforms** | ✅ Working — filmstrip tiles per clip (4-frame strip, tiled by zoom), real waveform peaks from `decodeAudioData`; both generated once per asset and cached on `MediaAsset` |
| **Audio-on-drop dialog** | ✅ Working — dropping a video with audio shows a 3-choice modal (Video+Audio / Video only / Audio only); both clips added in one `engine.batch` (one undo) |
| **Export pipeline** (`exportVideo` → MP4) | ✅ Working — module worker renders frames to `OffscreenCanvas` (reusing `resolveTimeline` + shared placement math) and muxes via mediabunny; audio mixed on the main thread |
| **Headless CLI** (`@elah/cli` — `split` / `trim` / `build` / `export`) | ✅ Working — engine edits in plain Node; `export` runs core's real `exportVideo` in headless Chrome, so CLI output matches editor output by construction |
| **AI build spec** (`elah build --spec spec.json --export out.mp4`) | ✅ Working — seconds-based JSON spec → validated project via `TimelineEngine`; path-addressed errors (`clips[2].duration must be …`) a generating model can self-correct from |
| **HTTP render server** (`elah serve` + Docker) | ✅ Working — long-lived warm-browser session; `POST /render` takes a build spec, returns MP4 bytes; `/healthz`, `--concurrency` guard with `503 + Retry-After`; Dockerfile ships Chrome + fonts |
| **Transitions** (9 kinds, 1.0.0) | ✅ Working — `fade`, `slide`, `wipe`, `zoom`, `spin`, `whip`, `glitchCut`, `warpDissolve`, `lumaWipe`. The resolver keeps both clips in the scene and lists the transition in `scene.transitions`; the WebGL2 renderer composites the pair with one shader in preview and export, so both clips keep playing with their effects. `slide` and `whip` take a direction (left, right, up, down). A project that uses only fade, wipe or slide still exports without WebGL2 (a 2D snapshot path); any other kind needs WebGL2 and its export fails without it |
| Rotation handle for video/image | ⚪ Not built — `transform.rotation` flows through both renderers but is set through the engine only; the box tilts, there is no handle. Text clips have a rotate knob |
| **Multiple video tracks** (0.6.0) | ✅ Working — `addTrack('video')` adds a lane; video tracks composite in track order (topmost lane on top). Decode is still unscheduled, so one active video clip at a time is the tested path |
| **Clip speed, crop & corner radius** (0.6.0) | ✅ Working — `Clip.speed` (0.25–4, `engine.setClipSpeed`, honoured by export), `Clip.crop` (normalized source window), `Clip.cornerRadius` (0–0.5) |
| **Text templates & layered motion** (0.6.0) | ✅ Working — 14 `BUILT_IN_TEXT_TEMPLATES`; `applyTextTemplate` returns an undoable `Partial<Clip>` patch; entry/exit via `TextAnimation` `inMotion` / `outMotion` (`MotionSpec`). A template's `stagger` and `tracking` are data only — nothing in the packages runs them |
| **Frame sequences** (0.6.0) | ✅ Working — `createFrameSequence`, `FrameSequenceController` (clock, drag-to-scrub, `wrap`/`pingpong`), `createFramePreloader`, `frameSequenceToProject` |
| **Stored project documents** (0.6.0) | ✅ Working — `readProjectDocument` (total reader: a `Project` or a `ProjectDocumentError`), `relinkProjectMedia` (reports unrecoverable `blob:` clips as `missing`, never drops them), `engine.loadProject(project, { transport, history })`, `project:loaded` event |
| **Media-library snapshot / hydrate** (0.6.0) | ✅ Working — `snapshotMediaLibrary` / `hydrateMediaLibrary` / `refreshMissingThumbnails` give a host the seam to carry asset metadata and thumbnails across a page load (storage is the host's; core ships no adapter). Bytes of locally imported files (`blob:` URLs) are not persisted |
| **Protected / pinned tracks** (0.6.0) | ✅ Working — `Track.protected` (the user cannot remove it) and `Track.pinned: 'bottom'` (`addTrack` keeps the lane below every non-pinned track) |
| **Motion layer** (1.0.0) | ✅ Working — keyframes on every transform channel with the full ease set (sine to bounce, `steps(n)`, cubic-bezier) and closed-form springs, hold keys, stagger (from start/end/centre/edges/random, grid), motion paths, per-unit text animators, scramble text, repeat/yoyo, skew, 3D tilt (`rotateX`/`rotateY` on video, image, sequence and compound clips), expressions, 36 motion presets |
| **Effects, generators, blend modes & mattes** (1.0.0) | ✅ Working — 23 GPU effects (`EFFECT_REGISTRY`) plus bundles and looks, 8 generators (particles, light leak, lens flare, counter, bar chart, …), masks, track mattes, blend modes; one WebGL2 pipeline for preview and export |
| **New clip types** (1.0.0) | ✅ Working in core — `adjustment`, `generator`, `compound` (a nested project as one clip), `sequence` (animated image or numbered frames). Project documents are version 5. `@elah/timeline` draws them and `@elah/editor` plays, saves and exports them |
| Editing UI for the new clip types | ⚪ Not built in `@elah/editor` — no inspector, curve editor or compound editor yet; build with the engine API |
| **Clip audio** (1.0.0) | ✅ Working — `Clip.audio`: mute, boost, fades and Enhance (noise reduction, voice clarity); one envelope and one Web Audio chain for preview and export |
| **Lottie & SVG import** (1.0.0) | ✅ Working — `lottieToClip`, `svgToProject` produce editable clips and keys, with a report of what they could not map |
| **Export containers** (1.0.0) | ✅ Working — MP4 (default), WebM (transparent where the browser's own check passes), GIF, PNG sequence; `avc`, `hevc`, `av1`, `vp9`, `vp8` where the browser can encode; `range: 'inOut'`. Chromium only |
| **HTML/CSS scenes → clips** (1.0.0, experimental) | ✅ Working — import from `@elah/core/html`. `validateScene` checks a scene against a whitelisted HTML/CSS subset; `sceneToClip` converts a **measured** scene to one compound clip of native clips and keys (`data-motion` grammar). Measuring the scene in a browser is the host's step; no measurer ships |
| **VideoSpec & editor ops** (1.0.0, experimental) | ✅ Working — import from `@elah/core/spec` and `@elah/core/ops`. `compileVideoSpec` / `buildVideo` turn a seconds-based JSON spec a model writes into a `Project` (17 components, 6 systems) with path-addressed issues; 57 typed ops (`applyOps`, `sanitizeOps`) edit one; `layProject` lays either onto a live engine as one undo step |
| **Fonts in the package, CDN-safe workers** (1.0.0) | ✅ Working — 12 OFL families ship inside `@elah/core` (its `fonts/` folder; opt in with `packageFontsBaseUrl()`; default stays `/fonts/`); the export, analysis and probe workers start from a cross-origin URL via a blob module worker |
| **Browser-free engine entry** (`@elah/core/engine`) | ✅ Working — engine, resolver, playback clock, stores, factories and project documents with no renderer, codec or export worker (React Native, Node) |
| Scheduler / predictive frame caching | ⚪ Not started — next architectural layer |

See [`ROADMAP.md`](../ROADMAP.md) for current state and the next layer,
[`CURRENT_LIMITATIONS.md`](../CURRENT_LIMITATIONS.md) for known gaps, and
[`packages/core/src/renderer/architecture.md`](../packages/core/src/renderer/architecture.md)
for the GPU render + decode pipeline in depth.

> **Stability.** From 1.0.0 the exported API of `@elah/core` (root and `@elah/core/engine`), `@elah/react`, `@elah/timeline` and `@elah/editor` follows semver. The AI-facing layers are **experimental** and may change in a minor release; they are not on the root but have their own entries: `@elah/core/spec` (VideoSpec), `@elah/core/html` (HTML/CSS scenes), `@elah/core/ops` (the op vocabulary) and `@elah/core/icons`. See [`CHANGELOG.md`](../CHANGELOG.md) for 1.0.0, including the breaking changes (project version 5, widened `ClipType` and `TransitionKind`).

> **Multiple video tracks are allowed as of 0.6.0** (audio has been multi-track
> since 0.3.0), but the decode pipeline has no scheduler yet, so several video
> clips decoding at once can stall — see [`CURRENT_LIMITATIONS.md`](../CURRENT_LIMITATIONS.md).
> The headless build spec still places every video clip on one track.
