import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import { resolveTimeline } from '../resolver/resolveTimeline'
import { sanitizeOps } from './sanitize'
import { applyOps } from './apply'
import { opDescriber } from './describeOp'
import { DEFAULT_SHAPE_TRANSFORM } from '../resolver/textAnimation'
import { MAX_EXPRESSION_LENGTH } from '../resolver/expr/scope'
import type { EditorOp } from './types'

// Copied from ops.test.ts lines 10-16: the minimum an op needs.
function fixture() {
  const engine = new TimelineEngine({ fps: 30, stage: { width: 1920, height: 1080 } })
  const v = engine.addTrack('video').id
  const a = engine.addClip({ trackId: v, type: 'image', name: 'Interview', src: 'a.png', startFrame: 0, durationFrames: 150 })
  const b = engine.addClip({ trackId: v, type: 'video', name: 'B-roll', src: 'b.mp4', startFrame: 150, durationFrames: 150 })
  return { engine, v, a: a.id, b: b.id }
}

const setExpr = (clip: string, channel: string, source: unknown, extra: Record<string, unknown> = {}): EditorOp =>
  ({ op: 'setExpression', clip, channel, source, ...extra }) as unknown as EditorOp

describe('sanitizeOps: setExpression', () => {
  it('keeps a well-formed expression', () => {
    const { engine, b } = fixture()
    const { ops, dropped } = sanitizeOps([setExpr(b, 'x', 'value + wiggle(2, 0.02)')], engine.getProject())
    expect(dropped).toEqual([])
    expect(ops[0]).toEqual({ op: 'setExpression', clip: b, channel: 'x', source: 'value + wiggle(2, 0.02)' })
  })

  it('accepts `text` as an alias for `source`', () => {
    // The model schema already has a nullable `text` field, so a model will
    // reach for it; refusing would be a pointless failure.
    const { engine, b } = fixture()
    const { ops, dropped } = sanitizeOps([setExpr(b, 'x', undefined, { text: 'value + 1' })], engine.getProject())
    expect(dropped).toEqual([])
    expect(ops[0]).toMatchObject({ source: 'value + 1' })
  })

  it('treats null, undefined and blank as a removal', () => {
    const { engine, b } = fixture()
    for (const source of [null, undefined, '   ']) {
      const { ops, dropped } = sanitizeOps([setExpr(b, 'x', source)], engine.getProject())
      expect(dropped, String(source)).toEqual([])
      expect(ops[0], String(source)).toMatchObject({ source: null })
    }
  })

  it('drops an expression that does not parse, with a reason', () => {
    const { engine, b } = fixture()
    const { ops, dropped } = sanitizeOps([setExpr(b, 'x', 'nope +')], engine.getProject())
    expect(ops).toEqual([])
    expect(dropped[0]!.reason).toMatch(/^the expression does not parse/)
  })

  it('drops an unknown name too, rather than storing an op that cannot work', () => {
    const { engine, b } = fixture()
    const { dropped } = sanitizeOps([setExpr(b, 'x', 'nope + 1')], engine.getProject())
    expect(dropped[0]!.reason).toMatch(/^the expression does not parse/)
  })

  it('drops a channel that may not take an expression', () => {
    const { engine, b } = fixture()
    const { dropped } = sanitizeOps([setExpr(b, 'time', 'value')], engine.getProject())
    expect(dropped[0]!.reason).toMatch(/unknown expression channel "time"/)
  })

  it('drops a source over the length limit', () => {
    const { engine, b } = fixture()
    const { dropped } = sanitizeOps([setExpr(b, 'x', 'x'.repeat(MAX_EXPRESSION_LENGTH + 1))], engine.getProject())
    expect(dropped[0]!.reason).toMatch(/longer than 512 characters/)
  })

  it('rejects a non-string source', () => {
    const { engine, b } = fixture()
    const { dropped } = sanitizeOps([setExpr(b, 'x', 42)], engine.getProject())
    expect(dropped[0]!.reason).toMatch(/the expression is not text/)
  })

  it('never truncates silently', () => {
    // A truncated expression is a mystery animation; a refused op is a message.
    const { engine, b } = fixture()
    const long = `value + ${'1 + '.repeat(200)}1`
    const { dropped } = sanitizeOps([setExpr(b, 'x', long)], engine.getProject())
    expect(dropped.length).toBeGreaterThan(0)
  })
})

