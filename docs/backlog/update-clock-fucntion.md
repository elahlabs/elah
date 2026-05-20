# Update `PlaybackEngine` to a proper anchor-and-integrate clock

> Standalone ticket. Pick this up cold. Read the whole thing top to bottom; the **copy-paste prompt** at the bottom is what you hand to an AI coding agent.
>
> Companion reading (do not skip):
>
> - [`../../../01-playback-clock-architecture.md`](../../../01-playback-clock-architecture.md) — the design rationale this ticket implements.
> - [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) §3 — the current `PlaybackEngine` contract.

---

## Status

🔴 Not started.

This ticket exists to prepare the clock **before any renderer subscribes to it**. Once a renderer is wired (PR-06 onward), changes to the engine's read API become breaking changes. Land this first.

---

## Goal

Refactor `packages/editor/src/core/playback/PlaybackEngine.ts` from a *frame ticker* (rAF loop that accumulates frames internally) into a *proper anchor-and-integrate clock* (two scalars + a `now()` indirection, queryable at any time).

The rAF loop stays — but it becomes a **sampler** of the clock, not the owner of time.

---

## Why this matters

1. **The renderer will need float frames.** Today `currentFrame` is an integer floored inside the rAF tick. A renderer that does drift correction against `<video>.currentTime` needs sub-frame resolution; that information currently dies inside the closure (`frameAcc` is private to `startRAF`).
2. **Same-frame seeks are silently dropped.** `seek(frame)` returns early when `next === this._frame`. The first time loop-to-start needs to retrigger a one-shot effect (text animation, audio cue, transition reset), this becomes a real bug. Adding `currentFrameEpoch` fixes it.
3. **Audio is coming.** When `AudioContext` lands, the time authority should swap from `performance.now()` to `ctx.currentTime` **without touching any caller**. Introducing a `now()` seam now means that swap is a one-line change later.
4. **React must not throttle the renderer.** A renderer that subscribes through `usePlaybackStore` rides React's coalescing. A renderer that subscribes directly to `PlaybackEngine.subscribe()` doesn't. Both paths must exist; this ticket guarantees the direct path is frame-accurate.
5. **UI time labels don't need 60 Hz.** A separate throttled `timeupdate` event keeps clock-label re-renders at ~10 Hz without affecting frame-accurate consumers.

See [`01-playback-clock-architecture.md`](../../../01-playback-clock-architecture.md) §§2, 6, 10 for the full reasoning.

---

## Scope

**In:**

- `packages/editor/src/core/playback/PlaybackEngine.ts`
- `packages/editor/src/core/playback/PlaybackEngine.test.ts` (new or extend existing)
- `packages/editor/src/stores/playback*` (only if snapshot field additions require it — keep changes mechanical)
- Any call site in `core/` / `timeline/` / `editor/` that consumes `PlaybackSnapshot` (additive changes only — existing fields stay)

**Out:**

- The DOM renderer. This ticket does not create one.
- `AudioContext` integration. Only the `now()` seam is added; audio wiring is deferred until a renderer with audio exists.
- Sync thresholds / drift correction (`SYNC_SOFT_FRAMES`, etc.) — those are renderer concerns.
- `visibilitychange` catch-up logic — the existing 0.25s elapsed clamp already implements a "pause-during-blur" policy that is correct for an editor preview. Document the policy in a comment; do not add new handlers.
- Master/slave authority switching. One authority (free-running off `performance.now()`) is enough.
- Reverse playback, variable per-clip fps, buffering API. Explicitly deferred.

---

## Design

### New internal state

Replace the existing `_frame: number` + `frameAcc: number` (closure-local) + `lastTimestamp: number | null` pair with:

```ts
private anchorFrame: number = 0   // float — frame at the moment of anchoring
private anchorTime: number = 0    // seconds in now()'s basis — when we anchored
private _playing = false
private _rate = 1
private _loop = false
private _epoch = 0                // increments on every transport event
```

`rafId` stays. `lastTimestamp` and `frameAcc` are removed — they are no longer needed because the rAF tick no longer integrates; it only samples `getFrameAt()`.

### The `now()` seam

```ts
private now(): number {
  // TODO(when audio lands): if an AudioContext is attached and state === 'running',
  // return ctx.currentTime. Until then, performance.now()/1000 is the single source.
  return performance.now() / 1000
}
```

Do **not** add `attachAudioContext()` yet. The seam is enough.

For testability, the constructor should optionally accept a `now` override:

```ts
interface PlaybackEngineConfig {
  fps: number
  getTotalFrames: () => number
  now?: () => number   // optional — for tests
}
```

If provided, `this.now = config.now`. This is what makes the engine testable without faking `performance.now()` globally.

### The clock function

```ts
/** Float frame at time t (defaults to now()). The renderer reads this. */
getFrameAt(t: number = this.now()): number {
  if (!this._playing) return this.anchorFrame
  return this.anchorFrame + (t - this.anchorTime) * this.fps * this._rate
}

/** Integer frame for the store / UI. */
get currentFrame(): number {
  return Math.floor(this.getFrameAt())
}
```

