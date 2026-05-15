# PR-03 · Schema: `Project.stage` + `Clip.transform?`

**Status:** 🔴 Not started
**Risk:** Medium (schema change touches multiple files)
**Estimated effort:** 2–3 hours
**Blocks:** PR-10 (renderer needs to know stage size); future text overlay editor

---

## Goal

Add two schema fields that the renderer (PR-10) will need on day one:

1. `Project.stage: { width: number; height: number }` — the output composition canvas, default `1080×1920` portrait.
2. `Clip.transform?: Transform` — optional normalized position/scale/rotation/anchor. Absent means "cover-fit the stage."

The resolver propagates `transform` (and a derived `effectiveTransform` for the future animation pass) into `ActiveClipBase`. No UI or renderer work here — just the data shapes the renderer will consume.

## Why this PR matters

Schema changes are cheapest **before** consumers exist. Today, only the resolver and the timeline UI read these types. After PR-04 (MediaLibrary), PR-05 (EditorProvider), and PR-10 (renderer), changing the schema means coordinating 5+ files. Lock the shape now.

## Scope

| File | Change |
|---|---|
| `packages/timeline/src/types/index.ts` | Add `Transform` type; add `stage` to `Project`; add `transform?` to `Clip` |
| `packages/timeline/src/core/editor/TimelineEngine.ts` | Default `stage` in `buildEmptyProject`; accept optional `stage` in `TimelineConfig` |
| `packages/timeline/src/core/elements/base.ts` | Pass `transform` through in clip factory (no default; remains optional) |
| `packages/timeline/src/core/resolver/scene.ts` | Add optional `transform` to `ActiveClipBase`; export `Transform` type |
| `packages/timeline/src/core/resolver/resolveTimeline.ts` | Pass `clip.transform` through to `ActiveClipBase.transform` |
| `packages/timeline/src/core/resolver/resolveTimeline.test.ts` | Add 1 test for `transform` passthrough (optional but recommended) |
| `packages/timeline/src/index.ts` | Export `Transform` type |
| `docs/glossary.md` | Confirm "Stage" and "Transform" entries are still accurate after this PR |

## Acceptance criteria

- [ ] `Project.stage: { width: number; height: number }` exists. New projects default to `{ width: 1080, height: 1920 }`.
- [ ] `TimelineConfig` (passed to `new TimelineEngine(...)`) accepts an optional `stage`; if omitted, `1080×1920` is used.
- [ ] `Clip.transform?: Transform` exists where `Transform = { x: number; y: number; scale: number; rotation: number; anchor: { x: number; y: number } }`. All fields are numbers; **`x`, `y`, `anchor.x`, `anchor.y` are normalized 0..1**; `scale` is unitless (1 = native); `rotation` is in radians.
- [ ] `Clip.transform` is optional everywhere (no default, no required init). Existing code that constructs clips without it keeps working.
- [ ] `ActiveClipBase.transform?: Transform` exists in `scene.ts`. When `clip.transform` is set, the resolver puts it on the active clip. When absent, the resolver leaves it absent (no default object).
- [ ] `Transform` is exported from the public API in `index.ts`.
- [ ] All existing tests (PR-02) still pass.
- [ ] No render-time behavior changes (no renderer exists yet).
- [ ] `npx tsc --noEmit` passes.
- [ ] Playground continues to work without modification.

## Out of scope

- **No `effectiveTransform`** in this PR. That's for the future animation/keyframes work.
- **No animation/keyframes types.** No `TextAnimation`, no `Keyframe<T>`.
- **No interactive gizmo UI.** That's a much later PR.
- **No renderer changes.** PR-10 will consume `transform`.
- **No automatic "cover-fit" computation.** Resolver passes `transform` through as-is; the renderer decides what `undefined` means.
- **No migrations / persistence updates** — there's no persistence yet.
- **No multi-resolution preset UI** — `stage` is a single project-level value.

## Implementation notes

### Type definitions

```ts
// packages/timeline/src/types/index.ts

/**
 * 2D transform on the stage. All position values are NORMALIZED 0..1
 * (relative to stage width/height) so transforms are resolution-independent.
 *
 *   x, y       — clip center position; (0,0) = top-left, (1,1) = bottom-right.
 *   scale      — uniform scale; 1 = native fit.
 *   rotation   — radians; positive = clockwise.
 *   anchor     — 0..1 within the clip's own bounding box; (0.5, 0.5) = center.
 *                Determines the pivot point for scale and rotation.
 */
export interface Transform {
  x: number
  y: number
  scale: number
  rotation: number
  anchor: { x: number; y: number }
}

export interface Project {
  id: string
  fps: number
  /**
   * Output composition canvas size, in pixels. Renderers use this to
   * size their output and to project normalized Transform values.
   * Default: { width: 1080, height: 1920 } (portrait 9:16).
   */
  stage: { width: number; height: number }
  tracks: Track[]
  clips: Record<string, Clip[]>
  version: number
}

export interface Clip {
  // ...existing fields...
  /**
   * Optional per-clip transform. When absent, renderers default to
   * "cover-fit the stage with center anchor". See Transform.
   */
  transform?: Transform
}
```

### Default in `buildEmptyProject`

```ts
function buildEmptyProject(fps: number, stage: { width: number; height: number }): Project {
  // ...
  return {
    id: generateId(),
    fps,
    stage,
    tracks: [firstTrack],
    clips: {},
    version: 1,
  }
}
```

### `TimelineConfig` update

```ts
export interface TimelineConfig {
  fps: number
  stage?: { width: number; height: number }   // default { width: 1080, height: 1920 }
  defaultTrackHeight?: number
  maxHistorySize?: number
}
```

