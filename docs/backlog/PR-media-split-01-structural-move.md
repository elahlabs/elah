# PR Split-01 — Move media decode out of `renderer/gpu`

> Standalone ticket. Pick this up cold. Read the whole thing top to bottom; the **copy-paste prompt** at the bottom is what you hand to an AI coding agent.
>
> Companion reading (do not skip):
>
> - Master plan: `.cursor/plans/media-renderer-split-mvp_c1e1a43a.plan.md` (Session 1 section)
> - [`../packages/editor/src/core/renderer/OPTIMIZATION.md`](../packages/editor/src/core/renderer/OPTIMIZATION.md) §2 — layer map
> - [`../packages/editor/src/core/renderer/architecture.md`](../packages/editor/src/core/renderer/architecture.md) — current renderer contracts

---

## Status

🔴 Not started.

**Prerequisite:** none. This is the first ticket in the Media + Renderer Split sequence.

**Next ticket after merge:** [PR-media-split-02-streaming-producer.md](./PR-media-split-02-streaming-producer.md)

---

## Goal

Move all video **decode** code out of `packages/editor/src/core/renderer/gpu/` into a new `packages/editor/src/core/media/video/` folder. **Zero behavior change** — this PR is a pure refactor (moves + import rewrites only).

After this PR, `core/renderer/gpu/` contains only GL compositing concerns. `core/media/video/` owns async decode.

---

## Why this matters

Today the GPU folder mixes two concerns that evolve at different rates:

1. **Compositing** (sync, WebGL, shaders, layers) — stable
2. **Media decode** (WebCodecs, demuxer, frame cache) — actively being rewritten

Splitting them now gives Session 2 (StreamingFrameProducer) a clean home and enforces a one-way dependency: renderer imports the `VideoFrameProvider` **interface**; media never imports renderer internals.

---

## Frozen surfaces (do not touch in this PR)

Unless explicitly listed in **Scope → In**, leave these unchanged:

- `packages/editor/src/core/renderer/gpu/GpuRenderer.ts`
- `packages/editor/src/core/renderer/gpu/RenderGraph.ts`
- `packages/editor/src/core/renderer/gpu/WebGLContext.ts`
- `packages/editor/src/core/renderer/gpu/ShaderProgram.ts`
- `packages/editor/src/core/renderer/gpu/VideoTexture.ts`
- `packages/editor/src/core/renderer/gpu/TexturePool.ts`
- `packages/editor/src/core/resolver/**`

Import path updates in consumers are allowed; logic changes are not.

---

## Scope

**In:**

- Move source files (see table below)
- Move matching test files with their targets
- New barrel: `packages/editor/src/core/media/video/index.ts`
- Update all import paths across the repo
- Update public exports in `packages/editor/src/index.ts`
- Add ESLint `no-restricted-imports` boundary rule (or document equivalent if ESLint is not yet configured)
- Update layer diagrams in `architecture.md` and `gpu/README.md`

**Out:**

- Any logic changes to decode, cache, or render behavior
- StreamingFrameProducer (Session 2)
- TextLayer, AudioLayer (Sessions 3–4)
- Fixing the wedged decode bridge (expected to remain broken until Split-02)

---

## Design

### Files to move

| Source (today) | Destination |
|---|---|
| `core/renderer/gpu/FrameCache.ts` | `core/media/video/FrameCache.ts` |
| `core/renderer/gpu/VideoFrameProvider.ts` | `core/media/video/VideoFrameProvider.ts` |
| `core/renderer/gpu/DecoderBackedVideoFrameProvider.ts` | `core/media/video/DecoderBackedVideoFrameProvider.ts` |
| `core/renderer/gpu/VideoDecoderManager.ts` | `core/media/video/VideoDecoderManager.ts` |
| `core/renderer/gpu/demuxer/` (entire folder) | `core/media/video/demuxer/` |

### Test files to move with their targets

Move from `core/renderer/gpu/__tests__/` to `core/media/video/__tests__/`:

- `FrameCache.test.ts`
- `FrameCache.pivot.test.ts`
- `VideoFrameProvider.test.ts`
- `DecoderBackedVideoFrameProvider.test.ts`
- `VideoDecoderManager.test.ts`
- `MediabunnyDemuxer.test.ts`
- `MediabunnyBackend.test.ts`
- `NoOutputDecode.test.ts`
- `DecodeScheduling.test.ts`
- `FrameOwnership.test.ts`
- `VideoFrameOwnership.test.ts`
- `BackwardSeekStability.test.ts`
- `PlaybackRestart.test.ts`
- `PlaybackStress.test.ts` (if it imports VideoDecoderManager directly)
- `ProviderDisposal.test.ts`
- `ProviderObjectUrlCleanup.test.ts`
- `RapidSeekStress.test.ts`
- `StuckDecodeRecovery.test.ts`
- `MultiClipOverlap.playback.test.ts`
- `PerformanceMetrics.test.ts` (if it imports FrameCache / VideoFrameProvider)
- `helpers/mockDemuxer.ts` → `core/media/video/__tests__/helpers/mockDemuxer.ts`

**Stay in** `core/renderer/gpu/__tests__/` (compositing-only tests):

- `VideoLayer.test.ts`, `RenderGraph.test.ts`, `GoldenFrameHash.test.ts`, `RenderSynchronization.test.ts`, etc.

### Import path updates in moved files

Moved media files currently import renderer debug counters:

