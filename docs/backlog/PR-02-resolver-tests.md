# PR-02 · `resolveTimeline` tests

**Status:** 🔴 Not started
**Risk:** Low
**Estimated effort:** 1–2 hours
**Blocks:** PR-10 (renderer; the resolver runs under it 60×/sec)

---

## Goal

Add the first test suite to the repo, covering `resolveTimeline`. Lock in correctness before the renderer makes resolver bugs invisible at 60fps.

## Why this PR matters

`resolveTimeline` is the single bridge between data and rendering. The moment a renderer exists, every resolver bug masquerades as a renderer bug. With ~5 focused tests we get:

- Regression protection across all future PRs.
- A working test runner (`vitest`) that subsequent PRs can extend.
- Living documentation of the resolver's contract.

## Scope

| File | Change |
|---|---|
| `packages/timeline/package.json` | Add `vitest` to devDependencies, add `"test"` script |
| `packages/timeline/vitest.config.ts` (new) | Minimal vitest config |
| `packages/timeline/src/core/resolver/resolveTimeline.test.ts` (new) | 5 tests |
| `packages/timeline/tsconfig.json` | Add `"vitest/globals"` to `types` if using globals (optional; use explicit imports instead to avoid noise) |
| `package.json` (root) | Add `"test"` script that runs workspace tests |

## Acceptance criteria

- [ ] `vitest` is installed as a devDependency in `packages/timeline`.
- [ ] `npm run test` (root) runs the test suite; `npm run test --workspace=packages/timeline` works.
- [ ] All five tests below pass.
- [ ] No new runtime dependencies (only devDependencies).
- [ ] `npx tsc --noEmit` still passes.

### The five tests

1. **Empty / no active clips** — empty project returns a Scene with `frame` set correctly and all arrays empty (`videos.length === 0`, etc., and `transitions: []`).
2. **Single video clip presence/absence** — clip at `[10, 50)` (`startFrame=10`, `durationFrames=40`):
   - Query at `frame=10` → present.
   - Query at `frame=49` → present.
   - Query at `frame=50` → absent (half-open interval).
   - Query at `frame=9` → absent.
3. **Z-index ordering** — two video tracks, `order=0` and `order=1`, both with a clip at frame 0. Scene `videos` array must have:
   - Length 2.
   - The `order=1` track's clip first in the array (lower zIndex, back).
   - The `order=0` track's clip last in the array (higher zIndex, front).
4. **Track flags** —
   - `track.muted=true` on a video track → emitted clip has `volume: 0`.
   - `track.muted=true` on an audio track → emitted clip has `volume: 0`.
   - `track.disabled=true` → no clips from that track appear at all.
   - `clip.disabled=true` → that specific clip is absent.
5. **Solo** — video track A has `solo=true`, video track B does not. Both have clips at frame 0.
   - Only A's clip appears in `videos`.
   - Audio tracks (with no solo) are unaffected.

## Out of scope

- Don't add coverage tooling (`c8`, `istanbul`).
- Don't add component tests (`Timeline.tsx`, etc.).
- Don't add tests for `TimelineEngine`, `PlaybackEngine`, visitors, or stores — those are separate PRs.
- Don't add property-based testing (`fast-check`) — overkill.
- Don't add `sourceFrame` math tests — those belong with a `trimClip` test pass in a future PR.

## Implementation notes

### `vitest` setup (minimal)

```jsonc
// packages/timeline/package.json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "vitest": "^2.1.0"
  }
}
```

```ts
// packages/timeline/vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',  // resolver is pure; no DOM needed
    include: ['src/**/*.test.ts'],
  },
})
```

```jsonc
// package.json (root) — add to scripts
{
  "scripts": {
    "test": "npm run test --workspace=packages/timeline"
  }
}
```

### Test helper for building a project

Don't import the engine; build `Project` shapes directly so the tests are pure and fast:

```ts
function makeProject(overrides?: Partial<Project>): Project {
  return {
    id: 'p1',
    fps: 30,
    tracks: [],
    clips: {},
    version: 1,
    ...overrides,
  }
}

function makeTrack(overrides?: Partial<Track>): Track {
  return {
    id: overrides?.id ?? 't1',
    name: 'T',
    kind: 'video',
    order: 0,
    height: 64,
    locked: false,
    disabled: false,
    muted: false,
    solo: false,
    ...overrides,
  }
}

function makeClip(overrides?: Partial<Clip>): Clip {
  return {
    id: 'c1',
    trackId: 't1',
    type: 'video',
    name: 'C',
    startFrame: 0,
    durationFrames: 30,
    sourceStartFrame: 0,
    sourceDurationFrames: 30,
    src: 'fake.mp4',
    ...overrides,
  }
}
```

### Test structure (one suggested layout)

