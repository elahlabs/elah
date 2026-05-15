# PR-01 · Engine invariants: `moveClip` + `trimClip`

**Status:** 🔴 Not started
**Risk:** Low
**Estimated effort:** 1–2 hours
**Blocks:** PR-04 (DnD will hit these immediately)

---

## Goal

Tighten two existing methods on `TimelineEngine` so they enforce the same invariants that `addClip` / `updateClip` already enforce. Today both have correctness gaps that will become user-visible the moment drag/drop is wired up.

## Why this PR matters

- `moveClip` does **not** validate overlap. Two clips on the same track can occupy the same frame range; the resolver picks an arbitrary winner.
- `trimClip` does **not** advance `sourceStartFrame` on left-edge trims. The renderer will play the wrong source frame after a left trim. `split.ts` already has the correct math; we need it here too.

PR-04 (gallery + DnD) will exercise both functions repeatedly. Fixing them now means the gallery work doesn't surface "is this a DnD bug or an engine bug?" ambiguity later.

## Scope

| File | Change |
|---|---|
| `packages/timeline/src/core/editor/TimelineEngine.ts` | `moveClip`: add overlap validation; `trimClip`: update `sourceStartFrame` on left trim |
| `packages/timeline/src/core/visitor/move.ts` (optional, new) | Extract `moveClip` visitor if it gets large enough to warrant |
| `packages/timeline/src/core/visitor/add.ts` (read-only ref) | Look at how `addClip` validates overlap and mirror the pattern |
| `packages/timeline/src/core/visitor/split.ts` (read-only ref) | Look at how `splitClip` computes `sourceStartFrame` for the right half |

## Acceptance criteria

- [ ] `engine.moveClip(clipId, fromTrackId, toTrackId, startFrame)` rejects the move (silently or with a logged warning — be consistent with `addClip`) when the destination range `[startFrame, startFrame + durationFrames)` overlaps another clip on the target track. The clip stays in its original location and history is unchanged.
- [ ] `engine.moveClip` continues to work normally when the destination is free.
- [ ] `engine.moveClip` continues to work for cross-track moves when the destination on the new track is free.
- [ ] `engine.trimClip(clipId, trackId, startFrame, durationFrames)` with a **left-edge trim** (i.e. `newStartFrame > oldStartFrame`) advances `sourceStartFrame` by exactly `newStartFrame - oldStartFrame`.
- [ ] `engine.trimClip` with a **right-edge trim** (i.e. `newStartFrame === oldStartFrame`) leaves `sourceStartFrame` unchanged.
- [ ] Text clips (which have no real source media) skip the `sourceStartFrame` adjustment and continue to allow free trimming.
- [ ] All existing playground interactions still work (move clips around, trim by drag handles, undo/redo).
- [ ] `npx tsc --noEmit` passes.

## Out of scope

- Don't change the public signature of either method.
- Don't refactor `addClip` / `updateClip` / `splitClip`.
- Don't add overlap *resolution* (snap-to-edge) — that's a UI concern handled by `utils/snap.ts`. The engine just rejects.
- Don't write tests in this PR. PR-02 is the testing pass.
- Don't modify other visitors.

## Implementation notes

### `moveClip` overlap check

Two valid implementations:

**Option A — extract a helper:**
```ts
// in utils/frames.ts or a new visitor/overlap.ts
export function rangeOverlapsExistingClips(
  clips: Clip[],
  startFrame: number,
  durationFrames: number,
  excludeId?: string,
): boolean { ... }
```
Then `moveClip`, `addClip`, `updateClip` all call it. **Preferred** but slightly more diff.

**Option B — inline check inside `moveClip`:**
Mirror the logic from `addClip`'s visitor inline. Smaller diff, light duplication.

Either is acceptable. If Option A: extract first as a separate refactor commit inside the PR.

### `trimClip` left-edge logic

```ts
// Pseudocode
const oldStart = existing.startFrame
const newStart = Math.max(0, toFrame(startFrame))
const startDelta = newStart - oldStart

const isTextClip = existing.type === 'text'
const sourceStartFrame = isTextClip
  ? existing.sourceStartFrame
  : Math.max(0, existing.sourceStartFrame + startDelta)

updateClip(draft, clipId, trackId, {
  startFrame: newStart,
  durationFrames: clampedDuration,
  sourceStartFrame,
})
```

Notes:
- `startDelta` is **negative** for right-trim and **positive** for left-trim. The formula above handles both correctly.
- Don't let `sourceStartFrame` go below 0 (the `Math.max(0, ...)` guard). If a user tries to drag the left edge past the source's beginning, clamp.
- The existing duration clamp (against `sourceDurationFrames`) stays as-is.

