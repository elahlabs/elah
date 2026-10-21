import { describe, expect, it } from 'vitest'
import { performance } from 'node:perf_hooks'
import { createExpressionContext } from './channels'
import { resolveTimeline } from '../resolveTimeline'
import { DEFAULT_TEXT_TRANSFORM } from '../textAnimation'
import type { Clip, KeyframeChannelTrack, Project, Track } from '../../types'

/**
 * The Risks-table cost item, "Expression cost" (PV-P5b-2 step 7).
 *
 * SKIPPED unless `EXPR_BENCH=1`. A timing assertion in the ordinary suite
 * flakes on a slower machine or a busy CI box, and a test that is
 * occasionally red for environmental reasons is a test people learn to ignore.
 * The gate is therefore opt-in, and the number it produces is recorded in the
 * ticket's Result rather than asserted on every run.
 *
 *   PowerShell: $env:EXPR_BENCH='1'; npm exec --no -- vitest run --root packages/core src/resolver/expr/exprCost.test.ts; Remove-Item Env:EXPR_BENCH
 *   bash:       EXPR_BENCH=1 npm exec --no -- vitest run --root packages/core src/resolver/expr/exprCost.test.ts
 */

const BENCH = process.env.EXPR_BENCH === '1'
const CLIPS = 200
const FRAMES = 1000

const expr = (source: string): KeyframeChannelTrack => ({ source: { kind: 'expression', source }, keys: [] })

const track = (i: number): Track => ({
  id: `el-${i}`, name: `G${i}`, kind: 'elements', order: i, height: 54,
  locked: false, disabled: false, muted: false, solo: false, volume: 1, protected: false,
})

const clip = (i: number): Clip => ({
  id: `c${i}`, trackId: `el-${i}`, type: 'text', name: `T${i}`, content: 'x',
  startFrame: 0, durationFrames: FRAMES, sourceStartFrame: 0, sourceDurationFrames: FRAMES,
  transform: { ...DEFAULT_TEXT_TRANSFORM },
  keyframes: {
    channels: {
      x: expr('value + wiggle(2, 0.02)'),
      y: expr('value + sin(t * 3) * 0.05'),
      opacity: expr('clamp(progress * 2, 0, 1)'),
    },
  },
} as unknown as Clip)

function project(): Project {
  const clips: Record<string, Clip[]> = {}
  const tracks: Track[] = []
  for (let i = 0; i < CLIPS; i++) {
    tracks.push(track(i))
    clips[`el-${i}`] = [clip(i)]
  }
  return {
    id: 'bench', version: 1, fps: 30, stage: { width: 1920, height: 1080 },
    tracks, clips, transitions: [],
  } as unknown as Project
}

/** One frame of direct evaluation: a context, then every clip's three channels. */
function runFrame(p: Project, f: number): void {
  const ctx = createExpressionContext(p, f)
  for (const list of Object.values(p.clips)) {
    for (const c of list) {
      const ev = ctx.evaluatorFor(c, f, c.transform!)!
      ev('x', undefined)
      ev('y', undefined)
      ev('opacity', undefined)
    }
  }
}

describe.skipIf(!BENCH)('expression cost', () => {
  it(`costs under 0.3 ms/frame for ${CLIPS} clips x 3 channels`, () => {
    const p = project()

    // Warm up: the parse cache and the JIT both need to be warm before a
    // per-frame number means anything. This is the measurement, not a discarded
    // run — the ticket's own instruction is to warm frames 0-99.
    for (let f = 0; f < 100; f++) runFrame(p, f)

    const t0 = performance.now()
    for (let f = 0; f < FRAMES; f++) runFrame(p, f)
    const perFrame = (performance.now() - t0) / FRAMES
    console.log('EXPR_COST ms/frame', perFrame.toFixed(4))
    expect(perFrame).toBeLessThan(0.3)
  })

  it('reports the whole-resolve delta, for information only', () => {
    // Not a gate: it includes every other part of resolveTimeline, so it says
    // what expressions COST the resolver, not what they cost on their own.
    const withExpr = project()
    const plain = project()
    for (const list of Object.values(plain.clips)) for (const c of list) c.keyframes = undefined

    // Warm both, so the comparison is like for like.
    for (const p of [withExpr, plain]) for (let f = 0; f < 50; f++) resolveTimeline(f, p)

    let t = performance.now()
    for (let f = 0; f < 200; f++) resolveTimeline(f, withExpr)
    const a = (performance.now() - t) / 200
    t = performance.now()
    for (let f = 0; f < 200; f++) resolveTimeline(f, plain)
    const b = (performance.now() - t) / 200
    console.log('EXPR_RESOLVE_DELTA ms/frame', (a - b).toFixed(4))
    expect(Number.isFinite(a - b)).toBe(true)
  })
})