```ts
import { describe, it, expect } from 'vitest'
import { resolveTimeline } from './resolveTimeline'
import type { Project, Track, Clip } from '../../types'

describe('resolveTimeline', () => {
  it('returns an empty scene for an empty project', () => { ... })
  it('includes a clip only when frame is inside its half-open range', () => { ... })
  it('orders overlapping clips with higher track.order at the back', () => { ... })
  it('honors track and clip flags (muted, disabled)', () => { ... })
  it('excludes non-solo tracks of the same kind when solo is set', () => { ... })
})
```

Keep each test small (~10–20 lines).

## Verification

1. `cd packages/timeline && npm install` (installs vitest).
2. `npx tsc --noEmit` — clean.
3. `npm run test` (root or workspace) — all 5 tests pass.
4. `npm run test:watch` works for local iteration.

---

## Copy-paste prompt for the implementation agent

```text
You are working on @myeditor/timeline. Your job is to add the first test
suite to the repo, covering resolveTimeline. No other tests, no other
files.

REPO: d:/opensource/ReferenceProjects/MyEditorPackage
PRIMARY FILE TO CREATE: packages/timeline/src/core/resolver/resolveTimeline.test.ts
ADDITIONAL FILES:
  - packages/timeline/vitest.config.ts (new)
  - packages/timeline/package.json (add vitest devDep + script)
  - package.json (root, add `test` script that runs the workspace's test)

HARD CONSTRAINTS:
- Use vitest. No jest, no mocha.
- Tests run in `node` environment (resolver is pure; no DOM needed).
- No new runtime dependencies. vitest only as devDep.
- Don't import TimelineEngine in tests — build Project/Track/Clip shapes
  inline. Keeps tests pure and fast.
- Write EXACTLY 5 tests, listed below. Do not add more.

================================================================
THE 5 TESTS (one `it(...)` each)
================================================================

1. "returns an empty scene for an empty project"
   - Input: project with `tracks: []`, `clips: {}`, fps 30.
   - Query: resolveTimeline(0, project).
   - Assert: frame === 0; videos / audios / texts / images / transitions
     all have length 0.

2. "includes a clip only when frame is inside its half-open range"
   - Input: 1 video track, 1 video clip with startFrame=10,
     durationFrames=40, sourceStartFrame=0, sourceDurationFrames=40,
     src='fake.mp4'.
   - Assert at frame=9:  videos.length === 0
   - Assert at frame=10: videos.length === 1
   - Assert at frame=49: videos.length === 1
   - Assert at frame=50: videos.length === 0 (half-open: < end, not <=)

3. "orders overlapping clips with higher track.order at the back"
   - Input: 2 video tracks. Track A has order=0, Track B has order=1.
     Each has a video clip at startFrame=0, durationFrames=30,
     sourceStartFrame=0, sourceDurationFrames=30, src present.
   - Query: resolveTimeline(0, project).
   - Assert: videos.length === 2.
   - Assert: videos[0].trackId === Track B's id   (lower zIndex, back)
   - Assert: videos[1].trackId === Track A's id   (higher zIndex, front)
   - Assert: videos[0].zIndex < videos[1].zIndex

4. "honors track and clip flags (muted, disabled)"
   - Sub-assertions (use one project with multiple tracks, or 4 separate
     small projects — your choice):
     a) Track with muted=true containing a video clip → resolved
        videos[0].volume === 0.
     b) Track with muted=true containing an audio clip → resolved
        audios[0].volume === 0.
     c) Track with disabled=true → no clips from that track appear
        anywhere in the scene.
     d) Clip with disabled=true → that specific clip is absent (but
        other clips on the same track are still present).

5. "excludes non-solo tracks of the same kind when solo is set"
   - Input: 2 video tracks A and B, both with a clip at frame 0.
     Track A has solo=true. Also 1 audio track with an audio clip at
     frame 0, solo=false.
   - Query: resolveTimeline(0, project).
   - Assert: videos.length === 1; videos[0].trackId === Track A's id.
   - Assert: audios.length === 1 (audio is unaffected by video solo).

================================================================
SETUP DETAILS
================================================================

vitest.config.ts:
  import { defineConfig } from 'vitest/config'
  export default defineConfig({
    test: { environment: 'node', include: ['src/**/*.test.ts'] },
  })

packages/timeline/package.json — add:
  "scripts": { "test": "vitest run", "test:watch": "vitest" }
  "devDependencies": { "vitest": "^2.1.0" }

Root package.json — add to scripts:
  "test": "npm run test --workspace=packages/timeline"

Inside the test file, define small helpers makeProject() / makeTrack() /
makeClip() with sensible defaults; spread overrides on top. Don't export
these from the project — they're test-local.

================================================================
VERIFICATION
================================================================
1. cd packages/timeline && npm install
2. npx tsc --noEmit  → clean
3. npm run test (from root)  → all 5 tests pass

================================================================
DELIVERABLE
================================================================
A commit titled:
  tests: add resolveTimeline suite

================================================================
NON-GOALS
================================================================
- Don't add tests for other modules.
- Don't add coverage tooling.
- Don't add property-based / fuzz tests.
- Don't reorganize the existing source.
- Don't change resolveTimeline itself.
```