describe('applyOps: setExpression', () => {
  it('sets an expression as ONE undo step', () => {
    const { engine, b } = fixture()
    const { ops } = sanitizeOps([setExpr(b, 'x', 'value + 0.1')], engine.getProject())
    applyOps(engine, ops)
    const clip = engine.findClip(b)!.clip
    expect(clip.keyframes!.channels.x!.source).toEqual({ kind: 'expression', source: 'value + 0.1' })
    // One history entry for the whole thing, including any baked baseline.
    expect(engine.lastHistoryDescription()).toBeTruthy()
    engine.undo()
    expect(engine.findClip(b)!.clip.keyframes?.channels?.x).toBeUndefined()
  })

  it('resolves through the timeline, baked transform plus the expression', () => {
    const { engine, b } = fixture()
    // A freshly added video clip has NO authored transform; the op bakes the
    // baseline, so the baked value can only be read afterwards.
    expect(engine.findClip(b)!.clip.transform).toBeUndefined()
    const { ops } = sanitizeOps([setExpr(b, 'x', 'value + 0.1')], engine.getProject())
    applyOps(engine, ops)
    const baked = engine.findClip(b)!.clip.transform!.x
    const scene = resolveTimeline(160, engine.getProject())
    expect(scene.videos[0]!.transform!.x).toBeCloseTo(baked + 0.1, 10)
  })

  it('removes with a null source', () => {
    const { engine, b } = fixture()
    const { ops } = sanitizeOps([setExpr(b, 'x', 'value + 0.1')], engine.getProject())
    applyOps(engine, ops)
    const { ops: off } = sanitizeOps([setExpr(b, 'x', null)], engine.getProject())
    const result = applyOps(engine, off)
    expect(result.skipped).toEqual([])
    expect(engine.findClip(b)!.clip.keyframes?.channels?.x).toBeUndefined()
  })

  it('skips removing an expression that is not there', () => {
    const { engine, b } = fixture()
    const { ops } = sanitizeOps([setExpr(b, 'x', null)], engine.getProject())
    const result = applyOps(engine, ops)
    expect(result.skipped[0]!.reason).toBe('"B-roll" has no x expression')
  })

  it('skips setting an expression that is already set', () => {
    const { engine, b } = fixture()
    const { ops } = sanitizeOps([setExpr(b, 'x', 'value + 0.1')], engine.getProject())
    applyOps(engine, ops)
    const { ops: again } = sanitizeOps([setExpr(b, 'x', 'value + 0.1')], engine.getProject())
    expect(applyOps(engine, again).skipped[0]!.reason).toBe('that expression is already set')
  })
})

describe('opDescriber: setExpression', () => {
  it('describes both directions', () => {
    const { engine, b } = fixture()
    const p = engine.getProject()
    expect(opDescriber(p)({ op: 'setExpression', clip: b, channel: 'x', source: 'value + 1' } as EditorOp)).toBe(
      'Drive “B-roll” x with an expression',
    )
    expect(opDescriber(p)({ op: 'setExpression', clip: b, channel: 'x', source: null } as EditorOp)).toBe(
      'Remove the x expression from “B-roll”',
    )
  })
})

describe('an expression is visible in the engine round trip', () => {
  it('survives a save-shaped copy of the clip', () => {
    // `readClip` spreads the raw clip, so the field must need no reader change.
    const { engine, b } = fixture()
    const { ops } = sanitizeOps([setExpr(b, 'x', 'value + sin(t)')], engine.getProject())
    applyOps(engine, ops)
    const clip = engine.findClip(b)!.clip
    const copied = JSON.parse(JSON.stringify(clip)) as typeof clip
    expect(copied.keyframes!.channels.x!.source).toEqual({ kind: 'expression', source: 'value + sin(t)' })
    expect(DEFAULT_SHAPE_TRANSFORM).toBeTruthy()
  })
})
