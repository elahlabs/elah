/**
 * MC-1d: the four Tier A fields survive save -> load -> JSON export -> import,
 * and reach the resolved scene the painters read.
 *
 * "Save" is `getProject()` through `JSON.stringify` (what autosave and the JSON
 * export write); "load/import" is `readProjectDocument` (the one reader every
 * stored blob goes through) then `loadProject`. The last hop, `resolveTimeline`,
 * is checked too, because a field the reader keeps but the resolver forgets to
 * copy is a field that never paints.
 */
import { describe, expect, it } from 'vitest'
import { TimelineEngine } from './TimelineEngine'
import { readProjectDocument } from './projectDocument'
import { resolveTimeline } from '../resolver/resolveTimeline'
import type { Clip, Paint, Project, TextShadow } from '../types'

const SHADOW: TextShadow = { color: 'rgba(0,0,0,0.5)', blur: 20, offsetX: 4, offsetY: 10 }
const CONIC: Paint = {
  type: 'conic',
  angle: 30,
  cx: 0.4,
  cy: 0.6,
  stops: [
    { offset: 0, color: '#f00' },
    { offset: 1, color: '#00f' },
  ],
}

function build(): { project: Project; shapeId: string; textId: string; trackId: string } {
  const engine = new TimelineEngine({ fps: 30, stage: { width: 1920, height: 1080 } })
  const track = engine.addTrack('elements')
  const shape = engine.addClip({
    trackId: track.id,
    type: 'shape',
    startFrame: 0,
    durationFrames: 60,
    shape: { shapeKind: 'rect', shapeFill: '#fff' },
  })
  engine.updateClip(shape.id, track.id, {
    shadow: SHADOW,
    cornerRadii: [0.1, 0.2, 0.3, 0.4],
    shapeFillPaint: CONIC,
  })
  const text = engine.addClip({
    trackId: track.id,
    type: 'text',
    startFrame: 60,
    durationFrames: 60,
    text: { content: 'Hello' },
  })
  engine.updateClip(text.id, track.id, {
    backgroundColor: '#fff',
    shadow: SHADOW,
    textDecoration: 'underline',
    textFill: CONIC,
  })
  return { project: engine.getProject(), shapeId: shape.id, textId: text.id, trackId: track.id }
}

const clipOf = (project: Project, trackId: string, id: string): Clip =>
  project.clips[trackId]!.find((c) => c.id === id)!

describe('Tier A fields: save -> load -> JSON export -> import', () => {
  it('round-trips unchanged through JSON and the document reader', () => {
    const { project, shapeId, textId, trackId } = build()
    const read = readProjectDocument(JSON.parse(JSON.stringify(project)))

    const shape = clipOf(read, trackId, shapeId)
    expect(shape.shadow).toEqual(SHADOW)
    expect(shape.cornerRadii).toEqual([0.1, 0.2, 0.3, 0.4])
    expect(shape.shapeFillPaint).toEqual(CONIC)

    const text = clipOf(read, trackId, textId)
    expect(text.shadow).toEqual(SHADOW)
    expect(text.textDecoration).toBe('underline')
    expect(text.textFill).toEqual(CONIC)

    // Import into a fresh engine and export again: the second blob matches the first.
    const engine = new TimelineEngine({ fps: 30, stage: { width: 1920, height: 1080 } })
    engine.loadProject(read)
    const again = JSON.parse(JSON.stringify(engine.getProject()))
    expect(clipOf(again, trackId, shapeId).cornerRadii).toEqual([0.1, 0.2, 0.3, 0.4])
    expect(clipOf(again, trackId, textId).textDecoration).toBe('underline')
  })

  it('reaches the resolved scene the painters read', () => {
    const { project, shapeId, textId } = build()
    const early = resolveTimeline(10, project).shapes.find((s) => s.id === shapeId)!
    expect(early.shadow).toEqual(SHADOW)
    expect(early.cornerRadii).toEqual([0.1, 0.2, 0.3, 0.4])
    expect(early.shapeFillPaint).toEqual(CONIC)
    const late = resolveTimeline(70, project).texts.find((t) => t.id === textId)!
    expect(late.shadow).toEqual(SHADOW)
    expect(late.textDecoration).toBe('underline')
  })

  it('a clip without the fields resolves with no such keys', () => {
    const engine = new TimelineEngine({ fps: 30, stage: { width: 1920, height: 1080 } })
    const track = engine.addTrack('elements')
    engine.addClip({ trackId: track.id, type: 'shape', startFrame: 0, durationFrames: 30, shape: { shapeKind: 'rect' } })
    engine.addClip({ trackId: track.id, type: 'text', startFrame: 30, durationFrames: 30, text: { content: 'x' } })
    const project = engine.getProject()
    const shape = resolveTimeline(0, project).shapes[0]!
    const text = resolveTimeline(40, project).texts[0]!
    for (const key of ['shadow', 'cornerRadii']) expect(key in shape).toBe(false)
    for (const key of ['shadow', 'textDecoration']) expect(key in text).toBe(false)
  })

  it('malformed stored values are dropped, not carried to a painter', () => {
    const { project, shapeId, textId, trackId } = build()
    const raw = JSON.parse(JSON.stringify(project))
    const shapeRaw = raw.clips[trackId].find((c: Clip) => c.id === shapeId)
    shapeRaw.shadow = { color: 5, blur: 'x' }
    shapeRaw.cornerRadii = [0.1, 0.2]
    const textRaw = raw.clips[trackId].find((c: Clip) => c.id === textId)
    textRaw.textDecoration = 'overline'
    const read = readProjectDocument(raw)
    const shape = clipOf(read, trackId, shapeId)
    expect('shadow' in shape).toBe(false)
    expect('cornerRadii' in shape).toBe(false)
    expect('textDecoration' in clipOf(read, trackId, textId)).toBe(false)
  })
})
