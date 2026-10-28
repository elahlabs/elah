import { describe, expect, it } from 'vitest'
import { authoredChannelValue, createExpressionContext, sampleChannelExpression } from './channels'
import { parseExpression } from './parse'
import { seedFor } from './scope'
import { noise1 } from '../../elements/noise'
import { setKeyframe } from '../../elements/keyframes'
import { DEFAULT_TEXT_TRANSFORM } from '../textAnimation'
import type { Clip, ClipKeyframes, Keyframe, KeyframeChannelTrack, Project, Track } from '../../types'

const STAGE = { width: 1080, height: 1920 }

const track = (id: string, name: string, order: number): Track => ({
  id, name, kind: 'elements', order, height: 54,
  locked: false, disabled: false, muted: false, solo: false, volume: 1, protected: false,
})

const expr = (source: string, keys: Keyframe[] = []): KeyframeChannelTrack => ({
  source: { kind: 'expression', source },
  keys,
})

const clip = (over: Partial<Clip> = {}): Clip => ({
  id: 'c1',
  trackId: 'el-1',
  type: 'text',
  name: 'Title',
  content: 'x',
  startFrame: 0,
  durationFrames: 30,
  sourceStartFrame: 0,
  sourceDurationFrames: 30,
  transform: { ...DEFAULT_TEXT_TRANSFORM },
  ...over,
} as unknown as Clip)

const project = (clips: Clip[]): Project =>
  ({
    id: 'p',
    version: 1,
    fps: 30,
    stage: STAGE,
    tracks: [track('el-1', 'Graphics', 0)],
    clips: { 'el-1': clips },
    transitions: [],
  }) as unknown as Project

const k = (frame: number, value: number): Keyframe => ({ id: `k${frame}`, frame, value, easing: 'linear' })

