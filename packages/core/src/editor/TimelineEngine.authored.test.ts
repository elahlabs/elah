import { describe, expect, it } from 'vitest'
import { TimelineEngine } from './TimelineEngine'
import type { ProjectAuthored } from '../types'

function makeEngine(): TimelineEngine {
  return new TimelineEngine({ fps: 30, stage: { width: 640, height: 360 }, initialTracks: [] })
}

function makeAuthored(): ProjectAuthored {
  return {
    v: 1,
    spec: { format: { width: 640, height: 360, fps: 30 }, elements: [{ id: 'a' }] },
    treatment: { idea: 'x' },
    seed: 4,
    model: 'm',
    createdAt: '2026-10-07T00:00:00.000Z',
  }
}

describe('TimelineEngine.setAuthored (EG-P1)', () => {
  it('sets, and clears with undefined', () => {
    const engine = makeEngine()
    const authored = makeAuthored()
    engine.setAuthored(authored)
    expect(engine.getProject().authored).toEqual(authored)
    engine.setAuthored(undefined)
    expect(engine.getProject().authored).toBeUndefined()
    expect('authored' in engine.getProject()).toBe(false)
  })

  it('is one undo step, and redo restores it', () => {
    const engine = makeEngine()
    engine.setAuthored(makeAuthored())
    engine.undo()
    expect(engine.getProject().authored).toBeUndefined()
    engine.redo()
    expect(engine.getProject().authored).toEqual(makeAuthored())
  })

  it('clones its input: mutating the argument afterwards does not change the engine', () => {
    const engine = makeEngine()
    const authored = makeAuthored()
    engine.setAuthored(authored)
    ;(authored.spec as { elements: unknown[] }).elements.push({ id: 'b' })
    authored.seed = 99
    expect(engine.getProject().authored).toEqual(makeAuthored())
  })

  it('does not bump the project version', () => {
    const engine = makeEngine()
    const before = engine.getProject().version
    engine.setAuthored(makeAuthored())
    expect(engine.getProject().version).toBe(before)
  })
})
