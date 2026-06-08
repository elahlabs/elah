# Sprint V1 — Release by Sunday 31 May 2026

> **Goal:** Ship `@elah/editor` v1.0.0 — video plays flawlessly, image/audio/text render, npm published, domain live, GitHub public.
>
> **Clock:** Monday 25 May → Sunday 31 May (one day slip to Monday 1 June is acceptable).
>
> **Rule:** Complete each day's tasks before moving to the next day. If a task slips, cut scope — do not delay beyond Monday 1 June.

---

## People

| Tag | Who | Focus |
|---|---|---|
| `[YOU]` | Lead developer | Renderer internals, layer implementation, integration |
| `[I1]` | Intern 1 | Docs, npm, package polish |
| `[I2]` | Intern 2 | Domain, landing page, social / launch |

---

## Daily Standup Format (takes 5 min)

Each morning, both interns answer:
1. What did I finish yesterday?
2. What am I doing today?
3. Is anything blocked?

Post answers in your shared chat before starting work.

---

## Monday 25 May — Study Session 1 + Intern Kickoff

### You

**Block 1 (2.5 h) — Study Session 1: The Two-World Mental Model**

Goal: internalize the sync/async split and the decision tree before touching any code.

- [ ] Open DevTools on the playground. Filter console to `[GPU-TRACE]`. Play a clip for 5 seconds, pause, scrub backward 50+ frames. Observe the trace output.
- [ ] Read `OPTIMIZATION.md` §1 (TL;DR + decision tree flowchart). For each line in the trace you just captured, locate where it falls in the flowchart.
- [ ] Read `OPTIMIZATION.md` §2 (Layer map). Draw or annotate the Mermaid diagram — label each node with the file that owns it.
- [ ] Read `gpu/types.ts` entirely (56 lines). Note what `demuxerFactory: undefined` triggers.
- [ ] Read `gpu/GpuRenderer.ts` — focus on: `scene === lastScene` guard, `_handleContextLost()`, the `render()` method body.
- [ ] Read `gpu/FrameCache.ts` entirely. Understand `_evictFurthest()` and why `setPivot` fixes backward seek.

**Block 2 (30 min) — Run Isolation Oracles**

```bash
cd packages/editor
npm test -- --run gpu/__tests__/FrameCache.test.ts
npm test -- --run gpu/__tests__/FrameCache.pivot.test.ts
npm test -- --run gpu/__tests__/FrameOwnership.test.ts
npm test -- --run gpu/__tests__/RenderSynchronization.test.ts
```

- [ ] All tests green. If any fail — read the failure message carefully; it tells you exactly which invariant broke.

**Block 3 (30 min) — Brief the interns**

- [ ] Send interns the `INTERN-BRIEF.md` document (in `docs/`)
- [ ] Confirm they have `git clone` access and `npm install` works on their machines
- [ ] Agree on shared communication channel (Discord / Slack / WhatsApp)

**Done criteria for today:** You can explain the two-world model (sync render tick vs async decode pipeline) without looking at any notes. All four tests green.

---

### Intern 1 — Monday

- [ ] Run `npm search elah` and check if `@elah/editor` is available on npmjs.com
- [ ] Check name variants: `elah-editor`, `elah-video`, `@elah/core` — document what is available
- [ ] If `@elah/editor` is free: publish a placeholder `0.0.1` to block the name (instructions in `docs/INTERN-BRIEF.md`)
- [ ] Read current `README.md` and note anything that is outdated or missing

### Intern 2 — Monday

- [ ] Research domain options: `elah.dev`, `elah.io`, `elahvideo.com`, `uselah.com`, `getlah.dev` — note price + availability
- [ ] Check GitHub repo settings: is the repo public-ready? (License present ✅, `.gitignore` present ✅)
- [ ] Read `README.md` and `CONTRIBUTING.md` — flag anything that references the old working name or placeholder text

---

## Tuesday 26 May — Study Session 2 + Flush Bug Diagnosis

### You

**Block 1 (2.5 h) — Study Session 2: The Async Bridge**