describe('channels', () => {
  describe('authoredChannelValue', () => {
    const c = clip({
      opacity: 0.4,
      effects: [{ id: 'e1', kind: 'gaussianBlur', params: { radius: 5 } }],
      mask: { kind: 'rect', x: 0, y: 0, width: 1, height: 1 },
    } as unknown as Partial<Clip>)

    it('agrees with the writer default for every channel it can be asked about', () => {
      // The whole point of mirroring `currentChannelValue` here: an expression's
      // `value` must read the same number the writer would have written. If
      // these two ever disagree, adding an expression to a keyless channel
      // silently shifts the clip.
      const channels = [
        'x', 'y', 'scale', 'scaleX', 'rotation', 'opacity', 'cornerRadius',
        'fx.e1.radius', 'mask.width', 'mask.feather',
      ] as const
      for (const ch of channels) {
        const written = setKeyframe(c, ch, 0, { stage: STAGE })
        const expected = written.keyframes!.channels[ch]!.keys[0]!.value
        expect(authoredChannelValue(c, ch, c.transform!), ch).toBe(expected)
      }
    })

    it('falls back to the effect registry default when a param is unset', () => {
      const bare = clip({ effects: [{ id: 'e1', kind: 'gaussianBlur', params: {} }] } as unknown as Partial<Clip>)
      // The ticket pins this number: gaussianBlur's radius defaults to 12.
      expect(authoredChannelValue(bare, 'fx.e1.radius', DEFAULT_TEXT_TRANSFORM)).toBe(12)
    })
  })

  describe('evaluatorFor', () => {
    it('is undefined for a clip with keys but no expression', () => {
      const c = clip({ keyframes: { channels: { x: { source: { kind: 'keyframes' }, keys: [k(0, 0.2)] } } } })
      expect(createExpressionContext(project([c]), 0).evaluatorFor(c, 0, DEFAULT_TEXT_TRANSFORM)).toBeUndefined()
    })

    it('reads `value` from the keys when there are some', () => {
      const c = clip({ keyframes: { channels: { x: expr('value * 2', [k(0, 0.2), k(10, 0.4)]) } } })
      const ev = createExpressionContext(project([c]), 0).evaluatorFor(c, 5, DEFAULT_TEXT_TRANSFORM)!
      // Halfway between 0.2 and 0.4 is 0.3; doubled is 0.6.
      expect(ev('x', 0.3)).toBeCloseTo(0.6, 10)
    })

    it('reads `value` from the authored value when there are no keys', () => {
      const c = clip({ transform: { ...DEFAULT_TEXT_TRANSFORM, x: 0.25 }, keyframes: { channels: { x: expr('value * 2') } } })
      const ev = createExpressionContext(project([c]), 0).evaluatorFor(c, 5, c.transform!)!
      expect(ev('x', undefined)).toBeCloseTo(0.5, 10)
    })

    it('exposes the frame-local scope', () => {
      const c = clip({ keyframes: { channels: { x: expr('frame') } } })
      const ctx = createExpressionContext(project([c]), 0)
      expect(ctx.evaluatorFor(c, 7, DEFAULT_TEXT_TRANSFORM)!('x', undefined)).toBe(7)

      const t = clip({ keyframes: { channels: { x: expr('t') } } })
      expect(createExpressionContext(project([t]), 0).evaluatorFor(t, 15, DEFAULT_TEXT_TRANSFORM)!('x', undefined)).toBe(0.5)

      const s = clip({ keyframes: { channels: { x: expr('stage.height') } } })
      expect(createExpressionContext(project([s]), 0).evaluatorFor(s, 0, DEFAULT_TEXT_TRANSFORM)!('x', undefined)).toBe(1920)
    })

    it('reports progress 0 at the first frame and 1 at the last', () => {
      const c = clip({ durationFrames: 11, keyframes: { channels: { x: expr('progress') } } })
      const ctx = createExpressionContext(project([c]), 0)
      expect(ctx.evaluatorFor(c, 0, DEFAULT_TEXT_TRANSFORM)!('x', undefined)).toBe(0)
      expect(ctx.evaluatorFor(c, 5, DEFAULT_TEXT_TRANSFORM)!('x', undefined)).toBe(0.5)
      expect(ctx.evaluatorFor(c, 10, DEFAULT_TEXT_TRANSFORM)!('x', undefined)).toBe(1)
    })

    it('reports duration in seconds', () => {
      const c = clip({ durationFrames: 90, keyframes: { channels: { x: expr('duration') } } })
      expect(createExpressionContext(project([c]), 0).evaluatorFor(c, 0, DEFAULT_TEXT_TRANSFORM)!('x', undefined)).toBe(3)
    })

    it('reports a 1-frame clip as progress 0 rather than dividing by zero', () => {
      const c = clip({ durationFrames: 1, keyframes: { channels: { x: expr('progress') } } })
      const r = createExpressionContext(project([c]), 0).evaluatorFor(c, 0, DEFAULT_TEXT_TRANSFORM)!('x', undefined)
      expect(r).toBe(0)
    })
  })

  describe('clip(...)', () => {
    const other = (over: Partial<Clip> = {}) =>
      clip({
        id: 'c-a',
        name: 'Title',
        startFrame: 0,
        durationFrames: 11,
        transform: { ...DEFAULT_TEXT_TRANSFORM },
        keyframes: { channels: { x: { source: { kind: 'keyframes' }, keys: [k(0, 0), k(10, 1)] } } },
        ...over,
      })

    it('resolves by id and by name', () => {
      const target = clip({ keyframes: { channels: { x: expr('clip("c-a").x') } } })
      const byId = createExpressionContext(project([other(), target]), 5).evaluatorFor(target, 5, DEFAULT_TEXT_TRANSFORM)!
      expect(byId('x', undefined)).toBeCloseTo(0.5, 10)
      const byName = clip({ keyframes: { channels: { x: expr('clip("Title").x') } } })
      const ctx = createExpressionContext(project([other(), byName]), 5)
      expect(ctx.evaluatorFor(byName, 5, DEFAULT_TEXT_TRANSFORM)!('x', undefined)).toBeCloseTo(0.5, 10)
    })

    it('holds the first value of a clip that has not started yet', () => {
      const later = other({ startFrame: 20, keyframes: { channels: { x: { source: { kind: 'keyframes' }, keys: [k(0, 0.9)] } } } })
      const target = clip({ keyframes: { channels: { x: expr('clip("c-a").x') } } })
      const ctx = createExpressionContext(project([later, target]), 5)
      expect(ctx.evaluatorFor(target, 5, DEFAULT_TEXT_TRANSFORM)!('x', undefined)).toBe(0.9)
    })

    it('reports a missing clip once, however many times it is read', () => {
      const target = clip({ keyframes: { channels: { x: expr('clip("missing").x') } } })
      const ctx = createExpressionContext(project([target]), 5)
      const ev = ctx.evaluatorFor(target, 5, DEFAULT_TEXT_TRANSFORM)!
      ev('x', undefined)
      ev('x', undefined)
      expect(ctx.errors.filter((e) => e.code === 'unknown-clip')).toHaveLength(1)
    })

    it('never evaluates the referenced clip own expressions', () => {
      // b's x has KEYS (0.2 -> 0.8) and an expression `value * 100`. A view is
      // the KEYED rest, so a's expression must read 0.2 at frame 0. If the view
      // evaluated b's expression it would read 20 — and because b's expression
      // points back at a, a chain would also be possible. Neither happens.
      const b = clip({
        id: 'c-b',
        name: 'B',
        keyframes: { channels: { x: expr('value * 100', [k(0, 0.2), k(10, 0.8)]) } },
      })
      const a = clip({ id: 'c-a', name: 'A', keyframes: { channels: { x: expr('clip("c-b").x') } } })
      const ctx = createExpressionContext(project([a, b]), 0)
      expect(ctx.evaluatorFor(a, 0, DEFAULT_TEXT_TRANSFORM)!('x', undefined)).toBeCloseTo(0.2, 10)
      // And the mutual reference is inert rather than a hang or an error.
      expect(ctx.evaluatorFor(b, 0, DEFAULT_TEXT_TRANSFORM)!('x', 0.2)).toBe(20)
      expect(ctx.errors.filter((e) => e.code === 'unknown-clip')).toHaveLength(0)
    })
  })

  describe('errors', () => {
    it('reports an unknown identifier with its position', () => {
      const c = clip({ keyframes: { channels: { x: expr('nope + 1') } } })
      const ctx = createExpressionContext(project([c]), 0)
      expect(ctx.evaluatorFor(c, 0, DEFAULT_TEXT_TRANSFORM)!('x', undefined)).toBeUndefined()
      expect(ctx.errors).toEqual([
        { clipId: 'c1', channel: 'x', code: 'unknown-identifier', message: 'Unknown name "nope"', pos: 0 },
      ])
    })

    it('reports one error per clip, channel and code however many times it is read', () => {
      const c = clip({ keyframes: { channels: { x: expr('nope + 1'), y: expr('nope + 1') } } })
      const ctx = createExpressionContext(project([c]), 0)
      const ev = ctx.evaluatorFor(c, 0, DEFAULT_TEXT_TRANSFORM)!
      ev('x', undefined)
      ev('x', undefined)
      ev('y', undefined)
      // Two channels, so two entries; the repeat read of x adds none.
      expect(ctx.errors).toHaveLength(2)
    })

    it('reports an expression on a channel that may not have one', () => {
      const c = clip({ keyframes: { channels: { time: expr('value') } } })
      const ctx = createExpressionContext(project([c]), 0)
      expect(ctx.evaluatorFor(c, 0, DEFAULT_TEXT_TRANSFORM)).toBeUndefined()
      expect(ctx.errors).toEqual([
        { clipId: 'c1', channel: 'time', code: 'unsupported-channel', message: 'Expressions cannot drive time' },
      ])
    })
  })

  describe('hooks', () => {
    it('reports an unavailable prop once and evaluates to zero for it', () => {
      const c = clip({ keyframes: { channels: { x: expr('prop("title") + 1') } } })
      const ctx = createExpressionContext(project([c]), 0)
      expect(ctx.evaluatorFor(c, 0, DEFAULT_TEXT_TRANSFORM)!('x', undefined)).toBe(1)
      expect(ctx.errors.filter((e) => e.code === 'prop-unavailable')).toHaveLength(1)
    })

    it('uses a supplied prop', () => {
      const c = clip({ keyframes: { channels: { x: expr('prop("title") + 1') } } })
      const ctx = createExpressionContext(project([c]), 0, { prop: () => 2 })
      expect(ctx.evaluatorFor(c, 0, DEFAULT_TEXT_TRANSFORM)!('x', undefined)).toBe(3)
      expect(ctx.errors).toHaveLength(0)
    })
  })

  describe('composition prop fallback (PV-P7a-2)', () => {
    it('reads the project composition when no hook is given', () => {
      const c = clip({ keyframes: { channels: { x: expr('prop("level") + 1') } } })
      const composition = { props: [{ name: 'level', type: 'number' as const, default: 0.5, label: 'Level' }], bindings: [] }
      const withComp = { ...project([c]), composition }
      const ctx = createExpressionContext(withComp, 0)
      expect(ctx.evaluatorFor(c, 0, DEFAULT_TEXT_TRANSFORM)!('x', undefined)).toBe(1.5)
      expect(ctx.errors).toHaveLength(0)
    })

    it('reads a stored composition value over the default', () => {
      const c = clip({ keyframes: { channels: { x: expr('prop("level") + 1') } } })
      const composition = {
        props: [{ name: 'level', type: 'number' as const, default: 0.5, label: 'Level' }],
        bindings: [],
        values: { level: 2 },
      }
      const withComp = { ...project([c]), composition }
      const ctx = createExpressionContext(withComp, 0)
      expect(ctx.evaluatorFor(c, 0, DEFAULT_TEXT_TRANSFORM)!('x', undefined)).toBe(3)
    })

    it('an explicit hook still wins over the composition', () => {
      const c = clip({ keyframes: { channels: { x: expr('prop("level") + 1') } } })
      const composition = { props: [{ name: 'level', type: 'number' as const, default: 0.5, label: 'Level' }], bindings: [] }
      const withComp = { ...project([c]), composition }
      const ctx = createExpressionContext(withComp, 0, { prop: () => 10 })
      expect(ctx.evaluatorFor(c, 0, DEFAULT_TEXT_TRANSFORM)!('x', undefined)).toBe(11)
    })

    it('a project with no composition and no hook is unaffected', () => {
      const c = clip({ keyframes: { channels: { x: expr('prop("level") + 1') } } })
      const ctx = createExpressionContext(project([c]), 0)
      expect(ctx.evaluatorFor(c, 0, DEFAULT_TEXT_TRANSFORM)!('x', undefined)).toBe(1)
      expect(ctx.errors.filter((e) => e.code === 'prop-unavailable')).toHaveLength(1)
    })
  })

  describe('wiggle seeding', () => {
    it('is per clip id and channel, and matches the context formula', () => {
      const c = clip({ id: 'clip-1', keyframes: { channels: { x: expr('wiggle(2, 0.1)'), y: expr('wiggle(2, 0.1)') } } })
      const ctx = createExpressionContext(project([c]), 0)
      const ev = ctx.evaluatorFor(c, 15, DEFAULT_TEXT_TRANSFORM)!
      // t = 15/30 = 0.5, so t·freq = 1.
      const base = authoredChannelValue(c, 'x', DEFAULT_TEXT_TRANSFORM)
      expect(ev('x', undefined)).toBe(base + 0.1 * noise1(seedFor('clip-1', 'x'), 1))
      expect(ev('y', undefined)).not.toBe(ev('x', undefined))
    })
  })

  describe('sampleChannelExpression', () => {
    it('is empty for a keyed channel with no expression', () => {
      const c = clip({ keyframes: { channels: { x: { source: { kind: 'keyframes' }, keys: [k(0, 0.2)] } } } })
      expect(sampleChannelExpression(project([c]), c, 'x', 0)).toEqual({})
    })

    it('returns the value for a good expression', () => {
      const c = clip({ keyframes: { channels: { x: expr('value + 0.25') } } })
      const r = sampleChannelExpression(project([c]), c, 'x', 0)
      expect(r.error).toBeUndefined()
      expect(r.value).toBeCloseTo(DEFAULT_TEXT_TRANSFORM.x + 0.25, 10)
    })

    it('returns the error for a bad one', () => {
      const c = clip({ keyframes: { channels: { x: expr('nope') } } })
      const r = sampleChannelExpression(project([c]), c, 'x', 0)
      expect(r.value).toBeUndefined()
      expect(r.error?.code).toBe('unknown-identifier')
    })
  })

  describe('the parse cache is the path being measured', () => {
    it('returns the same AST for the same source', () => {
      const src = 'value * 2 + sin(t)'
      expect(parseExpression(src)).toBe(parseExpression(src))
    })
  })
})
