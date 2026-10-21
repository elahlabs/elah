import { describe, expect, it } from 'vitest'
import { TimelineEngine } from './TimelineEngine'
import { readProjectDocument } from './projectDocument'

function makeEngine(): TimelineEngine {
  return new TimelineEngine({ fps: 30, stage: { width: 640, height: 360 }, initialTracks: [] })
}

describe('TimelineEngine.setStyleKit (PQ-2c)', () => {
  it('sets, and clears with null', () => {
    const engine = makeEngine()
    engine.setStyleKit('dark')
    expect(engine.getProject().styleKit).toBe('dark')
    engine.setStyleKit(null)
    expect('styleKit' in engine.getProject()).toBe(false)
  })

  it('is one undo step, and redo restores it', () => {
    const engine = makeEngine()
    engine.setStyleKit('dark')
    engine.undo()
    expect(engine.getProject().styleKit).toBeUndefined()
    engine.redo()
    expect(engine.getProject().styleKit).toBe('dark')
  })

  it('does not bump the project version', () => {
    const engine = makeEngine()
    const before = engine.getProject().version
    engine.setStyleKit('dark')
    expect(engine.getProject().version).toBe(before)
  })

  it('survives a JSON round trip through readProjectDocument, twice; an unknown id is kept', () => {
    const engine = makeEngine()
    engine.setStyleKit('from-a-newer-build')
    const once = readProjectDocument(JSON.parse(JSON.stringify(engine.getProject())))
    expect(once.styleKit).toBe('from-a-newer-build')
    const twice = readProjectDocument(JSON.parse(JSON.stringify(once)))
    expect(twice.styleKit).toBe('from-a-newer-build')
  })

  it('drops an over-long, empty or non-string id on read', () => {
    const doc = JSON.parse(JSON.stringify(makeEngine().getProject()))
    expect(readProjectDocument({ ...doc, styleKit: 'x'.repeat(41) }).styleKit).toBeUndefined()
    expect(readProjectDocument({ ...doc, styleKit: '' }).styleKit).toBeUndefined()
    expect(readProjectDocument({ ...doc, styleKit: 7 }).styleKit).toBeUndefined()
    expect(readProjectDocument({ ...doc, styleKit: 'x'.repeat(40) }).styleKit).toBe('x'.repeat(40))
  })
})