```ts
// Before (in VideoFrameProvider.ts / DecoderBackedVideoFrameProvider.ts)
import { GpuDebugCounters } from './debug/GpuDebugCounters'

// After
import { GpuDebugCounters } from '../../renderer/gpu/debug/GpuDebugCounters'
```

This is acceptable for Session 1 (zero behavior change). A follow-up may extract counters to a shared debug module.

### Boundary rule

`core/renderer/**` must **not** import from `core/media/**` except:

- The `VideoFrameProvider` **type** import (interface only)
- The `createVideoFrameProvider` factory and related deps passed through `RendererOptions`

Add to ESLint config (create minimal config if none exists):

```js
// packages/editor/eslint.config.js (example)
{
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [{
        group: ['**/core/media/**'],
        message: 'renderer must not import media internals — use VideoFrameProvider interface only',
      }],
    }],
  },
  files: ['src/core/renderer/**/*.ts'],
}
```

If ESLint is not wired yet, add a `// @boundary` comment block to `architecture.md` and a Vitest import-boundary test as a lightweight substitute.

### Barrel export

`packages/editor/src/core/media/video/index.ts`:

```ts
export type { VideoFrameProvider, VideoFrameProviderDeps } from './VideoFrameProvider'
export { createVideoFrameProvider, MockVideoFrameProvider, SyntheticVideoFrameProvider } from './VideoFrameProvider'
export { DecoderBackedVideoFrameProvider } from './DecoderBackedVideoFrameProvider'
export { FrameCache } from './FrameCache'
export type { DemuxerFactory, DemuxerBackend } from './demuxer/MediabunnyDemuxer'
export { createMediabunnyBackend, isMediabunnyCompatible } from './demuxer/createMediabunnyBackend'
```

### Public API update

In `packages/editor/src/index.ts`, change demuxer exports from:

```ts
export { createMediabunnyBackend, ... } from './core/renderer/gpu/demuxer/...'
```

to:

```ts
export { createMediabunnyBackend, ... } from './core/media/video/demuxer/...'
```

`VideoLayer.ts` should import from `../../../media/video/VideoFrameProvider` (or the barrel).

---

## Acceptance criteria

Walk these one by one. They are the review checklist.

1. All files in the **Files to move** table exist at their new paths; old paths are gone.
2. `npm test --workspace=packages/editor` passes with **no test body changes** (import path updates only).
3. `npm run typecheck` passes.
4. Playground builds and runs; video behavior is **identical** to before (still wedged — that is expected).
5. `core/renderer/gpu/` contains no decode implementation files (`FrameCache`, `VideoDecoderManager`, `demuxer/`, etc.).
6. `packages/editor/src/index.ts` public exports point at `core/media/video/`.
7. Boundary rule is documented in `architecture.md` and enforced via ESLint or a substitute test.
8. `git diff --stat` is predominantly renames/moves, not logic edits.

---

## Out of scope (do not do these here)

- Implementing `StreamingFrameProducer`
- Changing `VideoFrameProvider` interface (`requestFrame` → `setPlayhead`)
- Fixing per-frame `decoder.flush()` (OPTIMIZATION.md §1 Bug #3)
- TextLayer, ImageLayer, audio
- Removing `[GPU-TRACE]` console logs (leave as-is or gate behind flag in a separate cleanup)

If you find yourself changing decode logic, **stop**. That belongs in Split-02.

---

## Implementation notes

- Prefer `git mv` so history is preserved.
- Run tests after each batch of import updates, not only at the end.
- `core/media/` already exists for the media library (`importFiles`, `MediaAsset`). Video decode lives at `core/media/video/` — a sibling subfolder, not a replacement.
- Update `gpu/types.ts` to import `DemuxerFactory` from `../../media/video/demuxer/MediabunnyDemuxer`.

---

## Verification

1. **Type-check:** `npm run typecheck` — clean.
2. **Tests:** `npm test --workspace=packages/editor` — all green.
3. **Smoke:** `npm run dev`, open GPU Preview, press Play. Console should show the same `gotFrame=false` pattern as before (bridge still wedged until Split-02).
4. **Boundary:** grep confirms no `core/renderer/**` file imports `DecoderBackedVideoFrameProvider` or `VideoDecoderManager` directly (only `VideoFrameProvider` / factory).

---

## Copy-paste prompt for an implementation agent

```
You are implementing a backlog ticket for the @elah/editor repo.

Ticket: docs/backlog/PR-media-split-01-structural-move.md
Prerequisite: none (first in sequence)

Read in this order before writing any code:
1. docs/backlog/PR-media-split-01-structural-move.md (this ticket — top to bottom)
2. .cursor/plans/media-renderer-split-mvp_c1e1a43a.plan.md — Session 1 section
3. packages/editor/src/core/renderer/gpu/ — identify which files are decode vs compositing

Then implement ONLY the structural move described in the ticket.

Hard constraints:
- ZERO behavior change. No logic edits to decode, cache, or render paths.
- Move files with git mv where possible.
- Update import paths only; do not refactor implementations.
- Do NOT implement StreamingFrameProducer or change VideoFrameProvider interface.
- Frozen surfaces listed in the ticket must not receive logic changes.

Walk the ticket's "Acceptance criteria" section item by item before declaring done.
Run typecheck and the full test suite; both must pass.

If you find a reason to go outside scope, stop and surface the question — do not silently expand the PR.
```