- [ ] Read `gpu/DecoderBackedVideoFrameProvider.ts` fully. Trace the discontinuity path:
  `requestFrame(N)` where `|N − lastRequested| > 1` → `_pending.clear()` → `manager.seek(N)` → `_enqueueRequestFrame(N)`
- [ ] Read `gpu/FrameCache.ts` again, this time focusing on the ownership contract: who puts, who borrows, who closes.
- [ ] Run and read every line of:
  ```bash
  npm test -- --run gpu/__tests__/DecoderBackedVideoFrameProvider.test.ts
  npm test -- --run gpu/__tests__/BackwardSeekStability.test.ts
  npm test -- --run gpu/__tests__/StuckDecodeRecovery.test.ts
  ```
- [ ] Read `gpu/VideoDecoderManager.ts` lines 1–100 (state machine declaration and transitions). Map the eight states on paper.

**Block 2 (1.5 h) — Diagnose Per-Frame Flush Bug**

- [ ] Open `gpu/VideoDecoderManager.ts` and find `_decodeFrame` (~lines 420–450).
- [ ] Locate the `await decoder.flush()` call. Understand exactly why calling `flush()` after every frame forces the decoder to expect a keyframe, causing O(GOP) re-decode at 30 fps.
- [ ] Read `OPTIMIZATION.md` §9.1 (Per-frame `decoder.flush()` — highest impact).
- [ ] Write a one-paragraph summary (in a scratch note) of: what the fix is (trailing output buffer, flush only on seek or idle), and what the state machine transitions look like after the fix.

**Done criteria:** You can explain to someone else — without notes — why `flush()` per frame kills performance, what the correct fix is, and which state transitions change.

---

### Intern 1 — Tuesday

- [ ] Update `README.md` Status table: mark GPU renderer as ✅ Working
- [ ] Polish the Quick Start section — verify every command actually works from a fresh clone
- [ ] Add a "What's in v1.0.0" section to README describing: multi-video playback, image layer, single audio track, text layer

### Intern 2 — Tuesday

- [ ] Purchase the chosen domain (confirm with lead developer before buying)
- [ ] Set up DNS to point to GitHub Pages or Vercel (whichever is simpler)
- [ ] Create a minimal landing page skeleton: name, one-line description, GitHub link, npm install command, "coming soon" status

---

## Wednesday 27 May — Flush Fix + Multiple Video Verification

### You

**Block 1 (3 h) — Fix Per-Frame `flush()` in VideoDecoderManager**

The change lives in `gpu/VideoDecoderManager.ts` `_decodeFrame`:

- [ ] Remove the unconditional `await decoder.flush()` after decode
- [ ] Add flush only on: (a) entering `Seeking` state, (b) transitioning to `Draining`/`Idle`
- [ ] If needed, add a trailing output buffer: collect decoded frames from `output` callback; resolve on the next `_decodeFrame` call when the buffer has the target frame
- [ ] Run the full decoder test suite:
  ```bash
  npm test -- --run gpu/__tests__/VideoDecoderManager.test.ts
  npm test -- --run gpu/__tests__/DecodeScheduling.test.ts
  npm test -- --run gpu/__tests__/PlaybackStress.test.ts
  npm test -- --run gpu/__tests__/ErrorHandling.test.ts
  ```
- [ ] All tests green. Fix any regressions before moving on.

**Block 2 (1 h) — Verify Multiple Video Compositing**

- [ ] Open `gpu/layers/VideoLayer.ts`. Find where `opacity` is passed to the shader as a uniform.
- [ ] Open `gpu/WebGLContext.ts`. Confirm `gl.enable(gl.BLEND)` and `gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)` are in `_initGLState`.
- [ ] In the playground: add 2 video tracks, add a clip on each with different source files, set different opacity values. Confirm both composited correctly.
- [ ] Run `MultiClipOverlap.playback.test.ts`:
  ```bash
  npm test -- --run gpu/__tests__/MultiClipOverlap.playback.test.ts
  ```

**Done criteria:** `PlaybackStress.test.ts` passes. Two overlapping videos composite with correct opacity in the playground. `avgDecodeLatencyMs` is stable (no per-GOP restart visible in `[GPU-TRACE]`).

---

### Intern 1 — Wednesday

