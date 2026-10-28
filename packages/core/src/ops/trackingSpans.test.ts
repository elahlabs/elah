/**
 * MC-1g item 2: a `text.letterSpacing` key on text with styled spans and no
 * text box would move it to boxed layout, which does not apply spans. Refused
 * at sanitize with a reason, and the writer returns no patch.
 */
import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import { sanitizeOps } from './sanitize'
import { setKeyframe } from '../elements/keyframes'
import type { EditorOp } from './types'

const STAGE = { width: 1920, height: 1080 }
const REASON = 'this text has styled words; tracking keys would drop that styling — give it a text box first'

function setup(extra: Record<string, unknown>) {
  const engine = new TimelineEngine({ fps: 30, stage: STAGE })
  const trackId = engine.addTrack('elements').id
  const text = engine.addClip({ trackId, type: 'text', name: 'T', startFrame: 0, durationFrames: 100, text: { content: 'Hello world' } })
  engine.updateClip(text.id, trackId, extra)
  return { engine, id: text.id }
}

const keys = (clip: string, channel: string): EditorOp =>
  ({ op: 'setKeyframes', clip, channel, keys: [{ at: 0, value: 0 }, { at: 1, value: 10 }] }) as unknown as EditorOp

const SPANS = { spans: [{ start: 0, end: 5, fontWeight: 700 }] }

describe('MC-1g: tracking keys on styled text', () => {
  it('sanitize refuses text.letterSpacing on spans with no textBox, with the reason', () => {
    const f = setup(SPANS)
    const { ops, dropped } = sanitizeOps([keys(f.id, 'text.letterSpacing')], f.engine.getProject())
    expect(ops).toEqual([])
    expect(dropped).toHaveLength(1)
    expect(dropped[0]!.reason).toBe(REASON)
  })

  it('the writer returns no patch for it', () => {
    const f = setup(SPANS)
    expect(setKeyframe(f.engine.findClip(f.id)!.clip, 'text.letterSpacing', 0, { stage: STAGE }, 4)).toEqual({})
  })

  it('a text box makes it keyable again', () => {
    const f = setup({ ...SPANS, textBox: { overflow: 'wrap' } })
    const { ops, dropped } = sanitizeOps([keys(f.id, 'text.letterSpacing')], f.engine.getProject())
    expect(dropped).toEqual([])
    expect(ops).toHaveLength(1)
    expect(setKeyframe(f.engine.findClip(f.id)!.clip, 'text.letterSpacing', 0, { stage: STAGE }, 4).keyframes).toBeDefined()
  })

  it('plain text and other channels on spans text are untouched', () => {
    const plain = setup({})
    expect(sanitizeOps([keys(plain.id, 'text.letterSpacing')], plain.engine.getProject()).dropped).toEqual([])
    const f = setup(SPANS)
    expect(sanitizeOps([keys(f.id, 'text.fontSize')], f.engine.getProject()).dropped).toEqual([])
    expect(sanitizeOps([keys(f.id, 'opacity')], f.engine.getProject()).dropped).toEqual([])
  })

  it('empty spans do not count as styled', () => {
    const f = setup({ spans: [] })
    expect(sanitizeOps([keys(f.id, 'text.letterSpacing')], f.engine.getProject()).dropped).toEqual([])
  })
})
