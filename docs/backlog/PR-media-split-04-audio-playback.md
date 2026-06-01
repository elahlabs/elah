# PR Split-04 — Single-track audio playback

> Standalone ticket. Pick this up cold. Read the whole thing top to bottom; the **copy-paste prompt** at the bottom is what you hand to an AI coding agent.
>
> Companion reading (do not skip):
>
> - **Prerequisites (merged):** [Split-01](./PR-media-split-01-structural-move.md), [Split-02](./PR-media-split-02-streaming-producer.md), [Split-03](./PR-media-split-03-text-layer.md)
> - Master plan: `.cursor/plans/media-renderer-split-mvp_c1e1a43a.plan.md` (Session 4 section)
> - [`../packages/editor/src/core/resolver/scene.ts`](../packages/editor/src/core/resolver/scene.ts) — `ActiveAudioClip`
> - [`../apps/playground/src/GpuPreview.tsx`](../../apps/playground/src/GpuPreview.tsx) — RAF tick wiring point

---

## Status

🔴 Not started.

**Prerequisites:** Split-01, Split-02, Split-03 merged.

**Completes:** Media + Renderer Split MVP (video + text + single-track audio).

---

## Goal

Add single-track audio preview playback synchronized to the existing video timeline. Video remains the **clock master**; audio chases the playhead via seeks. Only one active audio clip is mixed (topmost per resolver solo/mute rules).

After this PR, a playground project with one video + one audio track plays both during preview, with scrub and pause/resume working acceptably for MVP.

---

## Why this matters

Video preview works after Split-02; text overlays work after Split-03. MVP still has no sound. Audio uses a **different cache shape** (PCM ring buffer, not VideoFrame map) and a **different output path** (Web Audio graph, not WebGL). This ticket establishes `core/media/audio/` + `core/audio/` mirroring the video split.

---

## Frozen surfaces (do not touch unless listed in Scope → In)