In the constructor:
```ts
const stage = config.stage ?? { width: 1080, height: 1920 }
this.project = buildEmptyProject(config.fps, stage)
```

### Resolver pass-through

In `resolveTimeline.ts`, inside the per-clip branches, copy `transform` onto the active clip object when it exists:

```ts
const active: ActiveVideoClip = {
  type: 'video',
  // ...existing fields...
  ...(clip.transform ? { transform: clip.transform } : {}),
}
```

Keep it conditional so `transform` is genuinely optional in the output too (no `undefined` literals on the wire).

### Optional test (recommended)

Add a 6th `it(...)` to `resolveTimeline.test.ts`:

```ts
it('passes Clip.transform through to ActiveClipBase.transform', () => {
  const transform = { x: 0.5, y: 0.5, scale: 1.5, rotation: 0, anchor: { x: 0.5, y: 0.5 } }
  const project = makeProject({
    tracks: [makeTrack()],
    clips: { t1: [makeClip({ transform })] },
  })
  const scene = resolveTimeline(0, project)
  expect(scene.videos[0].transform).toEqual(transform)
})
```

## Verification

1. `npx tsc --noEmit` — clean.
2. `npm run test` — all 6 (or 5+1) tests pass.
3. In the playground, add tracks, add clips, play, undo — nothing changes user-visibly. Confirm by `console.log(engine.getProject())` that `stage: { width: 1080, height: 1920 }` is present and clips have no `transform` field unless explicitly set.

---

## Copy-paste prompt for the implementation agent

```text
You are working on @myeditor/timeline. Your job is to add two schema fields:
Project.stage and Clip.transform?. No UI, no renderer, no animation — just
types + the resolver pass-through.

REPO: d:/opensource/ReferenceProjects/MyEditorPackage

HARD CONSTRAINTS:
- Do NOT add new packages, plugins, or abstractions.
- Do NOT add animation / keyframe types in this PR.
- Do NOT change the resolver's runtime behavior beyond passing `transform` through.
- Do NOT touch any UI code. Playground continues to work as-is.
- All fields and types remain TS-strict.

================================================================
TASK 1 — Define Transform and update Project / Clip
================================================================
File: packages/timeline/src/types/index.ts

Add:

  export interface Transform {
    x: number              // normalized 0..1 (relative to stage width)
    y: number              // normalized 0..1 (relative to stage height)
    scale: number          // unitless; 1 = native
    rotation: number       // radians; positive = clockwise
    anchor: { x: number; y: number }  // 0..1 within the clip's own bbox
  }

Add to Project:
  stage: { width: number; height: number }

Add to Clip:
  transform?: Transform                  // optional everywhere

Update the JSDoc on Project to mention `stage` and on Clip to mention
`transform` (one-line each is fine).

================================================================
TASK 2 — Default Project.stage to portrait 1080x1920
================================================================
File: packages/timeline/src/core/editor/TimelineEngine.ts

Update TimelineConfig:
  export interface TimelineConfig {
    fps: number
    stage?: { width: number; height: number }   // default 1080x1920
    defaultTrackHeight?: number
    maxHistorySize?: number
  }

In the constructor:
  const stage = config.stage ?? { width: 1080, height: 1920 }
  this.project = buildEmptyProject(config.fps, stage)

Update buildEmptyProject's signature accordingly.

================================================================
TASK 3 — Pass clip.transform through the resolver
================================================================
Files:
  packages/timeline/src/core/resolver/scene.ts
  packages/timeline/src/core/resolver/resolveTimeline.ts

In scene.ts, add an optional field to ActiveClipBase:
  transform?: Transform   // import from ../../types

Export Transform from scene.ts (re-export) OR keep it importable from
types/index.ts — either is fine, but make sure index.ts exports it for
the public API.

In resolveTimeline.ts, in each of the four "if (clip.type === 'X')"
branches that build an ActiveXxxClip, conditionally include the
transform:
  ...(clip.transform ? { transform: clip.transform } : {}),

DO NOT default to any transform when `clip.transform` is undefined.
Leave it undefined; the renderer (later) decides what undefined means.

================================================================
TASK 4 — Export Transform from the package
================================================================
File: packages/timeline/src/index.ts

Add Transform to the Types section export list.

================================================================
TASK 5 — Add 1 resolver test (recommended)
================================================================
File: packages/timeline/src/core/resolver/resolveTimeline.test.ts

Add a 6th test:

  it('passes Clip.transform through to ActiveClipBase.transform', () => {
    const transform = {
      x: 0.5, y: 0.5, scale: 1.5, rotation: 0,
      anchor: { x: 0.5, y: 0.5 }
    }
    const project = makeProject({
      tracks: [makeTrack()],
      clips: { t1: [makeClip({ transform })] },
    })
    const scene = resolveTimeline(0, project)
    expect(scene.videos[0].transform).toEqual(transform)
  })

================================================================
VERIFICATION
================================================================
1. npx tsc --noEmit  → clean
2. npm run test     → all tests (including the new one) pass
3. In apps/playground, npm run dev:
   - Add a video track, add a clip, play, undo, redo, split, trim. All
     existing interactions still work.
   - console.log(engine.getProject()) shows
     `stage: { width: 1080, height: 1920 }`.
   - Clips have no `transform` field unless you explicitly set one
     (which the playground doesn't).

================================================================
DELIVERABLE
================================================================
A commit titled:
  types: add Project.stage and optional Clip.transform

================================================================
NON-GOALS
================================================================
- No keyframes / animations.
- No interactive transform UI / gizmo.
- No renderer changes.
- No multi-resolution preset support.
- No migration code for persisted projects (there's no persistence yet).
- Don't compute an "effective transform" or interpolate anything.
```
