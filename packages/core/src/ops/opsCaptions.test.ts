import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import { applyOps } from './apply'
import { opDescriber } from './describeOp'
import { sanitizeOps } from './sanitize'
import { EDITOR_OP_NAMES, type EditorOp } from './types'

/** `addCaptions` (AGN-P19): declared and sanitised here, placed by `applyOps` ONLY once the client has filled its words. */

const WORDS = [
  { text: 'We', startSeconds: 0.2, endSeconds: 0.5 },
  { text: 'started', startSeconds: 0.5, endSeconds: 1 },
  { text: 'small', startSeconds: 1.2, endSeconds: 1.8 },
]

function setup() {
  const engine = new TimelineEngine({ fps: 30, initialTracks: [] })
  const v = engine.addTrack('video').id
  const talk = engine.addClip({ trackId: v, type: 'video', name: 'Interview', src: 'i.mp4', startFrame: 30, durationFrames: 150 } as never)
  const logo = engine.addClip({ trackId: engine.addTrack('video').id, type: 'image', name: 'Logo', src: 'l.png', startFrame: 0, durationFrames: 60 })
  return { engine, talk, logo }
}
const sanitize = (engine: TimelineEngine, raw: unknown[]) => sanitizeOps(raw, engine.getProject())

describe('addCaptions sanitising', () => {
  it('is a registered op name', () => {
    expect(EDITOR_OP_NAMES).toContain('addCaptions')
  })

  it('keeps a good op, accepts `mode` as the style and `centre` as center, and drops nulls', () => {
    const { engine, talk } = setup()
    const r = sanitize(engine, [{ op: 'addCaptions', clip: talk.id, mode: 'karaoke', position: 'centre', from: 1, to: '3', style: null }])
    expect(r.dropped).toEqual([])
    expect(r.ops).toEqual([{ op: 'addCaptions', clip: talk.id, style: 'karaoke', position: 'center', from: 1, to: 3 }])
  })

  it('never lets the planner supply words or timings', () => {
    const { engine, talk } = setup()
    const r = sanitize(engine, [{ op: 'addCaptions', clip: talk.id, words: WORDS, text: 'I made these up' }])
    expect(r.ops).toEqual([{ op: 'addCaptions', clip: talk.id }])
    expect('words' in r.ops[0]!).toBe(false)
  })

  it('drops an unknown clip, a clip made in this plan, and a clip with no speech', () => {
    const { engine, logo } = setup()
    expect(sanitize(engine, [{ op: 'addCaptions', clip: 'nope' }]).dropped[0]!.reason).toMatch(/no clip|nothing/i)
    expect(sanitize(engine, [{ op: 'addText', ref: 't', text: 'x', at: 0, duration: 1 }, { op: 'addCaptions', clip: '$t' }]).dropped[0]!.reason).toMatch(/already on the timeline/)
    expect(sanitize(engine, [{ op: 'addCaptions', clip: logo.id }]).dropped[0]!.reason).toMatch(/image.*no speech/)
  })

  it('drops a backwards or empty range, and a range that starts after the clip ends', () => {
    const { engine, talk } = setup()
    expect(sanitize(engine, [{ op: 'addCaptions', clip: talk.id, from: 3, to: 3 }]).dropped[0]!.reason).toMatch(/ends before it starts/)
    expect(sanitize(engine, [{ op: 'addCaptions', clip: talk.id, from: 4, to: 2 }]).dropped[0]!.reason).toMatch(/ends before it starts/)
    // 150 frames at 30 fps is a 5s clip.
    expect(sanitize(engine, [{ op: 'addCaptions', clip: talk.id, from: 6 }]).dropped[0]!.reason).toMatch(/after the clip ends \(5s long\)/)
    expect(sanitize(engine, [{ op: 'addCaptions', clip: talk.id, from: 4.9 }]).dropped).toEqual([])
  })

  it('drops an unknown style or position', () => {
    const { engine, talk } = setup()
    expect(sanitize(engine, [{ op: 'addCaptions', clip: talk.id, mode: 'wobble' }]).dropped[0]!.reason).toMatch(/caption style/)
    expect(sanitize(engine, [{ op: 'addCaptions', clip: talk.id, position: 'left' }]).dropped[0]!.reason).toMatch(/caption position/)
  })
})