- `packages/editor/src/core/resolver/**` (solo/mute rules already in resolveTimeline — consume, don't change)
- `packages/editor/src/core/media/video/**` (unless shared demuxer patterns)
- GPU compositing core (except `GpuPreview.tsx` wiring)

---

## Scope

**In:**

- New folder `packages/editor/src/core/media/audio/`:
  - `PcmRingBuffer.ts` — fixed-capacity interleaved PCM ring (~2 s @ 48 kHz stereo)
  - `AudioDecoderManager.ts` — opens source, decodes via WebCodecs `AudioDecoder`
  - `AudioBufferProducer.ts` — push-based, mirrors `StreamingFrameProducer` pattern
- New folder `packages/editor/src/core/audio/`:
  - `AudioMixer.ts` — `AudioContext` + scheduled buffer playback
  - `AudioPreviewEngine.ts` — bridges playback state + Scene → mixer + producer
- Update: `apps/playground/src/GpuPreview.tsx` — wire `audioPreview.tick(scene)` in RAF
- Tests: `PcmRingBuffer.test.ts`, `AudioBufferProducer.test.ts`, `AudioMixer.test.ts`
- Optional: export `AudioPreviewEngine` from `packages/editor/src/index.ts` if playground needs it

**Out:**

- Multi-track mixing (only one audio clip active)
- Volume automation, fades, panning
- Audio drift correction / sample-accurate AV lock
- Audio-master clock (AudioContext as time authority)
- Export / encoding pipeline

---

## Design

### Clock strategy (hard constraint)

**Video-master:** `PlaybackEngine` + RAF remain authoritative for timeline frame. Audio:

- On each RAF tick: `audioPreview.tick(scene)` reads `scene.audios[0]` (or topmost active clip)
- Maps `clip.sourceFrame` → sample position: `sampleIndex = sourceFrame * (sampleRate / fps)`
- On play: `AudioContext.resume()` + schedule from ring buffer
- On pause: stop scheduling; keep ring buffer cursor
- On seek: clear ring buffer, `producer.setPlayhead(sampleIndex)`, refill

`AudioContext.currentTime` is used **only for scheduling** buffer start times — not as the timeline authority.

### Single-track selection

```ts
// AudioPreviewEngine.tick(scene)
// MVP: mix only the first (or highest zIndex) active audio clip.
// Resolver already applies mute/solo — scene.audios may have 0 or 1 effective clip.
const clip = scene.audios[scene.audios.length - 1] // topmost
if (!clip || clip.volume === 0) { mixer.stop(); return }
```

Document in code comment: additional tracks are silently ignored until post-MVP.

### `PcmRingBuffer`

- Fixed `Float32Array` capacity (e.g. 48000 * 2 * 2 = 192000 samples = 2 s stereo @ 48 kHz)
- Write cursor, read cursor, available samples
- `write(pcm: Float32Array): number` — returns samples written
- `read(count: number): Float32Array | null`
- `clear(): void` — on seek

### `AudioBufferProducer`

Mirrors video `StreamingFrameProducer`:

```ts
setPlayhead(sampleIndex: number, opts?: { lookaheadSamples?: number }): void
getAvailableSamples(): number
dispose(): void
```

Internally: `AudioDecoderManager` decodes chunks into PCM, writes to ring buffer. Discontinuity on large sample jumps → seek + clear buffer.

### `AudioMixer`

- Owns `AudioContext` (lazy-created on first user gesture)
- Pulls PCM from ring buffer, creates `AudioBuffer`, schedules `AudioBufferSourceNode`
- `start()`, `pause()`, `stop()`, `dispose()`
- MVP: simple queue — schedule next chunk when previous ends or when buffer has enough data

### Wiring in `GpuPreview.tsx`

```ts
const tick = () => {
  const frame = Math.floor(playback.getFrameAt())
  const scene = resolveTimeline(frame, engine.getProject())
  renderer.render(scene)
  audioPreview.tick(scene)  // NEW
  rafId = requestAnimationFrame(tick)
}

// On play/pause hooks:
playback.play()  → audioPreview.play()
playback.pause() → audioPreview.pause()
```

---

## Acceptance criteria

1. All five new modules exist and compile.
2. Playground project with **one video + one audio** clip plays both on Play.
3. Pause stops audio; resume continues from current timeline position (within ~100 ms).
4. Scrubbing forward/backward resyncs audio (audible recovery within ~100 ms, no permanent desync).
5. Muted track (`volume: 0` or track muted in resolver) produces silence.
6. **Tests:**
   - `PcmRingBuffer`: wrap-around, read/write cursors, clear
   - `AudioBufferProducer`: setPlayhead fills buffer; seek clears; dispose closes resources
   - `AudioMixer`: mocked AudioContext — pause stops, schedule order correct
7. Full vitest suite green; typecheck clean.
8. No multi-track mixing code paths (explicitly single-clip).

---

## Out of scope

- Second audio track, crossfade between audio clips
- Waveform UI
- `AudioContext` as master clock
- Export / WASM encode
- Microphone input

---

## Implementation notes

- Reuse mediabunny demuxer patterns from `core/media/video/demuxer/` where possible; audio track selection may need demuxer API extension.
- Gate `AudioContext` creation behind user gesture (Play button click) — browsers block autoplay.
- Handle missing WebCodecs `AudioDecoder` gracefully (log + silent preview, don't crash GPU path).
- `scene.audios` uses same `sourceFrame` mapping as video — see `resolveTimeline.ts`.
- Consider shared `createPlaygroundDemuxerFactory` in playground for audio src URLs.

---

## Verification

1. **Unit:** `npm test -- --run PcmRingBuffer AudioBufferProducer AudioMixer`
2. **Full suite:** `npm test --workspace=packages/editor`
3. **Manual:** playground with video+audio, Play 30 s, Pause, scrub ±5 s, Play again — no glitches or runaway audio.

---

## Copy-paste prompt for an implementation agent

```
You are implementing a backlog ticket for the @elah/editor repo.

Ticket: docs/backlog/PR-media-split-04-audio-playback.md
Prerequisites: PR-media-split-01, 02, 03 MUST be merged.

Read in this order before writing any code:
1. docs/backlog/PR-media-split-04-audio-playback.md (this ticket — top to bottom)
2. packages/editor/src/core/media/video/StreamingFrameProducer.ts — push producer pattern
3. packages/editor/src/core/resolver/scene.ts — ActiveAudioClip
4. apps/playground/src/GpuPreview.tsx — RAF tick

Then implement PcmRingBuffer, AudioDecoderManager, AudioBufferProducer, AudioMixer, AudioPreviewEngine.

Hard constraints:
- Video-master clock — PlaybackEngine/RAF is authoritative; audio chases via seeks.
- Single-track MVP only — one active audio clip; document ignored tracks in code.
- No multi-track mixing, fades, panning, or drift correction.
- Do NOT change resolver or video decode pipeline.
- Wire audioPreview.tick(scene) in GpuPreview RAF loop.

Walk the ticket's "Acceptance criteria" section item by one before declaring done.
Run typecheck and full test suite. Manually verify playground A/V sync.

If you find a reason to go outside scope, stop and surface the question.
```