Both `getFrameAt` and `currentFrame` work whether playing or paused. When paused, `anchorFrame` *is* the frame — no math needed.

### Transport commands — all re-anchor

Every command that changes the position, rate, or play state must atomically set `(anchorFrame, anchorTime)` together. Doing one without the other produces a jump.

```ts
play(): void {
  if (this._playing) return
  // anchorFrame already holds the frozen position; just re-anchor in time.
  this.anchorTime = this.now()
  this._playing = true
  this._epoch++
  this.notify()
  this.startRAF()
}

pause(): void {
  if (!this._playing) return
  this.anchorFrame = this.getFrameAt()   // freeze current position
  this.anchorTime = this.now()
  this._playing = false
  this._epoch++
  this.notify()
}

seek(frame: number): void {
  const next = Math.max(0, Math.floor(frame))
  // Note: NO same-frame early return. Always bump the epoch so loop-to-start
  // and re-seek-to-same-frame retrigger one-shot effects.
  this.anchorFrame = next
  this.anchorTime = this.now()
  this._epoch++
  this.notify()
}

setPlaybackRate(rate: number): void {
  if (rate === this._rate) return
  this.anchorFrame = this.getFrameAt()
  this.anchorTime = this.now()
  this._rate = rate
  this._epoch++
  this.notify()
}

setLoop(loop: boolean): void {
  if (loop === this._loop) return
  this._loop = loop
  // No re-anchor needed — loop only affects end-of-timeline branching.
  this._epoch++
  this.notify()
}
```

### The rAF tick — now a sampler, not an integrator

```ts
private startRAF(): void {
  if (this.rafId !== null) return

  const tick = () => {
    if (!this._playing) { this.rafId = null; return }
    this.rafId = requestAnimationFrame(tick)

    const f = this.getFrameAt()
    const intF = Math.floor(f)

    const totalF = Math.max(this.getTotalFrames(), this.fps * 10)
    if (intF >= totalF) {
      if (this._loop) {
        // Re-anchor at frame 0 so the integration restarts cleanly.
        this.anchorFrame = 0
        this.anchorTime = this.now()
        this._epoch++
        this.notify()
      } else {
        this.anchorFrame = totalF - 1
        this.anchorTime = this.now()
        this._playing = false
        this.rafId = null
        this._epoch++
        this.notify()
      }
      return
    }

    // Notify only when the integer frame advanced — avoids notify storms on
    // displays running faster than fps (60 Hz display × 30 fps timeline).
    if (intF !== this._lastNotifiedFrame) {
      this._lastNotifiedFrame = intF
      this.notify()
    }
  }

  this._lastNotifiedFrame = Math.floor(this.getFrameAt())
  this.rafId = requestAnimationFrame(tick)
}
```

Add `private _lastNotifiedFrame = 0` to the class.

### Background-tab handling

The previous code clamped `elapsed` to `0.25s` to avoid fast-forwarding a backgrounded tab. With anchor-and-integrate, there's nothing to clamp inside the tick — but the same problem still exists: if the tab is backgrounded for 30 s with `_playing === true`, the first rAF callback on resume will compute `getFrameAt()` against an `anchorTime` that's 30 s in the past, and the playhead will jump.

**Policy for this editor:** treat blur as an implicit pause. On `visibilitychange` → `document.hidden`, re-anchor: `anchorFrame = getFrameAt()`, `anchorTime = now()`. This effectively freezes the position. On return, the next tick advances from the new anchor — no jump.

Add a single `document.addEventListener('visibilitychange', ...)` in the constructor and remove it in `destroy()`. Document the policy choice in a `// Why:` comment.

### Snapshot additions

```ts
export interface PlaybackSnapshot {
  currentFrame: number     // integer (unchanged)
  isPlaying: boolean
  playbackRate: number
  loop: boolean
  epoch: number            // NEW — increments on every transport event
}
```

`epoch` is additive; existing callers ignore it harmlessly. Renderers and effect-firing subscribers use it to detect "this is a new arrival at this frame, not a continuation."

### Two subscription channels

```ts
subscribe(fn: PlaybackListener): () => void          // frame-accurate, fires on every notify()
subscribeTimeupdate(fn: PlaybackListener): () => void // throttled to ~100 ms internally
```

Implementation: keep a separate `Set<PlaybackListener>` for `timeupdate`, plus `private _lastTimeupdateAt = 0`. On every `notify()`, check `now() - _lastTimeupdateAt >= 0.1` before fanning out to the throttled set.

Existing call sites that consume `subscribe()` keep working. The `usePlaybackStore` mirror should keep using `subscribe()` (it already debounces via React state). UI components that display formatted time strings should migrate to `subscribeTimeupdate()` in a follow-up — not in this PR.

---

## Acceptance criteria

Walk these one by one. They are the review checklist.