describe('addCaptions description', () => {
  it('names the footage, the range, the word count and a non-default look', () => {
    const { engine, talk } = setup()
    const say = opDescriber(engine.getProject())
    expect(say({ op: 'addCaptions', clip: talk.id })).toBe('Caption “Interview” from its transcript')
    const text = say({ op: 'addCaptions', clip: talk.id, from: 1, to: 3, style: 'karaoke', position: 'top', words: WORDS })
    expect(text).toContain('Interview')
    expect(text).toMatch(/1:00?|1s|0:01/)
    expect(text).toContain('3 words')
    expect(text).toContain('karaoke')
    expect(text).toContain('top')
  })
})

describe('addCaptions applying', () => {
  const resolved = (clip: string, extra: object = {}): EditorOp => ({ op: 'addCaptions', clip, words: WORDS, ...extra }) as EditorOp

  it('skips an op the client never resolved: no words, nothing placed, a reason', () => {
    const { engine, talk } = setup()
    const before = Object.values(engine.getProject().clips).flat().length
    const r = applyOps(engine, [{ op: 'addCaptions', clip: talk.id }])
    expect(r.applied).toEqual([])
    expect(r.skipped).toEqual([{ index: 0, reason: expect.stringMatching(/never resolved from a transcript/) }])
    expect(Object.values(engine.getProject().clips).flat()).toHaveLength(before)
  })

  it('places word-timed captions at the bottom, linked to the footage, in one undo step', () => {
    const { engine, talk } = setup()
    const before = Object.values(engine.getProject().clips).flat().length
    const r = applyOps(engine, [resolved(talk.id)], { description: 'Captions' })
    expect(r.skipped).toEqual([])
    const caps = r.touched.added.map((id) => engine.findClip(id)!.clip)
    expect(caps.length).toBeGreaterThanOrEqual(1)
    for (const c of caps) {
      expect(c.type).toBe('text')
      expect(c.words?.length).toBeGreaterThan(0)
      expect(c.transform?.y).toBeCloseTo(0.86)
      expect(c.linkId).toBeDefined()
      expect(c.linkId).toBe(engine.findClip(talk.id)!.clip.linkId)
    }
    // Anchored on the footage clip's own start (frame 30), word 0 at 0.2s = frame 6 later.
    expect(Math.min(...caps.map((c) => c.startFrame))).toBe(30 + 6)
    expect(caps.flatMap((c) => c.words!.map((w) => w.text))).toEqual(['We', 'started', 'small'])
    expect(engine.lastHistoryDescription()).toBe('Captions')
    engine.undo()
    expect(Object.values(engine.getProject().clips).flat()).toHaveLength(before)
  })

  it('carries the style into the clips in the same batch, and a centre or top position', () => {
    const { engine, talk } = setup()
    const r = applyOps(engine, [resolved(talk.id, { style: 'karaoke', position: 'center' })])
    for (const id of r.touched.added) {
      const c = engine.findClip(id)!.clip
      expect(c.captionMode).toBe('karaoke')
      expect(c.transform?.y).toBeCloseTo(0.5)
    }
    const top = setup()
    const t = applyOps(top.engine, [resolved(top.talk.id, { position: 'top' })])
    for (const id of t.touched.added) expect(top.engine.findClip(id)!.clip.transform?.y).toBeLessThan(0.3)
  })

  it('joins the footage link group, so move, trim, split and delete carry the captions (AGN-P8)', () => {
    const { engine, talk } = setup()
    const r = applyOps(engine, [resolved(talk.id)])
    const group = engine.getLinked(talk.id).map((c) => c.id)
    expect(group).toContain(talk.id)
    for (const id of r.touched.added) expect(group).toContain(id)
  })

  it('refuses footage that is not video or audio', () => {
    const { engine, logo } = setup()
    const r = applyOps(engine, [resolved(logo.id)])
    expect(r.applied).toEqual([])
    expect(r.skipped[0]!.reason).toMatch(/no speech to caption/)
  })
})