### Reference: `split.ts`

```ts
// The right half after split:
right.startFrame = atFrame
right.durationFrames = leftDuration - leftPart
right.sourceStartFrame = original.sourceStartFrame + leftPart
```

The arithmetic for left-edge trim is the same shape: shift `sourceStartFrame` forward by the amount the timeline start advanced.

## Verification

1. `cd packages/timeline && npx tsc --noEmit` — must be clean.
2. In `apps/playground`, run `npm run dev`.
3. Add a video track, add 2 clips with a gap, drag the right one left until it would overlap → move is rejected, clip snaps back to its original spot (or whichever no-op behavior you implemented).
4. Add a clip, drag its left handle to the right — the visible clip duration shrinks, and (once a renderer is built in PR-10) the playback will start from a later source frame.
5. Right-trim the same clip → only duration changes; left edge stays put.
6. Undo all the above with Ctrl+Z — each step reverts cleanly.
7. Split a clip with `S` while selected — confirm both halves still play correct source ranges (verified by `console.log` of `engine.findClip(...)?.clip.sourceStartFrame`).

---

## Copy-paste prompt for the implementation agent

```text
You are working on @myeditor/timeline inside the MyEditorPackage repo. Your job
is to fix two correctness bugs in TimelineEngine.

REPO: d:/opensource/ReferenceProjects/MyEditorPackage
PRIMARY FILE: packages/timeline/src/core/editor/TimelineEngine.ts

HARD CONSTRAINTS:
- Do NOT add new packages, plugins, or abstractions.
- Do NOT change the public signature of moveClip or trimClip.
- Do NOT touch addClip / updateClip / splitClip implementations.
- Do NOT add tests in this PR (tests come in PR-02).
- Keep the diff small and reviewable.

================================================================
TASK 1 — moveClip must validate overlap
================================================================
Currently TimelineEngine.moveClip (around lines 212-233) splices a clip out
of its source track and pushes it into the destination track without
checking if the destination range overlaps an existing clip.

addClip and updateClip both run an overlap check via their visitors. Mirror
that behavior in moveClip.

Required behavior:
- If [startFrame, startFrame + durationFrames) overlaps another clip on the
  destination track, the move is REJECTED. The clip stays where it was, no
  history entry is recorded, no event is emitted.
- If no overlap, the move proceeds as before, including cross-track moves.

Implementation approach (pick one):
  A. Extract a helper `rangeOverlapsExistingClips(clips, start, duration,
     excludeId?)` and use it in moveClip, addClip's visitor, and updateClip's
     visitor. Preferred.
  B. Inline the check inside moveClip, mirroring the logic from
     packages/timeline/src/core/visitor/add.ts.

If you choose A, do the extraction as a separate commit inside the PR.

================================================================
TASK 2 — trimClip must update sourceStartFrame on left trim
================================================================
Currently TimelineEngine.trimClip (around lines 245-268) updates startFrame
and durationFrames but never touches sourceStartFrame. This is wrong for
left-edge trims: the timeline start shifted forward but the source window
didn't, so the renderer will play the wrong source frame.

The math is the same as split.ts. Look at how splitClip computes the right
half's sourceStartFrame; do the equivalent here.

Required behavior:
- Let startDelta = newStartFrame - existing.startFrame.
- If existing.type === 'text', skip the source adjustment (text clips have
  no real source media — they can grow/shrink freely).
- Otherwise, set sourceStartFrame = max(0, existing.sourceStartFrame + startDelta).
- Keep the existing duration clamp (against sourceDurationFrames) intact.

================================================================
VERIFICATION (do all of these before declaring done)
================================================================
1. Run `npx tsc --noEmit` from packages/timeline. Must be clean.
2. Manually exercise apps/playground:
   - Add a video track + 2 clips with a gap. Try to drag one onto the other.
     The move must fail silently (clip snaps back).
   - Trim a clip's left edge to the right. Verify (by logging
     engine.findClip(id)?.clip) that sourceStartFrame advanced.
   - Trim the right edge. Verify sourceStartFrame is unchanged.
   - Undo all of the above with Ctrl+Z — each step reverts cleanly.

================================================================
DELIVERABLE
================================================================
A commit (or PR) titled:
  engine: enforce overlap on moveClip and fix trimClip source offset

with a body describing both fixes in 2-4 sentences.

================================================================
NON-GOALS
================================================================
- Do not add tests.
- Do not change moveClip's signature.
- Do not implement snap-to-edge or overlap "resolution" — engine just rejects.
- Do not refactor unrelated code "while you're in there".
```
