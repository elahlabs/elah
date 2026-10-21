import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import { opDescriber } from './describeOp'
import { sanitizeOps } from './sanitize'
import { EDITOR_OP_NAMES } from './types'

/** `insertStock` (AGN-P9): sanitised and described here; resolved client-side, so it has no `applyOps` case. */

const engine = () => new TimelineEngine({ fps: 30, initialTracks: [] })
const clean = (raw: unknown[]) => sanitizeOps(raw, engine().getProject())

describe('insertStock sanitising', () => {
  it('is a registered op name', () => {
    expect(EDITOR_OP_NAMES).toContain('insertStock')
  })

  it('keeps a good op, defaults kind to video and trims the query to 120 characters', () => {
    const r = clean([{ op: 'insertStock', query: `  city traffic ${'x'.repeat(200)}  `, at: 12, duration: 3 }])
    expect(r.dropped).toEqual([])
    const op = r.ops[0] as Extract<(typeof r.ops)[number], { op: 'insertStock' }>
    expect(op).toMatchObject({ op: 'insertStock', at: 12, duration: 3, kind: 'video' })
    expect(op.query.length).toBe(120)
    expect(op.query.startsWith('city traffic')).toBe(true)
  })

  it('carries an explicit photo kind and an explicit false for overlay and mute, and nothing else', () => {
    const r = clean([{ op: 'insertStock', query: 'tea', duration: 2, kind: 'photo', overlay: false, mute: false, at: null }])
    expect(r.ops[0]).toEqual({ op: 'insertStock', query: 'tea', duration: 2, kind: 'photo', overlay: false, mute: false })
  })

  it('drops an empty query with a reason', () => {
    const r = clean([{ op: 'insertStock', query: '   ', duration: 3 }])
    expect(r.ops).toEqual([])
    expect(r.dropped[0]!.reason).toMatch(/query is empty/)
  })

  it.each([0.4, 31, 500])('drops a duration of %s outside 0.5-30 with a reason', (duration) => {
    const r = clean([{ op: 'insertStock', query: 'sea', duration }])
    expect(r.ops).toEqual([])
    expect(r.dropped[0]!.reason).toMatch(/0\.5-30/)
  })

  it('drops a missing duration and an unknown kind', () => {
    expect(clean([{ op: 'insertStock', query: 'sea' }]).dropped[0]!.reason).toMatch(/duration/)
    expect(clean([{ op: 'insertStock', query: 'sea', duration: 3, kind: 'gif' }]).dropped[0]!.reason).toMatch(/stock kind/)
  })
})

describe('insertStock description', () => {
  const say = opDescriber(engine().getProject())
  it('reads as a sentence with the query, length and time', () => {
    expect(say({ op: 'insertStock', query: 'city traffic at night', at: 12, duration: 3 })).toBe('Insert stock "city traffic at night" 3.0s at 0:12')
  })
  it('says where an append lands', () => {
    expect(say({ op: 'insertStock', query: 'sea', duration: 4.5 })).toBe('Insert stock "sea" 4.5s at the end of the lane')
  })
})