1. ✅ `PlaybackEngine.ts` no longer accumulates frames inside the rAF closure. `frameAcc` and `lastTimestamp` are gone. State is `(anchorFrame, anchorTime, _playing, _rate, _loop, _epoch)`.
2. ✅ `getFrameAt(t?: number): number` exists and returns a **float** (not floored).
3. ✅ `currentFrame` getter still returns an integer (`Math.floor(getFrameAt())`).
4. ✅ A private `now()` method exists. It returns `performance.now() / 1000` by default. The constructor accepts an optional `now: () => number` override (used by tests).
5. ✅ `play`, `pause`, `seek`, `setPlaybackRate`, `setLoop` all bump `_epoch` and re-anchor where appropriate.
6. ✅ `seek(sameFrame)` **no longer** early-returns. It bumps `_epoch` and notifies. There is a test for this.
7. ✅ `PlaybackSnapshot` has an `epoch: number` field.
8. ✅ `subscribe()` fires only when the integer frame changes (during playback) or on any transport event.
9. ✅ `subscribeTimeupdate()` exists and is throttled to ~100 ms.
10. ✅ `visibilitychange` handler re-anchors on `document.hidden`. It is removed in `destroy()`.
11. ✅ Existing tests still pass. New tests cover:
    - `getFrameAt` returns float during playback.
    - `seek(N); seek(N)` produces two notifications with incrementing epochs.
    - Background-tab simulation (advance fake `now()` by 30 s between ticks, with a `visibilitychange` fire in between) does not jump the playhead.
    - `setPlaybackRate(2)` mid-playback does not produce a frame jump (the frame at the moment of the rate change is preserved).
12. ✅ `Timeline.tsx` and the playback store still work with no source changes (snapshot field is additive).
13. ✅ No new files are created outside `core/playback/`. No `AudioContext`, no `sync-constants.ts`, no `clock-hooks.ts`.
14. ✅ Type-check, lint, and the package test suite all pass.

---

## Out of scope (do not do these here)

- Building a renderer or any consumer of `getFrameAt()`'s float value.
- Wiring `AudioContext.currentTime` as the time source.
- Adding `SYNC_SOFT_FRAMES` / `SYNC_HARD_FRAMES` / preroll logic.
- Refactoring `usePlaybackStore` beyond the additive `epoch` field.
- Renaming this file (`update-clock-fucntion.md` typo) — leave it; references already exist.

If you find yourself reaching into renderer code, **stop**. Open a follow-up ticket.

---

## Implementation notes

- Inject `now` via constructor config rather than reading `performance.now()` directly inside methods. Tests need to drive time deterministically.
- The rAF tick should no longer touch `_frame` directly — there is no `_frame` anymore. It reads `getFrameAt()`, decides whether to notify, and on end-of-timeline updates `anchorFrame` + `anchorTime` together.
- Keep `notify()` synchronous and wrap each listener in a try/catch (`_emit`-style — see [`01-playback-clock-architecture.md`](../../../01-playback-clock-architecture.md) §9). One broken listener must not stall the clock.
- Do not persist `anchorTime` to Zustand. It is process-local. Only `currentFrame`, `playbackRate`, `loop` are persistable. The existing store already follows this — verify it still does.

---

## Verification

1. **Type-check:** `pnpm -F @elah/editor typecheck` (or the repo equivalent) — clean.
2. **Tests:** the new and existing `PlaybackEngine.test.ts` suite passes.
3. **Smoke test in playground:** open `apps/playground`, press Play, scrub the ruler, change rate, toggle loop. Behavior must be visually identical to before this PR — this refactor is a no-op from the user's perspective. The only externally observable change is `snapshot.epoch` advancing.
4. **Background-tab smoke test:** in the playground, press Play, switch to another tab for ~10 s, switch back. The playhead must not jump forward. (Before this PR, the 0.25 s clamp gave the same behavior; after this PR, the `visibilitychange` re-anchor gives it. Same result, different mechanism.)

---

## Copy-paste prompt for an implementation agent

```
You are implementing a backlog ticket for the @elah/editor repo.

Ticket: docs/backlog/update-clock-fucntion.md
Target file: packages/editor/src/core/playback/PlaybackEngine.ts (plus its test file)

Read in this order before writing any code:
1. docs/backlog/update-clock-fucntion.md (this ticket — top to bottom)
2. 01-playback-clock-architecture.md (at the repo root) — §§2, 6, 10
3. video-editor/ARCHITECTURE.md §3 — current contract
4. packages/editor/src/core/playback/PlaybackEngine.ts — current implementation
5. The existing PlaybackEngine test file (if any), and Timeline.tsx where the engine is consumed

Then implement the refactor described in the "Design" section of the ticket.

Hard constraints:
- Do not create any new files outside packages/editor/src/core/playback/.
- Do not touch any renderer or AudioContext code (there is no renderer yet; do not add one).
- Do not change the existing PlaybackSnapshot fields — only add `epoch`.
- All existing call sites must continue to compile and behave identically from the user's perspective. The only externally observable change is the new `epoch` field.
- Inject `now` via constructor config for test determinism.
- Bump `_epoch` on every transport event including same-frame seek.

Walk the ticket's "Acceptance criteria" section item by item before declaring done. Write tests for items 11.a–11.d. Run typecheck and the test suite; both must pass.

If you find a reason to go outside scope, stop and surface the question — do not silently expand the PR.
```