- [ ] Document all public exports from `packages/editor/src/index.ts` with a one-line description for each
- [ ] Write JSDoc examples for: `GpuRenderer`, `resolveTimeline`, `createMediabunnyBackend`, `DemuxerBackend`
- [ ] Add a "Renderer Architecture" section to README linking to `OPTIMIZATION.md` and `architecture.md`

### Intern 2 — Wednesday

- [ ] Landing page: add installation section (`npm install @elah/editor`), basic usage code block, links to docs
- [ ] Write the launch tweet / X post (280 chars max, punchy, link to npm and GitHub)
- [ ] Write a longer Reddit-style post for r/webdev or r/javascript (3–5 paragraphs, what problem it solves, why it's different)

---

## Thursday 28 May — Study Session 3 + Image Layer

### You

**Block 1 (1.5 h) — Study Session 3 (abbreviated — flush fix already done)**

- [ ] Read `OPTIMIZATION.md` §4 (all four smoke recipes). Run Recipe A (synthetic, no mediabunny) and Recipe C (forward/backward seek with trace open).
- [ ] Read `OPTIMIZATION.md` §5.3 (frame ownership chain diagram). Confirm your understanding: FrameCache owns → VideoLayer borrows → VideoTexture closes clone.
- [ ] Skim §6 (freecut reference) and §8 (anti-patterns hall of fame). Mark any anti-pattern you haven't verified is absent in the codebase.

**Block 2 (2.5 h) — Image Layer**

New file: `packages/editor/src/core/renderer/gpu/layers/ImageLayer.ts`

Contract: `Layer<ActiveImageClip>` — same interface as `VideoLayer`.

- [ ] `acquire(item, ctx)`: fire-and-forget `fetch(item.src) → createImageBitmap()`. Store `{ bitmap: null, texture: new VideoTexture(pool), pending: true }` per `item.id`.
- [ ] `draw(item, ctx)`: if bitmap arrived → upload via `gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap)` → `gl.drawArrays`. Reuse the same quad shader and `buildTransformMatrixFromRect` from VideoLayer. If pending → skip draw (no-flicker).
- [ ] `release(id)`: `bitmap.close()`, `texture.release()`.
- [ ] `notifyContextLost()`: `texture.handleContextLost()` for each entry.
- [ ] Register in `GpuRenderer.ts`: `_renderGraph.registerLayer(imageLayer, s => s.images, i => i.id, i => i.zIndex)`
- [ ] Smoke test in playground: add an image clip, confirm it renders at the correct position and zIndex between video clips.

**Done criteria:** An image clip renders in the playground with correct transform and composites correctly above/below video clips by zIndex.

---

### Intern 1 — Thursday

- [ ] Polish playground UI: make the toolbar look presentable (spacing, fonts, button states)
- [ ] Add keyboard shortcut legend to the playground (collapsible `?` panel or footer row)
- [ ] Verify the playground works on Chrome, Firefox, and Safari (note any issues)

### Intern 2 — Thursday

- [ ] Record a 30–60 second demo: import a video, add it to the timeline, play, scrub, add image overlay
- [ ] Create a demo GIF (under 5 MB) for the README and landing page from the demo recording
- [ ] Draft GitHub release notes for v1.0.0 (what's in, what's out of scope, upgrade path)

---

## Friday 29 May — Audio + Text Layers

### You

**Block 1 (2 h) — Single Audio Track**

New file: `packages/editor/src/core/renderer/SingleAudioScheduler.ts`

Contract: `update(scene: Scene, frame: number, fps: number, isPlaying: boolean) → void`

- [ ] One `HTMLAudioElement` (`_element`), one current `_src` string.
- [ ] On update:
  - Pick `scene.audios[0]` (first active audio clip, or `null`).
  - If no clip: pause element, return.
  - If `clip.src !== _src`: replace element (pause old, create new `Audio(clip.src)`, set `_src`).
  - Sync: `targetTime = clip.sourceFrame / fps`. If `|element.currentTime − targetTime| > 0.1`: `element.currentTime = targetTime`.
  - `element.volume = clip.volume`.
  - `isPlaying && element.paused` → `element.play()`.
  - `!isPlaying && !element.paused` → `element.pause()`.
- [ ] Wire into `GpuPreview.tsx` RAF tick: call `audioScheduler.update(scene, frame, FPS, playback.isPlaying)` before `renderer.render(scene)`.
- [ ] Dispose in cleanup: `element.pause(); element.src = ''`.
- [ ] Test in playground: add an audio clip, confirm it plays in sync with the playhead, pauses and resumes correctly, hard-seeks on scrub.

**Block 2 (2 h) — Text Layer**

New file: `packages/editor/src/core/renderer/gpu/layers/TextLayer.ts`

- [ ] Per clip state: `{ texture: VideoTexture, lastContent: string | null }`.
- [ ] `draw(item, ctx)`: if `item.content !== lastContent`:
  - Create `OffscreenCanvas(ctx.stage.width, ctx.stage.height)`.
  - `c2d.fillStyle = '#fff'; c2d.font = '48px sans-serif'; c2d.fillText(item.content, 40, ctx.stage.height / 2)`.
  - `createImageBitmap(canvas)` → upload to `VideoTexture` → draw quad.
  - Set `lastContent = item.content`.
  - Else: just draw with existing texture.
- [ ] `release(id)`: `texture.release()`.
- [ ] Register in `GpuRenderer.ts`: `_renderGraph.registerLayer(textLayer, s => s.texts, i => i.id, i => i.zIndex)`.
- [ ] Test in playground: add a text clip, confirm text content renders at correct zIndex between video and image clips.

**Done criteria:** All four layer types (video, image, audio, text) work simultaneously in the playground. Add one of each, play back, scrub — all four respond correctly.

---

### Intern 1 — Friday

- [ ] Final pass on all documentation — spell-check, broken links, code block syntax
- [ ] Update `package.json` in `packages/editor`: correct `name` (`@elah/editor`), `version` (`1.0.0`), `description`, `keywords`, `author`, `homepage`, `repository`
- [ ] Verify `packages/editor/src/index.ts` exports everything that should be public for v1
- [ ] Write `CHANGELOG.md` at workspace root: v1.0.0 section listing all features

### Intern 2 — Friday

- [ ] Insert the demo GIF into `README.md` at the top (below the title)
- [ ] Final review of landing page — mobile responsive?
- [ ] Prepare all social posts in a doc ready to copy-paste on Sunday
- [ ] Set up GitHub issue labels: `bug`, `enhancement`, `good first issue`, `documentation`, `question`

---

## Saturday 30 May — Integration Polish + Release Prep

### You

**Block 1 (2 h) — Integration Polish**

- [ ] End-to-end test: video + image + audio + text all active simultaneously at 30 fps. Measure with `renderer.setDebug(true)` — confirm `renderDurationMs < 12ms` (leaves headroom before 16ms budget).
- [ ] Check `GpuDebugCounters.snapshot()` after 60 s playback: `cacheHitRatio > 0.8`, `droppedFrames < 10`.
- [ ] Run the full test suite:
  ```bash
  cd packages/editor
  npm test
  ```
  All 28+ suites green.
- [ ] `tsc --noEmit` clean in both `packages/editor` and `apps/playground`.

**Block 2 (1.5 h) — npm Publish Prep**

- [ ] Bump version in `packages/editor/package.json` to `1.0.0`.
- [ ] Check `files` field in `package.json` — only ship `dist/`, `src/`, `README.md`, `LICENSE`, `CHANGELOG.md`.
- [ ] Run `npm pack --dry-run` in `packages/editor` — inspect the file list. Remove anything that should not ship (test files, internal docs).
- [ ] Build the package: `npm run build` in `packages/editor`. Confirm `dist/` is generated correctly.
- [ ] Test the built package locally: `npm pack` → install the `.tgz` in a fresh Vite project → confirm `import { GpuRenderer } from '@elah/editor'` resolves and the playground equivalent renders.

**Block 3 (1 h) — GitHub Release Prep**

- [ ] Tag the commit: `git tag v1.0.0`
- [ ] Draft the GitHub Release (do not publish yet — publish on Sunday).
- [ ] Write the release title: `v1.0.0 — GPU-accelerated video editor engine`
- [ ] Paste the `CHANGELOG.md` v1.0.0 section as the release body.

**Done criteria:** `npm pack --dry-run` looks correct, `tsc --noEmit` clean, all tests green, GitHub release draft saved. Everything is staged and ready — Sunday is just pressing publish.

---

### Intern 1 — Saturday

- [ ] End-to-end review: clone the repo fresh, follow the Quick Start, confirm it works exactly as documented
- [ ] Check `npm pack --dry-run` — are the right files included?
- [ ] Review the GitHub release draft — flag anything unclear

### Intern 2 — Saturday

- [ ] Final landing page deploy and verify it is live on the domain
- [ ] Confirm all social posts are final and approved
- [ ] Set up a GitHub Discussions welcome post for the first community thread

---

## Sunday 31 May — Release Day

> **Sequence matters. Do these in order. Nothing gets skipped.**

### Release Sequence (You + Interns together)

- [ ] **09:00** — Final smoke test: `npm install @elah/editor@1.0.0` from a clean machine. Confirm the playground starts.
- [ ] **09:30** — `npm publish --access public` from `packages/editor`.
- [ ] **09:35** — Verify on `npmjs.com/package/@elah/editor` that v1.0.0 is listed.
- [ ] **09:40** — Push the git tag: `git push origin v1.0.0`.
- [ ] **09:45** — Publish the GitHub Release (click Publish on the draft).
- [ ] **10:00** — Go live: make GitHub repo public if it was private.
- [ ] **10:05** — `[I2]` Post the launch tweet / X post.
- [ ] **10:10** — `[I2]` Post to Reddit (r/webdev, r/javascript, r/reactjs).
- [ ] **10:15** — `[I2]` Post to LinkedIn.
- [ ] **10:30** — `[I1]` Post to Hacker News "Show HN" thread.
- [ ] Monitor GitHub issues / npm download count / social responses through the afternoon.

---

## Scope Cuts (if time runs short)

These are safe to cut from v1 without breaking the architecture. Cut in this order:

| Cut | What breaks | What stays |
|---|---|---|
| Text Layer → defer to v1.1 | Text clips don't render | Video, image, audio unaffected |
| Image Layer → defer to v1.1 | Image clips don't render | Video, audio unaffected |
| Audio → defer to v1.1 | No audio playback | Video still plays, all architecture intact |
| Flush fix → defer to v1.1 | Playback degrades under load at 30 fps | Playback works, just drops frames under pressure |

> If you cut a layer, remove its entry from the README Status table and add it to a "v1.1 Roadmap" section instead.

---

## Hard Rules for the Week

1. **No new architecture.** Every layer reuses the existing `Layer<T>` interface, `TexturePool`, quad shader, and `RenderGraph.registerLayer`. Nothing new is designed this week.
2. **No scope expansion.** Spot something that could be improved? Add it to a `v1.1-backlog.md` note. Do not do it this week.
3. **Tests before merge.** Every new layer gets at least one test (render with mock data, release cleans up). No exceptions.
4. **Interns do not touch `core/renderer/gpu/`.** That is the renderer internals. They work on docs, npm config, landing page, and playground UI only.
5. **Blocked?** Shout immediately in the shared channel. Do not spend more than 30 minutes stuck alone.

---

## Reference — Key Files This Week

| File | Why you'll open it |
|---|---|
| `gpu/VideoDecoderManager.ts` | Flush fix (Wednesday) |
| `gpu/layers/VideoLayer.ts` | Template for Image + Text layers |
| `gpu/VideoTexture.ts` | Upload pattern to copy |
| `gpu/RenderGraph.ts` | Where to call `registerLayer` |
| `gpu/GpuRenderer.ts` | Where to instantiate and register new layers |
| `gpu/WebGLContext.ts` | Verify blend state |
| `apps/playground/src/GpuPreview.tsx` | Wire `AudioScheduler.update()` into RAF tick |
| `core/resolver/scene.ts` | `ActiveImageClip`, `ActiveTextClip` type definitions |

---

*Created: Sunday 24 May 2026. Sprint starts: Monday 25 May. Target release: Sunday 31 May.*
