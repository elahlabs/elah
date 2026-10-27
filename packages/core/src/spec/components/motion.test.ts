import { describe, expect, it } from 'vitest'
import { parseExpression } from '../../resolver/expr/parse'
import { compileVideoSpec } from '../compile'
import { DEFAULT_MOTION_STYLE, type ComponentContext, type MotionStyle } from './types'
import { ENERGY_TIME_SCALE, seededRandom } from './index'
import {
  ARRIVE_SEC,
  EXIT_SEC,
  bracketCorners,
  breathe,
  cameraPush,
  elbowPath,
  exitOut,
  floatY,
  flyInX,
  handEllipsePath,
  mergeKeys,
  popIn,
  readingSeconds,
  riseIn,
  spin,
  staggerAt,
  underlinePath,
} from './motion'

const FORMAT = { width: 1080, height: 1920, fps: 30 }

function ctxFor(style: Partial<MotionStyle> = {}): ComponentContext {
  const s = { ...DEFAULT_MOTION_STYLE, ...style }
  return {
    format: FORMAT,
    style: s,
    color: (r) => `#${r === 'accent' ? '22c55e' : '111111'}`,
    font: () => 'inter',
    random: seededRandom(1),
    t: (sec) => sec * ENERGY_TIME_SCALE[s.energy],
    path: 'elements[0]',
    issues: [],
  }
}

describe('timing', () => {
  it('reading time grows with words', () => {
    expect(readingSeconds('Hi')).toBeCloseTo(0.3 + 1 / 3.5)
    expect(readingSeconds('one two three four five six seven')).toBeCloseTo(2.3)
  })

  it('stagger is energy-scaled', () => {
    expect(staggerAt(ctxFor(), 1, 3)).toBeCloseTo(1.21)
    expect(staggerAt(ctxFor({ energy: 'bold' }), 1, 3)).toBeLessThan(staggerAt(ctxFor({ energy: 'calm' }), 1, 3))
  })
})

describe('arrivals and exits', () => {
  it('riseIn fades up and lands on its base y with a spring, from below', () => {
    const keys = riseIn(ctxFor(), 0.5)
    const y = keys.filter((k) => k.channel === 'y')
    expect(y[0].value).toBeGreaterThan(0.5)
    expect(y[1]).toMatchObject({ value: 0.5, curve: 'spring:snappy' })
    expect(keys.filter((k) => k.channel === 'opacity').map((k) => k.value)).toEqual([0, 1])
  })

  it('exits are quicker than arrivals and ease IN', () => {
    expect(EXIT_SEC).toBeLessThan(ARRIVE_SEC)
    const keys = exitOut(ctxFor(), 3)
    expect(keys.find((k) => k.channel === 'opacity' && k.value === 0)).toMatchObject({ at: 3, curve: 'quad-in' })
    expect(keys[0].at).toBeCloseTo(3 - EXIT_SEC)
  })

  it('calm pops from larger and settles gently', () => {
    expect(popIn(ctxFor({ energy: 'calm' }))[2].value).toBeGreaterThan(popIn(ctxFor())[2].value)
    expect(popIn(ctxFor({ energy: 'calm' }))[3].curve).toBe('spring:gentle')
  })

  it('flyInX starts at fromX and settles on baseX', () => {
    const x = flyInX(ctxFor(), 0.4, -0.2).filter((k) => k.channel === 'x')
    expect(x.map((k) => k.value)).toEqual([-0.2, 0.4])
  })

  it('mergeKeys keeps a pop-in and an exit on the same channel from interleaving', () => {
    const merged = mergeKeys(popIn(ctxFor()), exitOut(ctxFor(), 3))
    const scale = merged.filter((k) => k.channel === 'scale').map((k) => k.at)
    expect(scale).toEqual([...scale].sort((a, b) => a - b))
    expect(scale).toHaveLength(4)
  })
})

describe('expressions parse in the engine grammar', () => {
  it.each([
    ['floatY', floatY(ctxFor(), 6, 3.2, 0.4).source],
    ['breathe', breathe(0.02, 4, 1).source],
    ['spin', spin(90).source],
  ])('%s', (_name, source) => {
    const parsed = parseExpression(source)
    expect(parsed.ok, JSON.stringify(parsed)).toBe(true)
    expect(source.length).toBeLessThanOrEqual(512)
  })

  it('spin writes degrees per second as radians', () => {
    expect(spin(180).source).toBe('value + t * 1 * PI')
  })
})

describe('drawn paths are deterministic per seed', () => {
  it('handEllipsePath and underlinePath repeat for one seed and differ across seeds', () => {
    expect(handEllipsePath(seededRandom(4))).toBe(handEllipsePath(seededRandom(4)))
    expect(handEllipsePath(seededRandom(4))).not.toBe(handEllipsePath(seededRandom(5)))
    expect(underlinePath(seededRandom(4))).toMatch(/^M /)
  })

  it('elbowPath runs horizontal, then vertical', () => {
    expect(elbowPath(100, 50, 'up-right')).toBe('M 0 50 L 50 50 L 50 0 L 100 0')
  })

  it('bracket corners sit INSIDE the box, outer edges on its corners', () => {
    const [tl, , , br] = bracketCorners('b', { x: 0.5, y: 0.5, w: 400, h: 200 }, FORMAT, { at: 0, duration: 1 }, 40)
    // tl centre = box left + arm/2, box top + arm/2
    expect(tl.x).toBeCloseTo(0.5 - (400 - 40) / 2 / 1080)
    expect(tl.y).toBeCloseTo(0.5 - (200 - 40) / 2 / 1920)
    expect(br.x).toBeCloseTo(0.5 + (400 - 40) / 2 / 1080)
  })
})

describe('everything the toolkit makes compiles clean', () => {
  it('an element carrying every helper compiles with no error issues', () => {
    const ctx = ctxFor()
    const { issues } = compileVideoSpec({
      format: FORMAT,
      duration: 4,
      elements: [
        {
          id: 't',
          kind: 'text',
          text: 'Hello',
          size: 80,
          at: 0,
          duration: 3,
          x: 0.5,
          y: 0.5,
          keys: mergeKeys(riseIn(ctx, 0.5), exitOut(ctx, 3)),
          expressions: [floatY(ctx)],
        },
        { id: 'g', kind: 'group', at: 0, duration: 4, keys: cameraPush(4), children: [] },
        {
          id: 'loop',
          kind: 'shape',
          shape: 'path',
          path: handEllipsePath(ctx.random),
          viewBox: { x: 0, y: 0, width: 100, height: 40 },
          w: 600,
          h: 240,
          stroke: '#22c55e',
          strokeWidth: 8,
          at: 0,
          duration: 3,
          draw: { at: 0.5, duration: 0.7, curve: 'cubic-out' },
        },
      ],
    })
    expect(issues.filter((i) => i.severity === 'error')).toEqual([])
  })
})
