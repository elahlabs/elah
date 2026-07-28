# `core/media/audio`

Multi-track audio playback, synchronized to the video frame via the `PlaybackEngine` transport clock.

---

## Architecture

### Transport clock — audio-as-ground-truth

The root cause of A/V drift is two independent oscillators: `performance.now()` for video, `AudioContext.currentTime` for audio. This is fixed by making the engine prefer `ctx.currentTime` as its time source.

```
AudioPlaybackController.start()
  └─ this._playback.setAudioContext(this._ctx)
       └─ PlaybackEngine.now() = () => ctx.currentTime  (when running)
```

Because both the video frame (`getFrameAt()`) and the audio buffer position derive from the same hardware oscillator, A/V sync is exact by construction. The `state === 'running'` guard transparently falls back to `performance.now()` before the first user gesture resumes the context.

### Audio graph (per clip → per track → master)

```
AudioBufferSourceNode ─┐
                        ├─ clipGain ─┐
AudioBufferSourceNode ─┘             │
(other clips on same track)          ├─ trackGain ─ trackAnalyser ─┐
                                                                    ├─ masterGain ─ destination
AudioBufferSourceNode ─ clipGain ─ trackGain ─ trackAnalyser ──────┘
(different track)
```

- **clipGain** — effective clip volume from the resolver (`clip.volume × track.volume × mute`).
- **trackGain** — per-track live fader tap. Starts at 1.0; mutated by `setTrackGain()`.
- **trackAnalyser** — real-time RMS source for the mixer meters.
- **masterGain** — project-level master fader. Mutated by `setMasterGain()`.

Track nodes (`trackGain` + `trackAnalyser`) are created lazily on first clip schedule and torn down when no clips on that track are active.

### Gain ramps — click-free volume changes

All gain mutations go through a short linear ramp (10 ms) instead of direct `.gain.value` assignments:

```ts
param.cancelScheduledValues(now)
param.setValueAtTime(param.value, now)
param.linearRampToValueAtTime(target, now + 0.01)
```

This eliminates zipper noise on volume changes and mute/unmute during playback.

### playbackRate

`AudioBufferSourceNode.playbackRate.value` is set from `snap.playbackRate` on every schedule. Rate changes bump the transport epoch, which causes a re-schedule at the new rate — audio speed follows video speed automatically.

### Scheduling look-ahead

Nodes are started at `ctx.currentTime + 0.02` with the source offset adjusted accordingly, so the start lands cleanly on a future audio quantum rather than "right now".

---

## Data model

### `Track.volume`

Linear gain multiplier (0..2, default 1). Stored in the project model and folded into resolved clip volume by `resolveTimeline`:

```ts
const trackGain = track.muted ? 0 : (track.volume ?? 1)
const volume = (clip.volume ?? 1) * trackGain
```

### `Project.masterVolume`

Linear master gain (0..2, default 1). Applied on the controller's `_masterGain` node — no re-resolve needed on change.

---

## `AudioPlaybackController` API

```ts
const controller = new AudioPlaybackController(playback, () => project, options?)
controller.start()   // creates AudioContext, hooks into PlaybackEngine
controller.destroy() // stops all audio, detaches clock, closes context
```

### Mixer methods

| Method | Description |
|--------|-------------|
| `setMasterGain(value)` | Ramp master output to `value` (linear, 0..2). Click-free. |
| `setTrackGain(trackId, value)` | Ramp per-track fader to `value`. No-op if track has no active clips. |
| `getTrackLevels()` | Returns `Map<trackId, { left, right }>` RMS levels from AnalyserNodes. Mono-summed (L=R) in v1. |

---

## Hook abstractions

All hooks below are exported from `@elah/react` (not `@elah/core` — `core` only
ships `AudioPlaybackController` itself; the React wrappers live one layer up).

### `useAudioMixer(controller)`

```ts
const { setMasterGain, setTrackGain } = useAudioMixer(controller)
```

Exposes click-free gain controls. All methods are no-ops when `controller` is null.

### `useTrackLevels(controller)`

```ts
const levels = useTrackLevels(controller)
// levels: Map<trackId, { left: number, right: number }>
```

Polls `controller.getTrackLevels()` on every animation frame. Returns an empty map when the controller is null or no tracks have active clips. Polling stops on unmount.

### `useMasterVolume(controller, engine)`

```ts
const { masterVolume, setMasterVolume } = useMasterVolume(controller, engine)
```

Reads `project.masterVolume` and exposes `setMasterVolume(v)` which:
1. Immediately ramps the audio graph (click-free).
2. Persists the value to the project model via `engine.setMasterVolume()`.

---

## Testing

```bash
npm --workspace @elah/core run test
```

Tests inject a mock `AudioContext` (no real Web Audio) and a fake `PlaybackEngine`. Covered scenarios:

- Decode-and-start at the correct offset.
- No restart on plain frame advance (same epoch).
- Re-schedule on seek/rate change (epoch bump).
- Stop on pause, stop when clip leaves scene.
- Multi-track: two nodes for two clips, selective stop.
- `setAudioContext` handoff: `start()` attaches, `destroy()` detaches.
- `playbackRate` wired to `AudioBufferSourceNode`.
- Gain ramps via `linearRampToValueAtTime` (no direct writes).
- Per-track `AnalyserNode` created for each active track.
- `getTrackLevels()` returns entries for all active tracks.
- `setMasterGain()` / `setTrackGain()` ramp the correct nodes.
- Muted track → resolved volume 0 → gain ramped to 0.
