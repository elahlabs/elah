import { describe, expect, it } from 'vitest'
import {
  channelExpression,
  parseExpression,
  setChannelExpression,
  type BaselineContext,
  type Clip,
  type Project,
} from '@elah/core'
import { commitExpression, expressionStatus, formatExpressionValue } from './expressionEdit'
import { springFixture } from './animationFixture'

const STAGE = { width: 1920, height: 1080 }
const CTX: BaselineContext = { stage: STAGE }

/** The P5a fixture: a text clip whose `x` runs 0.3 → 0.7 with a spring. */
function setup() {
  const { project, clipId } = springFixture({ preset: 'bouncy', span: 60 })
  return { project: project as unknown as Project, clip: project.clips['el-1']![0] as unknown as Clip, clipId }
}

const apply = (clip: Clip, patch: Partial<Clip>): Clip => ({ ...clip, ...patch })

describe('formatExpressionValue', () => {
  it('is three decimals with a leading equals', () => {
    expect(formatExpressionValue(1.23456)).toBe('= 1.235')
    expect(formatExpressionValue(0.4)).toBe('= 0.400')
  })

  it('never prints negative zero', () => {
    // `-0` is a real value the arithmetic can produce, and `(-0).toFixed(3)` is
    // "-0.000" — which reads as a bug to whoever is watching the playhead. A
    // small NEGATIVE number rounds to the same string and needs the same fix.
    expect(formatExpressionValue(-0)).toBe('= 0.000')
    expect(formatExpressionValue(-0.0001)).toBe('= 0.000')
    expect(formatExpressionValue(-0.0004)).toBe('= 0.000')
    // The boundary: toFixed rounds half AWAY from zero, so -0.0005 is a real
    // -0.001 and must keep its sign. Only the exact "-0.000" is normalised.
    expect(formatExpressionValue(-0.0005)).toBe('= -0.001')
    expect(formatExpressionValue(-1.5)).toBe('= -1.500')
  })
})

describe('expressionStatus', () => {
  it('is empty for a blank draft, whatever the whitespace', () => {
    const { project, clip } = setup()
    expect(expressionStatus(project, clip, 'x', '', 0)).toEqual({ kind: 'empty' })
    expect(expressionStatus(project, clip, 'x', '   ', 0)).toEqual({ kind: 'empty' })
  })

  it('is an error when the draft does not parse, with the parser message', () => {
    const { project, clip } = setup()
    const s = expressionStatus(project, clip, 'x', 'value +', 0)
    expect(s.kind).toBe('error')
    // The parser's own message, verbatim: the author has to be able to match
    // what the row says to what the language actually objects to.
    const parsed = parseExpression('value +')
    expect(parsed.ok).toBe(false)
    if (s.kind === 'error' && !parsed.ok) expect(s.message).toBe(parsed.message)
    // Pinned too, so a change in the parser's wording is noticed here rather
    // than showing up as a mystery UI diff.
    expect(s.kind === 'error' && s.message).toBe('Unexpected end of expression')
  })

  it('is pending for a valid draft that is not stored yet', () => {
    const { project, clip } = setup()
    expect(expressionStatus(project, clip, 'x', 'value + 0.1', 0)).toEqual({ kind: 'pending' })
  })

  it('shows the evaluated value once the draft is stored', () => {
    const { project, clip } = setup()
    const stored = apply(clip, commitExpression(clip, 'x', ' value + 0.1 ', CTX))
    // The fixture's key 0 is 0.3, so `value + 0.1` is 0.4 at local frame 0.
    expect(expressionStatus(project, stored, 'x', 'value + 0.1', 0)).toEqual({ kind: 'value', text: '= 0.400' })
  })

  it('reports a notice for an unavailable prop but still shows a value', () => {
    // `prop()` is PV-P7a's data; until then it is unavailable, which is a NOTICE
    // rather than a failure — the rest of the expression still evaluates.
    const { project, clip } = setup()
    const stored = apply(clip, commitExpression(clip, 'x', 'prop("a") + value', CTX))
    const s = expressionStatus(project, stored, 'x', 'prop("a") + value', 0)
    expect(s.kind).toBe('value')
    if (s.kind === 'value') {
      expect(s.notice).toContain('prop("a")')
      expect(s.text).toMatch(/^= /)
    }
  })

  it('is an error for a stored expression that fails at runtime', () => {
    const { project, clip } = setup()
    const stored = apply(clip, commitExpression(clip, 'x', 'clip("nobody").x', CTX))
    const s = expressionStatus(project, stored, 'x', 'clip("nobody").x', 0)
    expect(s.kind).toBe('error')
    if (s.kind === 'error') expect(s.message).toBe('No clip "nobody"')
  })

  it('is pending, not an error, when a runtime-failing draft is not stored', () => {
    // The author has not pressed Enter yet, so nothing is wrong with the clip.
    const { project, clip } = setup()
    expect(expressionStatus(project, clip, 'x', 'clip("nobody").x', 0)).toEqual({ kind: 'pending' })
  })
})

describe('commitExpression', () => {
  it('trims before writing', () => {
    const { clip } = setup()
    const out = apply(clip, commitExpression(clip, 'x', '  value + 1  ', CTX))
    expect(channelExpression(out, 'x')).toBe('value + 1')
  })

  it('removes the expression for a blank draft', () => {
    const { clip } = setup()
    const stored = apply(clip, commitExpression(clip, 'x', 'value + 1', CTX))
    expect(channelExpression(stored, 'x')).toBe('value + 1')
    const cleared = apply(stored, commitExpression(stored, 'x', '', CTX))
    expect(channelExpression(cleared, 'x')).toBeUndefined()
  })

  it('returns an empty patch for a channel that cannot take one', () => {
    const { clip } = setup()
    expect(commitExpression(clip, 'time', 'value', CTX)).toEqual({})
  })

  it('bakes the baseline on a transform-less clip, like the other writers', () => {
    const { clip } = setup()
    const bare = { ...clip, transform: undefined } as Clip
    expect(commitExpression(bare, 'x', 'value + 1', CTX).transform).toBeTruthy()
  })
})
