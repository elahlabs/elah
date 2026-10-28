import { describe, expect, it, vi } from 'vitest'
import { evaluateExpression, type EvalContext } from './evaluate'
import { clearExpressionCache, parseExpression, type ExprNode } from './parse'
import {
  CLIP_VIEW_FIELDS,
  EASE_NAMES,
  EXPR_FUNCTIONS,
  EXPR_IDENTIFIERS,
  MAX_EXPRESSION_LENGTH,
  MAX_EXPRESSION_NODES,
  MAX_STRING_LITERAL,
  STAGE_FIELDS,
  seedFor,
  type ExprClipView,
  type ExprEnv,
} from './scope'
import { noise1 } from '../../elements/noise'
import { physicalSpring, springProgress } from '../spring'
import { cubicBezier } from '../bezier'
import { evaluateEasing } from '../textAnimation'
import { findSpringPreset } from '../../elements/springPresets'

// --- scope (step 1's tests live here, per the ticket) -----------------------

describe('scope', () => {
  it('hashes a channel to the reference seeds', () => {
    // Pinned numbers: the seed decides which way a channel wobbles, so a change
    // here silently re-randomises every existing wiggle in every document.
    expect(seedFor('clip-1', 'x')).toBe(4150105411)
    expect(seedFor('clip-1', 'y')).toBe(4133327792)
    expect(seedFor('a', 'x')).toBe(582856238)
  })

  it('returns an unsigned 32-bit seed', () => {
    for (const c of ['x', 'y', 'scale', 'a-very-long-channel-name-indeed']) {
      const s = seedFor('clip-1', c)
      expect(Number.isInteger(s)).toBe(true)
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(0xffffffff)
    }
  })

  it('separates channels and clips', () => {
    expect(seedFor('clip-1', 'x')).not.toBe(seedFor('clip-1', 'y'))
    expect(seedFor('clip-1', 'x')).not.toBe(seedFor('clip-2', 'x'))
  })

  it('has exactly the 24 whitelisted functions', () => {
    expect(EXPR_FUNCTIONS.size).toBe(24)
    expect([...EXPR_FUNCTIONS.keys()].sort()).toEqual(
      [
        'abs', 'audio', 'ceil', 'clamp', 'cos', 'ease', 'exp', 'floor', 'lerp', 'log', 'max', 'min',
        'pow', 'prop', 'pulse', 'pingpong', 'loop', 'round', 'sin', 'smoothstep', 'spring', 'sqrt',
        'clip', 'wiggle',
      ].sort(),
    )
  })

  it('keeps the bounds the parser enforces', () => {
    expect(MAX_EXPRESSION_LENGTH).toBe(512)
    expect(MAX_EXPRESSION_NODES).toBe(256)
    expect(MAX_STRING_LITERAL).toBe(64)
  })

  it('names the readable identifiers, fields and stage fields', () => {
    expect([...EXPR_IDENTIFIERS].sort()).toEqual(['PI', 'duration', 'fps', 'frame', 'progress', 'stage', 't', 'value'])
    expect([...STAGE_FIELDS].sort()).toEqual(['height', 'width'])
    expect(CLIP_VIEW_FIELDS.size).toBe(9)
  })

  it('accepts both curve vocabularies, and namespaces the spring ids', () => {
    expect(EASE_NAMES.has('ease')).toBe(true)
    expect(EASE_NAMES.has('overshoot')).toBe(true)
    expect(EASE_NAMES.has('quad-out')).toBe(true)
    expect(EASE_NAMES.has('spring:bouncy')).toBe(true)
    // A bare `bouncy` is NOT a curve: the ids are namespaced so they cannot be
    // confused with a bezier preset of the same name (`snappy` is both).
    expect(EASE_NAMES.has('bouncy')).toBe(false)
    expect(EASE_NAMES.has('snappy')).toBe(true)
  })
})

// --- evaluation --------------------------------------------------------------

const VIEW_A: ExprClipView = {
  x: 0.1, y: 0.2, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, opacity: 0.5, start: 2, duration: 4,
}

const baseEnv = (): ExprEnv => ({
  t: 1.5,
  frame: 45,
  fps: 30,
  duration: 3,
  progress: 0.5,
  value: 0.25,
  stage: { width: 1920, height: 1080 },
  clip: (id) => (id === 'A' ? VIEW_A : undefined),
})

const ctxWith = (over: Partial<EvalContext> = {}): EvalContext => ({
  env: baseEnv(),
  seed: seedFor('clip-1', 'x'),
  report: vi.fn(),
  ...over,
})

