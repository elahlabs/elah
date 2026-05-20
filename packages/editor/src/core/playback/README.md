# `core/playback`

The playback subsystem owns **time** for the editor. It answers one question for every other system in the codebase:

> _"What frame are we on right now?"_

Everything else — the playhead needle, the timeline ruler, future renderers, audio, one-shot effects — is a consumer of the answer this module produces.

---

## What lives here

| File | Purpose |
| --- | --- |
| [`PlaybackEngine.ts`](./PlaybackEngine.ts) | The clock. Framework-agnostic. No React, no Zustand. |
| [`PlaybackEngine.test.ts`](./PlaybackEngine.test.ts) | Unit tests, including the acceptance scenarios for the anchor-and-integrate refactor. |

The engine is wired to React state by [`editor/EditorProvider.tsx`](../../editor/EditorProvider.tsx) and consumed by [`timeline/Playhead.tsx`](../../timeline/Playhead.tsx) via the `usePlaybackStore` mirror.

---

## Mental model: anchor-and-integrate

The engine stores just two scalars and integrates from them on demand:

```
anchorFrame  — the float frame at the moment we last anchored
anchorTime   — the value of now() at that same moment
```

Given a time `t` (in `now()`'s basis), the float frame is:

```
frame(t) = anchorFrame + (t - anchorTime) * fps * rate     (while playing)
frame(t) = anchorFrame                                      (while paused)
```

This means time is a **pure function of two scalars + `now()`**. There is no internal frame counter that ticks forward and accumulates drift — the rAF loop only _samples_ this function and decides whether to notify subscribers.

Every transport event (`play`, `pause`, `seek`, `setPlaybackRate`, `setLoop`, end-of-timeline) **re-anchors atomically**: `anchorFrame` and `anchorTime` are updated together so the integration restarts from a known point. Doing one without the other would produce a visible jump.

### Why this matters

1. **Sub-frame precision** — `getFrameAt()` returns a float. A future renderer doing drift correction against `<video>.currentTime` needs that resolution; integer frames would throw it away.
2. **Repeatable one-shot effects** — `seek(N)` after already being on frame `N` still bumps `epoch` and notifies. Loop-to-start, text-animation re-triggers, audio cues all rely on this.
3. **Audio-ready** — the engine reads time through a private `now()` seam. When `AudioContext` lands, the seam swaps to `ctx.currentTime` and no caller changes.
4. **Background-tab safe** — the `visibilitychange` handler freezes the integrated position on hide and re-anchors time on show, so a 30-second blur never advances the playhead.

---

## Public API

```ts
new PlaybackEngine({ fps, getTotalFrames, now? })
```

| Member | Type | What it does |
| --- | --- | --- |
| `play()` | `() => void` | Begin integrating from the current `anchorFrame`. Starts rAF. Bumps `epoch`. |
| `pause()` | `() => void` | Freeze `anchorFrame` at the current float position. Stops rAF. Bumps `epoch`. |
| `seek(frame)` | `(n: number) => void` | Jump to integer `frame`. **No same-frame early return** — always bumps `epoch`. |
| `setPlaybackRate(rate)` | `(r: number) => void` | Change rate without jumping the current frame. Bumps `epoch`. |
| `setLoop(loop)` | `(b: boolean) => void` | Toggle wrap-at-end behavior. Bumps `epoch`. |
| `getFrameAt(t?)` | `(t?: number) => number` | **Float** frame at time `t` (defaults to `now()`). The renderer reads this. |
| `currentFrame` | `number` (getter) | `Math.floor(getFrameAt())` — for the store and UI. |
| `currentTime` | `number` (getter) | `currentFrame / fps`, in seconds. |
| `isPlaying`, `playbackRate`, `loop` | getters | Current state. |
| `subscribe(fn)` | `(fn) => () => void` | Frame-accurate channel. Fires on every transport event and on every integer-frame advance during playback. |
| `subscribeTimeupdate(fn)` | `(fn) => () => void` | Throttled (~100 ms) channel. For UI labels that show "00:01.23" — they don't need 60 Hz. |
| `destroy()` | `() => void` | Cancels rAF, removes the `visibilitychange` listener, clears subscribers. **Always call on unmount.** |

### The snapshot

```ts
interface PlaybackSnapshot {
  currentFrame: number   // integer
  isPlaying: boolean
  playbackRate: number
  loop: boolean
  epoch: number          // monotonically increasing; bumped on every transport event
}
```

`epoch` is the discriminator subscribers use to detect _"this is a new arrival at this frame, not a continuation"_. Two consecutive `seek(10)` calls produce two notifications with two different `epoch` values, even though `currentFrame` did not change.

---

## Subscription model

Two channels exist because two different consumer profiles do:

```
            ┌──────────────────────────────┐
            │       PlaybackEngine         │
            └──────────────┬───────────────┘
                           │ notify()
            ┌──────────────┴───────────────┐
            ▼                              ▼
   subscribe() — frame-accurate    subscribeTimeupdate() — ~10 Hz
   • Playhead needle               • Clock-label components
   • Renderers (future)            • Status strings
   • Effect firing
```

`subscribe()` fires:

- on every transport event (`play`/`pause`/`seek`/`setPlaybackRate`/`setLoop`/loop-wrap/end-of-timeline),
- on every **integer-frame advance** during playback (not every rAF — a 60 Hz display sampling a 30 fps timeline only notifies 30 times/s).

`subscribeTimeupdate()` is rate-limited to one notification per ~100 ms, sharing the same snapshot as `subscribe()`.

---

## Time source — the `now()` seam

```ts
private now: () => number   // returns seconds
```

By default, `performance.now() / 1000`. The constructor accepts an override:

```ts
new PlaybackEngine({ fps, getTotalFrames, now: () => myClock })
```

This is used by tests to drive time deterministically, and is the hook where `AudioContext.currentTime` will plug in once audio lands.

---

## Lifecycle

The engine is constructed once per editor session by [`EditorProvider.tsx`](../../editor/EditorProvider.tsx) and torn down via `destroy()` on unmount. The provider also wires the two-way bridge between the engine and `usePlaybackStore`:

- **Engine → store**: `subscribe()` mirrors `currentFrame` and `isPlaying` into Zustand, guarded so a rAF tick on the same integer frame does not bump the store epoch.
- **Store → engine**: external `play`/`pause`/`seek`/`setPlaybackRate`/`setLoop` calls coming from UI components flow through the store; the provider's store-subscriber translates them back into engine commands.

This bidirectional wiring is intentional. Direct subscribers (renderers, the playhead) bypass React's coalescing for frame accuracy; UI components that only need to re-render on state changes ride the store.

---

## Background-tab policy

When `document.hidden` becomes `true` while playing:

- `anchorFrame` is set to the current integrated position,
- `anchorTime` is set to `now()`,
- `getFrameAt()` returns the frozen `anchorFrame` for the duration of the hide.

When `document.hidden` becomes `false`:

- `anchorTime` is reset to `now()` — integration resumes from the frozen frame with no catch-up.

This produces the same user-visible behavior as the old "clamp elapsed to 0.25s" hack: a tab switched away for 30 seconds returns to exactly where it left off, not 30 seconds further along.

---

## Out of scope (intentionally)

- **Rendering.** This module produces time; it does not paint pixels.
- **Audio.** No `AudioContext` wiring yet — only the `now()` seam that prepares for it.
- **Sync / drift correction.** A renderer that drives `<video>.currentTime` will own its own sync thresholds.
- **Reverse playback, variable per-clip fps, buffering.** Not modeled.

See [`docs/backlog/update-clock-fucntion.md`](../../../../../docs/backlog/update-clock-fucntion.md) and [`01-playback-clock-architecture.md`](../../../../../01-playback-clock-architecture.md) for the long-form design rationale.

---

## Testing

```bash
npm --workspace @elah/editor run test
```

Tests inject a deterministic `now` and stub `requestAnimationFrame`, so the suite runs in Node with no real timers. See [`PlaybackEngine.test.ts`](./PlaybackEngine.test.ts) — it covers:

- Float resolution from `getFrameAt()` during playback.
- Same-frame `seek()` producing distinct epochs.
- Long-blur simulation (advance fake `now` by 30 s while `document.hidden`) — no playhead jump.
- Mid-playback rate change preserves the current frame.
- Throttling on `subscribeTimeupdate()`.
- Listener isolation (one throwing listener does not stall the others).
