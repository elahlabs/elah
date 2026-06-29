# `core/playback`

The playback subsystem owns **time** for the editor. It answers one question for every other system in the codebase:

> _"What frame are we on right now?"_

Everything else — the playhead needle, the timeline ruler, renderers, audio, one-shot effects — is a consumer of the answer this module produces.

---

## What lives here

| File | Purpose |
| --- | --- |
| [`PlaybackEngine.ts`](./PlaybackEngine.ts) | The clock. Framework-agnostic. No React, no Zustand. |
| [`PlaybackEngine.test.ts`](./PlaybackEngine.test.ts) | Unit tests, including clock-switching and anchor-and-integrate scenarios. |

The engine is wired to React state by [`editor/EditorProvider.tsx`](../../editor/EditorProvider.tsx) and consumed by timeline components via the `usePlaybackStore` mirror.

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

This means time is a **pure function of two scalars + `now()`**. The rAF loop only _samples_ this function and decides whether to notify subscribers.

Every transport event (`play`, `pause`, `seek`, `setPlaybackRate`, `setLoop`, end-of-timeline) **re-anchors atomically**: `anchorFrame` and `anchorTime` are updated together so the integration restarts from a known point.

---

## Transport clock — audio-as-ground-truth

`PlaybackEngine` selects its time source via a private `now()` method:

1. **Test override** (`config.now`) — deterministic, injected in tests.
2. **AudioContext clock** — when `setAudioContext(ctx)` is called with a running context, `now()` returns `ctx.currentTime` (hardware audio clock in seconds). This is the production path during audio playback.
3. **`performance.now()` fallback** — used before audio starts or while the context is `suspended`.

```ts
// PlaybackEngine.ts — simplified
private now(): number {
  if (this._nowOverride) return this._nowOverride()
  const ctx = this._audioCtx
  if (ctx && ctx.state === 'running') return ctx.currentTime
  return performance.now() / 1000
}
```

`AudioPlaybackController` calls `playback.setAudioContext(ctx)` immediately after creating its `AudioContext`, and `setAudioContext(null)` on `destroy()`. Because both the video frame and the audio output derive from the same hardware oscillator (`ctx.currentTime`), A/V drift is eliminated by construction.

### `setAudioContext(ctx)`

```ts
engine.setAudioContext(ctx: AudioContext | null): void
```

- Attaches (or detaches) an `AudioContext` as the time source.
- If playing, re-anchors immediately so the clock swap is seamless.
- The `state === 'running'` guard means the engine transparently uses `performance.now()` until the first user gesture resumes the context.
- Consumers do not need to call this — `AudioPlaybackController` manages the handoff.

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
| `setAudioContext(ctx)` | `(ctx: AudioContext \| null) => void` | Attach/detach audio clock. Re-anchors if playing. |
| `getFrameAt(t?)` | `(t?: number) => number` | **Float** frame at time `t` (defaults to `now()`). The renderer reads this. |
| `currentFrame` | `number` (getter) | `Math.floor(getFrameAt())` — for the store and UI. |
| `currentTime` | `number` (getter) | `currentFrame / fps`, in seconds. |
| `isPlaying`, `playbackRate`, `loop` | getters | Current state. |
| `subscribe(fn)` | `(fn) => () => void` | Frame-accurate channel. Fires on transport events and integer-frame advances. |
| `subscribeTimeupdate(fn)` | `(fn) => () => void` | Throttled (~100 ms) channel. For timecode labels. |
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

`epoch` is the discriminator subscribers use to detect _"this is a new arrival at this frame, not a continuation"_.

---

## Subscription model

```
            ┌──────────────────────────────┐
            │       PlaybackEngine         │
            └──────────────┬───────────────┘
                           │ notify()
            ┌──────────────┴───────────────┐
            ▼                              ▼
   subscribe() — frame-accurate    subscribeTimeupdate() — ~10 Hz
   • Playhead needle               • Clock-label components
   • AudioPlaybackController       • Status strings
   • Effect firing
```

---

## Background-tab policy

When `document.hidden` becomes `true` while playing, `anchorFrame` is frozen at the current position. On `false`, `anchorTime` is reset to `now()` — integration resumes from the frozen frame with no catch-up.

---

## Testing

```bash
npm --workspace @elah/core run test
```

Tests inject a deterministic `now` and stub `requestAnimationFrame`, so the suite runs in Node with no real timers. Covered scenarios:

- Float resolution from `getFrameAt()` during playback.
- Same-frame `seek()` producing distinct epochs.
- Long-blur simulation — no playhead jump.
- Mid-playback rate change preserves the current frame.
- `setAudioContext()` clock switching: attach/detach, re-anchor during playback, suspended-context fallback.
- Throttling on `subscribeTimeupdate()`.
- Listener isolation (one throwing listener does not stall others).