/** Parse then evaluate; a parse failure is a test bug and throws. */
function run(source: string, ctx: EvalContext = ctxWith()) {
  const parsed = parseExpression(source)
  if (!parsed.ok) throw new Error(`expected ${source} to parse, got ${parsed.code}: ${parsed.message}`)
  return evaluateExpression(parsed.ast, ctx)
}

/** The value of a source that must succeed. */
function val(source: string, ctx: EvalContext = ctxWith()): number {
  const r = run(source, ctx)
  if (!r.ok) throw new Error(`expected ${source} to evaluate, got ${r.code}: ${r.message}`)
  return r.value
}

/** The error code of a source that must fail at runtime. */
function errCode(source: string, ctx: EvalContext = ctxWith()): string {
  const r = run(source, ctx)
  if (r.ok) throw new Error(`expected ${source} to fail, got ${r.value}`)
  return r.code
}

describe('arithmetic', () => {
  it('follows the precedence rules end to end', () => {
    expect(val('1 + 2 * 3')).toBe(7)
    expect(val('(1 + 2) * 3')).toBe(9)
    expect(val('2 ^ 3 ^ 2')).toBe(512)
    expect(val('-2 ^ 2')).toBe(-4)
    expect(val('2 ^ -1')).toBe(0.5)
    expect(val('10 % 4')).toBe(2)
  })

  it('treats comparisons and logic as numbers', () => {
    expect(val('1 < 2')).toBe(1)
    expect(val('2 <= 1')).toBe(0)
    expect(val('1 == 1')).toBe(1)
    expect(val('!0')).toBe(1)
    expect(val('!3')).toBe(0)
    expect(val('0 || 3')).toBe(1)
    expect(val('2 && 0')).toBe(0)
    expect(val('1 ? 2 : 3')).toBe(2)
    expect(val('0 ? 2 : 0 ? 4 : 5')).toBe(5)
  })
})

describe('scope', () => {
  it('reads every identifier from the env', () => {
    expect(val('t * 2')).toBe(3)
    expect(val('frame')).toBe(45)
    expect(val('fps')).toBe(30)
    expect(val('duration')).toBe(3)
    expect(val('progress')).toBe(0.5)
    expect(val('value')).toBe(0.25)
    expect(val('PI')).toBe(Math.PI)
  })

  it('reads stage and clip members', () => {
    expect(val('stage.width / 2')).toBe(960)
    expect(val('stage.height')).toBe(1080)
    expect(val('clip("A").opacity + clip("A").start')).toBe(2.5)
  })
})

describe('functions', () => {
  it('does the arithmetic ones', () => {
    expect(val('clamp(5, 0, 1)')).toBe(1)
    expect(val('lerp(0, 10, 0.25)')).toBe(2.5)
    expect(val('smoothstep(0, 1, 0.25)')).toBe(0.15625)
    expect(val('smoothstep(1, 1, 0.5)')).toBe(0)
    expect(val('min(3, 1, 2)')).toBe(1)
    expect(val('max(3)')).toBe(3)
    expect(val('round(2.5)')).toBe(3)
    // Math.round, so it rounds half UP and -2.5 becomes -2, not -3.
    expect(val('round(-2.5)')).toBe(-2)
    expect(val('pow(2, 10)')).toBe(1024)
  })

  it('loops, folds and pulses', () => {
    expect(val('loop(5.5, 2)')).toBe(1.5)
    // A negative x must fold forward, not return a negative remainder.
    expect(val('loop(-0.5, 2)')).toBe(1.5)
    expect(val('pingpong(3, 2)')).toBe(1)
    expect(val('pingpong(0.5, 2)')).toBe(0.5)
    expect(val('pulse(0.2, 1)')).toBe(1)
    expect(val('pulse(0.7, 1)')).toBe(0)
    expect(val('pulse(0.7, 1, 0.8)')).toBe(1)
  })

  it('eases through the same maths the keyframes use', () => {
    expect(val('ease(0)')).toBe(0)
    expect(val('ease(2)')).toBe(1)
    expect(val('ease(0.5)')).toBeCloseTo(cubicBezier([0.25, 0.1, 0.25, 1], 0.5), 10)
    expect(val('ease(0.5, "quad-out")')).toBeCloseTo(evaluateEasing('quad-out', 0.5), 10)
    // The spring and the keyframe curve are the same function: a bezier preset
    // named "snappy" and a spring named "snappy" must not collide.
    expect(val('ease(0.5, "spring:bouncy")')).toBeCloseTo(
      springProgress(findSpringPreset('bouncy')!.spring, 0.5),
      10,
    )
  })

  it('springs in real time, reusing PV-P5a exactly', () => {
    expect(val('spring(0.5)')).toBeCloseTo(1.0745906, 6)
    expect(val('spring(0)')).toBe(0)
    expect(val('spring(0.1, 100, 20)')).toBe(physicalSpring(0.1, 100, 20))
  })

  it('wriggles around the channel value with layered noise', () => {
    const seed = seedFor('clip-1', 'x')
    const ctx = ctxWith({ seed })
    // One octave is exactly value + amp·noise1(seed, t·freq).
    expect(val('wiggle(2, 0.1)', ctx)).toBe(0.25 + 0.1 * noise1(seed, 3))
    expect(val('wiggle(2, 0.1, 2)', ctx)).toBe(
      0.25 + (0.1 * (noise1(seed, 3) + 0.5 * noise1(seed + 7919, 6))) / 1.5,
    )
  })

  it('gives each channel its own wobble and is deterministic', () => {
    const x = ctxWith({ seed: seedFor('clip-1', 'x') })
    const y = ctxWith({ seed: seedFor('clip-1', 'y') })
    expect(val('wiggle(2, 0.1)', x)).not.toBe(val('wiggle(2, 0.1)', y))
    // Same seed, same number: the export worker must reproduce the preview.
    expect(val('wiggle(2, 0.1)', x)).toBe(val('wiggle(2, 0.1)', ctxWith({ seed: seedFor('clip-1', 'x') })))
  })
})

