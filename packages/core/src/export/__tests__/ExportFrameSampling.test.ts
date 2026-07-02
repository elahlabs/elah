/**
 * Export ↔ Preview frame-sampling parity tests.
 *
 * The two renderers address source frames differently:
 *
 *   Preview  — VideoDecoderManager derives a frame index from the decoded PTS:
 *              Math.round(frame.timestamp / usPerFrame)  →  nearest-frame semantics.
 *
 *   Export   — mediabunny CanvasSink.getCanvas(t) returns the LAST frame whose
 *              PTS ≤ t  →  floor semantics.
 *
 * The fix: export seeks at  (sourceFrame + 0.5) / fps  (frame midpoint) so that
 * getCanvas's floor lands on the same frame index that preview's round() produces.
 *
 * These tests use only arithmetic — no mediabunny, no WebCodecs, no network.
 */

import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// Helpers that simulate the two sampling conventions
// ---------------------------------------------------------------------------

/**
 * Simulate getCanvas(seekTimeSec) floor semantics: return the index of the
 * last frame in `pts` whose timestamp is ≤ seekTimeSec.
 */
function canvasSinkFrame(seekTimeSec: number, pts: number[]): number {
  let result = 0
  for (let i = 0; i < pts.length; i++) {
    if (pts[i] <= seekTimeSec) result = i
    else break
  }
  return result
}

/** Build a uniform CFR PTS array where each frame is `frameDurationSec` apart. */
function uniformCfrPts(count: number, frameDurationSec: number): number[] {
  return Array.from({ length: count }, (_, i) => i * frameDurationSec)
}

/**
 * Build NTSC (29.97 = 30000/1001 fps) PTS for a source whose native frame
 * duration is exactly 1001/30000 seconds. Used to simulate a 29.97fps clip
 * in a 30fps project — the most common fps-mismatch scenario.
 */
function ntscPts(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i * (1001 / 30000))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Export frame-sampling — midpoint seek (half-frame offset)', () => {
  const PROJECT_FPS = 30
  const US_PER_FRAME = 1_000_000 / PROJECT_FPS

  it('midpoint seek returns the correct frame for every index on a CFR 30fps source', () => {
    const pts = uniformCfrPts(300, 1 / PROJECT_FPS)
    for (let n = 0; n < 300; n++) {
      const seekSec = (n + 0.5) / PROJECT_FPS
      expect(canvasSinkFrame(seekSec, pts)).toBe(n)
    }
  })

  it('preview round() convention always returns the correct frame index', () => {
    for (let n = 0; n < 300; n++) {
      const ptsUs = n * US_PER_FRAME
      expect(Math.round(ptsUs / US_PER_FRAME)).toBe(n)
    }
  })

  it('old floor seek fails on NTSC (29.97fps) source in a 30fps project', () => {
    // NTSC frame N has PTS = N * 1001/30000.
    // For N=1: PTS = 1001/30000 ≈ 0.033367s.
    // Old seek at N/30 = 1/30 ≈ 0.033333s < PTS[1] → getCanvas returns frame 0. ❌
    const pts = ntscPts(60)
    let failures = 0
    for (let n = 1; n < 60; n++) {
      const oldSeekSec = n / PROJECT_FPS // floor-semantics seek (pre-fix)
      if (canvasSinkFrame(oldSeekSec, pts) !== n) failures++
    }
    expect(failures).toBeGreaterThan(0)
  })

  it('midpoint seek is robust on NTSC (29.97fps) source (first 300 project frames)', () => {
    // (N + 0.5)/30 > N * 1001/30000 iff 1000N + 500 > 1001N iff N < 500.
    // So midpoint is safe for any clip up to ~500 project frames (≈16s at 30fps).
    const pts = ntscPts(301)
    let failures = 0
    for (let n = 0; n < 300; n++) {
      const seekSec = (n + 0.5) / PROJECT_FPS // fixed midpoint seek
      if (canvasSinkFrame(seekSec, pts) !== n) failures++
    }
    expect(failures).toBe(0)
  })

  it('midpoint seek is self-consistent on 24fps source in a 30fps project (first 300 frames)', () => {
    // 24fps source in a 30fps project: the midpoint convention defines the
    // source frame as floor((n + 0.5) * sourceFps / projectFps) — i.e. the
    // source frame whose window contains the project frame's midpoint time.
    // Verify that canvasSinkFrame agrees with this formula for all project frames.
    const sourceFps = 24
    const pts = uniformCfrPts(241, 1 / sourceFps) // 241 source frames ≥ ceil(300 * 24/30)
    let failures = 0
    for (let n = 0; n < 300; n++) {
      const seekSec = (n + 0.5) / PROJECT_FPS
      const expectedSourceFrame = Math.floor(((n + 0.5) * sourceFps) / PROJECT_FPS)
      if (canvasSinkFrame(seekSec, pts) !== expectedSourceFrame) failures++
    }
    expect(failures).toBe(0)
  })
})

describe('Export frame-sampling — documented limitations', () => {
  // These tests are NOT bugs to fix — they document known constraints.

  it('NTSC drift exceeds half-frame at ~500 project frames (source-fps ≠ project-fps)', () => {
    // When sourceFrame accumulates to ~500 frames (≈16s at 30fps), the NTSC
    // drift (1 extra ms per 1001ms) exceeds half a frame. Beyond this point
    // the midpoint seek may pick the wrong source frame. This is a source-fps
    // ≠ project-fps problem; the fix requires explicit fps resampling.
    // Tracked as a known limitation — out of scope for the midpoint fix.
    const PROJECT_FPS = 30
    const ntscFrameDuration = 1001 / 30000 // ≈ 33.367ms

    // At frame 500: midpoint seek = 500.5/30 ≈ 16.6833s
    // NTSC PTS[500] = 500 * 1001/30000 = 500500/30000 ≈ 16.6833s
    // They're essentially equal — right at the boundary of robustness.
    const seekAt500 = (500 + 0.5) / PROJECT_FPS
    const pts500 = 500 * ntscFrameDuration
    expect(Math.abs(seekAt500 - pts500)).toBeLessThan(0.001) // within 1ms
  })

  it('A/V tail length difference is sub-frame (< 1/fps ≈ 33ms at 30fps)', () => {
    // exportVideo.ts: audioLength = Math.ceil(sampleRate * totalFrames/fps)
    // videoLength  = totalFrames * (1/fps)
    // The audio buffer is at most 1 sample longer than the video (< 1/sampleRate ≈ 23μs).
    // Well within acceptable A/V sync tolerance.
    const fps = 30
    const sampleRate = 44100
    const totalFrames = 90 // 3 seconds

    const videoLengthSec = totalFrames / fps
    const audioSamples = Math.ceil(sampleRate * videoLengthSec)
    const audioLengthSec = audioSamples / sampleRate

    const tailGapSec = audioLengthSec - videoLengthSec
    expect(tailGapSec).toBeGreaterThanOrEqual(0)
    expect(tailGapSec).toBeLessThan(1 / fps) // sub-frame gap
  })
})