describe('runtime errors', () => {
  it('reports a non-finite result', () => {
    expect(errCode('sqrt(-1)')).toBe('non-finite')
    expect(errCode('1 / 0')).toBe('non-finite')
  })

  it('reports a clip that is not there', () => {
    expect(errCode('clip("B").x')).toBe('unknown-clip')
  })

  it('reports a bad domain', () => {
    expect(errCode('loop(1, 0)')).toBe('domain')
    expect(errCode('pingpong(1, -2)')).toBe('domain')
    expect(errCode('pulse(1, 0)')).toBe('domain')
  })
})

describe('notices', () => {
  it('treats an unavailable prop as zero and says so once', () => {
    const report = vi.fn()
    const r = run('prop("title") + 1', ctxWith({ report }))
    expect(r).toEqual({ ok: true, value: 1 })
    expect(report).toHaveBeenCalledTimes(1)
    expect(report.mock.calls[0]![0]).toBe('prop-unavailable')
  })

  it('uses a prop when the env has one, and stays quiet', () => {
    const report = vi.fn()
    const env = { ...baseEnv(), prop: () => 2 }
    expect(run('prop("title") + 1', ctxWith({ env, report }))).toEqual({ ok: true, value: 3 })
    expect(report).not.toHaveBeenCalled()
  })

  it('refuses a prop that is text', () => {
    const report = vi.fn()
    const env = { ...baseEnv(), prop: () => 'Hi' }
    expect(run('prop("title") + 1', ctxWith({ env, report }))).toMatchObject({ ok: false, code: 'type' })
  })

  it('treats unavailable audio as zero and says so', () => {
    const report = vi.fn()
    const r = run('audio("beat")', ctxWith({ report }))
    expect(r).toEqual({ ok: true, value: 0 })
    expect(report.mock.calls[0]![0]).toBe('audio-unavailable')
  })
})

describe('short-circuit', () => {
  it('never evaluates the untaken branch', () => {
    // If it did, `0 && clip("B").x` would report a missing clip for a branch
    // that never runs — the classic way a short-circuit stops being one.
    expect(val('0 && clip("B").x')).toBe(0)
    expect(val('1 || clip("B").x')).toBe(1)
    expect(val('1 ? 2 : clip("B").x')).toBe(2)
  })
})

describe('the evaluator trusts a parsed tree', () => {
  it('refuses a hand-built clip call with no field', () => {
    // The parser rejects this, so the AST can only be hand-made. Bailing with a
    // type error is better than reading an undefined member.
    const ast: ExprNode = { k: 'call', fn: 'clip', args: [{ k: 'str', v: 'A', pos: 0 }], pos: 0 }
    expect(evaluateExpression(ast, ctxWith())).toMatchObject({ ok: false, code: 'type' })
  })

  it('accepts an AST the parser produced', () => {
    clearExpressionCache()
    const parsed = parseExpression('t * 2')
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(evaluateExpression(parsed.ast, ctxWith())).toEqual({ ok: true, value: 3 })
  })
})
