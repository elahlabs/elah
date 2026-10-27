/**
 * MC-2d: `text.fontSize`, `text.letterSpacing`, `stroke.width`, `anchor.x` and
 * `anchor.y` as keyable channels. One file for the whole chain, because a
 * channel that the writer stores and the resolver forgets to read is a channel
 * that never paints: writer -> sanitize -> resolver -> painter signature ->
 * describe -> save/load.
 */
import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import { readProjectDocument } from '../editor/projectDocument'
import { resolveTimeline } from './resolveTimeline'
import { isExpressionChannel, isKeyframeChannelName } from './keyframes'
import { sanitizeOps } from '../ops/sanitize'
import { applyOps } from '../ops/apply'
import { describeClipDetail } from '../ops/describeDetail'
import { textPaintSignature } from '../renderer/gpu/layers/textPaint'
import { shapePaintSignature } from '../renderer/gpu/layers/shapePaint'
import { setKeyframe } from '../elements/keyframes'
import type { EditorOp } from '../ops/types'
import type { Clip, Keyframe, Project } from '../types'

const STAGE = { width: 1920, height: 1080 }
const CHANNELS = ['text.fontSize', 'text.letterSpacing', 'stroke.width', 'anchor.x', 'anchor.y'] as const

function key(frame: number, value: number): Keyframe {
  return { id: `k${frame}`, frame, value, easing: 'linear' }
}
const track = (...ks: Keyframe[]) => ({ source: { kind: 'keyframes' as const }, keys: ks })

function fixture(textExtra: Partial<Clip> = {}, shapeExtra: Partial<Clip> = {}) {
  const engine = new TimelineEngine({ fps: 30, stage: STAGE })
  const trackId = engine.addTrack('elements').id
  const text = engine.addClip({ trackId, type: 'text', name: 'T', startFrame: 0, durationFrames: 100, text: { content: 'Hello' } })
  const shapeTrack = engine.addTrack('elements').id
  const shape = engine.addClip({ trackId: shapeTrack, type: 'shape', name: 'S', startFrame: 0, durationFrames: 100, shape: { shapeKind: 'rect' } })
  const audioTrack = engine.addTrack('audio').id
  const audio = engine.addClip({ trackId: audioTrack, type: 'audio', name: 'A', src: 'a.mp3', startFrame: 0, durationFrames: 100 })
  if (Object.keys(textExtra).length) engine.updateClip(text.id, trackId, textExtra)
  if (Object.keys(shapeExtra).length) engine.updateClip(shape.id, shapeTrack, shapeExtra)
  return { engine, trackId, shapeTrack, text: text.id, shape: shape.id, audio: audio.id }
}

const textOf = (p: Project, frame: number) => resolveTimeline(frame, p).texts[0]!
const shapeOf = (p: Project, frame: number) => resolveTimeline(frame, p).shapes[0]!

describe('MC-2d: channel names', () => {
  it('are key channels and not expression channels', () => {
    for (const c of CHANNELS) {
      expect(isKeyframeChannelName(c), c).toBe(true)
      expect(isExpressionChannel(c), c).toBe(false)
    }
  })
})

describe('MC-2d: resolver', () => {
  it('text.fontSize interpolates and replaces the authored size; min 1', () => {
    const f = fixture({ fontSize: 40, keyframes: { channels: { 'text.fontSize': track(key(0, 20), key(50, 120)) } } })
    const p = f.engine.getProject()
    expect(textOf(p, 0).fontSize).toBe(20)
    expect(textOf(p, 25).fontSize).toBeCloseTo(70, 6)
    expect(textOf(p, 50).fontSize).toBe(120)
    f.engine.updateClip(f.text, f.trackId, { keyframes: { channels: { 'text.fontSize': track(key(0, -30), key(50, 0)) } } })
    expect(textOf(f.engine.getProject(), 10).fontSize).toBe(1)
  })

  it('text.letterSpacing lands on textBox.letterSpacing, keeping the stored box', () => {
    const f = fixture({
      textBox: { overflow: 'clip', maxLines: 2, width: 400, letterSpacing: 3 },
      keyframes: { channels: { 'text.letterSpacing': track(key(0, -2), key(50, 12)) } },
    })
    const p = f.engine.getProject()
    expect(textOf(p, 0).textBox).toEqual({ overflow: 'clip', maxLines: 2, width: 400, letterSpacing: -2 })
    expect(textOf(p, 25).textBox!.letterSpacing).toBeCloseTo(5, 6)
    expect(textOf(p, 50).textBox!.letterSpacing).toBe(12)
  })

  it('text.letterSpacing on a boxless clip uses a plain wrapping box', () => {
    const f = fixture({ keyframes: { channels: { 'text.letterSpacing': track(key(0, 0), key(50, 10)) } } })
    expect(textOf(f.engine.getProject(), 50).textBox).toEqual({ overflow: 'wrap', letterSpacing: 10 })
  })

  it('stroke.width interpolates on a shape; min 0', () => {
    const f = fixture({}, { shapeStrokeWidth: 4, keyframes: { channels: { 'stroke.width': track(key(0, 0), key(50, 20)) } } })
    const p = f.engine.getProject()
    expect(shapeOf(p, 0).shapeStrokeWidth).toBe(0)
    expect(shapeOf(p, 25).shapeStrokeWidth).toBeCloseTo(10, 6)
    f.engine.updateClip(f.shape, f.shapeTrack, { keyframes: { channels: { 'stroke.width': track(key(0, -5), key(50, -5)) } } })
    expect(shapeOf(f.engine.getProject(), 10).shapeStrokeWidth).toBe(0)
  })

  it('anchor.x / anchor.y replace that half of transform.anchor, unclamped', () => {
    const f = fixture(
      { transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } }, keyframes: { channels: { 'anchor.x': track(key(0, 0), key(50, 1.5)) } } },
      { keyframes: { channels: { 'anchor.y': track(key(0, 0.25), key(50, -0.5)) } } },
    )
    const p = f.engine.getProject()
    expect(textOf(p, 0).transform!.anchor).toEqual({ x: 0, y: 0.5 })
    expect(textOf(p, 25).transform!.anchor.x).toBeCloseTo(0.75, 6)
    expect(textOf(p, 50).transform!.anchor.x).toBe(1.5)
    // A shape with no stored transform: the type default carries the other half.
    expect(shapeOf(p, 0).transform!.anchor).toEqual({ x: 0.5, y: 0.25 })
    expect(shapeOf(p, 50).transform!.anchor.y).toBe(-0.5)
  })

  it('a channel the clip type cannot take is ignored', () => {
    const f = fixture(
      { keyframes: { channels: { 'stroke.width': track(key(0, 40), key(50, 40)) } } },
      { keyframes: { channels: { 'text.fontSize': track(key(0, 90), key(50, 90)), 'text.letterSpacing': track(key(0, 9), key(50, 9)) } } },
    )
    const p = f.engine.getProject()
    expect('fontSize' in textOf(p, 10)).toBe(false)
    expect('textBox' in textOf(p, 10)).toBe(false)
    expect(shapeOf(p, 10).shapeStrokeWidth).toBe(2)
  })

  it('a clip without keys on the new channels resolves as it always did', () => {
    const f = fixture({ fontSize: 40, keyframes: { channels: { x: track(key(0, 0.2), key(50, 0.8)) } } })
    const p = f.engine.getProject()
    const t = textOf(p, 20)
    expect(t.fontSize).toBe(40)
    expect('textBox' in t).toBe(false)
    expect(t.transform!.anchor).toEqual({ x: 0.5, y: 0.5 })
    const s = shapeOf(p, 20)
    expect(s.shapeStrokeWidth).toBe(2)
    expect(s.transform).toBeUndefined()
  })
})

describe('MC-2d: painter signatures follow the keyed value', () => {
  it('a keyed font size changes the text signature between frames', () => {
    const f = fixture({ keyframes: { channels: { 'text.fontSize': track(key(0, 20), key(50, 120)) } } })
    const p = f.engine.getProject()
    expect(textPaintSignature(textOf(p, 10), STAGE)).not.toBe(textPaintSignature(textOf(p, 30), STAGE))
    expect(textPaintSignature(textOf(p, 30), STAGE)).toBe(textPaintSignature(textOf(p, 30), STAGE))
  })

  it('a keyed letter spacing changes the text signature between frames', () => {
    const f = fixture({ keyframes: { channels: { 'text.letterSpacing': track(key(0, -2), key(50, 12)) } } })
    const p = f.engine.getProject()
    expect(textPaintSignature(textOf(p, 10), STAGE)).not.toBe(textPaintSignature(textOf(p, 30), STAGE))
  })

  it('a keyed stroke width changes the shape signature between frames', () => {
    const f = fixture({}, { keyframes: { channels: { 'stroke.width': track(key(0, 0), key(50, 20)) } } })
    const p = f.engine.getProject()
    expect(shapePaintSignature(shapeOf(p, 10), STAGE)).not.toBe(shapePaintSignature(shapeOf(p, 30), STAGE))
  })
})

describe('MC-2d: setKeyframes (sanitize + writer)', () => {
  const keysOp = (clip: string, channel: string, ks: Array<Record<string, unknown>>): EditorOp =>
    ({ op: 'setKeyframes', clip, channel, keys: ks }) as unknown as EditorOp

  function write(f: ReturnType<typeof fixture>, clip: string, channel: string) {
    const raw = keysOp(clip, channel, [{ at: 0, value: 0.2 }, { at: 1, value: 0.8, curve: 'ease-out' }])
    const { ops, dropped } = sanitizeOps([raw], f.engine.getProject())
    expect(dropped, channel).toEqual([])
    const res = applyOps(f.engine, ops, { description: 'mc2d' })
    expect(res.skipped, channel).toEqual([])
    return f.engine.findClip(clip)!.clip
  }

  it('accepts each channel on the clip type that reads it', () => {
    const f = fixture()
    expect(write(f, f.text, 'text.fontSize').keyframes!.channels['text.fontSize']!.keys).toHaveLength(2)
    expect(write(f, f.text, 'text.letterSpacing').keyframes!.channels['text.letterSpacing']!.keys).toHaveLength(2)
    expect(write(f, f.shape, 'stroke.width').keyframes!.channels['stroke.width']!.keys).toHaveLength(2)
    expect(write(f, f.text, 'anchor.x').keyframes!.channels['anchor.x']!.keys).toHaveLength(2)
    expect(write(f, f.shape, 'anchor.y').keyframes!.channels['anchor.y']!.keys).toHaveLength(2)
  })

  const reason = (clip: string, channel: string, f = fixture()): string => {
    const { ops, dropped } = sanitizeOps([keysOp(clip, channel, [{ at: 0, value: 1 }])], f.engine.getProject())
    expect(ops, channel).toEqual([])
    expect(dropped, channel).toHaveLength(1)
    return JSON.stringify(dropped[0])
  }

  it('refuses the other clip types with a reason', () => {
    const f = fixture()
    expect(reason(f.shape, 'text.fontSize', f)).toMatch(/not text/)
    expect(reason(f.shape, 'text.letterSpacing', f)).toMatch(/not text/)
    expect(reason(f.text, 'stroke.width', f)).toMatch(/needs a shape clip/)
    expect(reason(f.audio, 'anchor.x', f)).toMatch(/has none/)
  })

  it('refuses an expression on them', () => {
    const f = fixture()
    const raw = { op: 'setExpression', clip: f.text, channel: 'text.fontSize', source: 'value + 1' } as unknown as EditorOp
    const { ops, dropped } = sanitizeOps([raw], f.engine.getProject())
    expect(ops).toEqual([])
    expect(dropped[0]!.reason).toBe('unknown expression channel "text.fontSize"')
  })

  it('the writer refuses a clip that cannot take the key', () => {
    const f = fixture()
    const ctx = { stage: STAGE }
    const shape = f.engine.findClip(f.shape)!.clip
    expect(setKeyframe(shape, 'text.fontSize', 0, ctx, 10)).toEqual({})
    expect(setKeyframe(f.engine.findClip(f.text)!.clip, 'stroke.width', 0, ctx, 10)).toEqual({})
    expect(setKeyframe(f.engine.findClip(f.audio)!.clip, 'anchor.x', 0, ctx, 0.2)).toEqual({})
  })

  it('a key without a value reads the authored field', () => {
    const f = fixture({ fontSize: 77, textBox: { overflow: 'wrap', letterSpacing: 4 } }, { shapeStrokeWidth: 9 })
    const ctx = { stage: STAGE }
    const at = (clip: string, ch: Parameters<typeof setKeyframe>[1]) => {
      const patch = setKeyframe(f.engine.findClip(clip)!.clip, ch, 0, ctx)
      return patch.keyframes!.channels[ch]!.keys[0]!.value
    }
    expect(at(f.text, 'text.fontSize')).toBe(77)
    expect(at(f.text, 'text.letterSpacing')).toBe(4)
    expect(at(f.shape, 'stroke.width')).toBe(9)
    expect(at(f.text, 'anchor.x')).toBe(0.5)
  })

  it('an anchor key on a clip with no transform bakes the transform, like a transform key', () => {
    const f = fixture()
    const patch = setKeyframe(f.engine.findClip(f.shape)!.clip, 'anchor.x', 0, { stage: STAGE }, 0.1)
    expect(patch.transform).toBeDefined()
    // A text key writes no transform.
    expect(setKeyframe(f.engine.findClip(f.text)!.clip, 'text.fontSize', 0, { stage: STAGE }, 10).transform).toBeUndefined()
  })
})

describe('MC-2d: describeDetail', () => {
  it('lists keys on the new channels like any other extended channel', () => {
    const f = fixture({ keyframes: { channels: { 'text.fontSize': track(key(0, 20), key(30, 90)), 'anchor.x': track(key(0, 0), key(30, 1)) } } })
    const detail = describeClipDetail(f.engine.getProject(), [f.text])
    const c = detail.clips[0]!
    expect(Object.keys(c.keys ?? {}).sort()).toEqual(['anchor.x', 'text.fontSize'])
    expect(c.keys!['text.fontSize']!.map((k) => k.value)).toEqual([20, 90])
  })
})

describe('MC-2d: persistence', () => {
  it('keys on all five channels survive save -> load -> import and still resolve', () => {
    const f = fixture(
      {
        keyframes: {
          channels: {
            'text.fontSize': track(key(0, 20), key(50, 120)),
            'text.letterSpacing': track(key(0, -2), key(50, 12)),
            'anchor.x': track(key(0, 0), key(50, 1)),
            'anchor.y': track(key(0, 0.25), key(50, 0.75)),
          },
        },
      },
      { keyframes: { channels: { 'stroke.width': track(key(0, 0), key(50, 20)), 'anchor.x': track(key(0, 1), key(50, 0)) } } },
    )
    const before = f.engine.getProject()
    const read = readProjectDocument(JSON.parse(JSON.stringify(before)))
    const engine = new TimelineEngine({ fps: 30, stage: STAGE })
    engine.loadProject(read)
    const again = readProjectDocument(JSON.parse(JSON.stringify(engine.getProject())))
    for (const p of [read, again]) {
      const text = p.clips[f.trackId]!.find((c) => c.id === f.text)!
      const shape = p.clips[f.shapeTrack]!.find((c) => c.id === f.shape)!
      expect(Object.keys(text.keyframes!.channels).sort()).toEqual(['anchor.x', 'anchor.y', 'text.fontSize', 'text.letterSpacing'])
      expect(Object.keys(shape.keyframes!.channels).sort()).toEqual(['anchor.x', 'stroke.width'])
      const t = textOf(p, 25)
      expect(t.fontSize).toBeCloseTo(70, 6)
      expect(t.textBox!.letterSpacing).toBeCloseTo(5, 6)
      expect(t.transform!.anchor).toEqual({ x: 0.5, y: 0.5 })
      expect(shapeOf(p, 25).shapeStrokeWidth).toBeCloseTo(10, 6)
      expect(shapeOf(p, 25).transform!.anchor.x).toBeCloseTo(0.5, 6)
    }
    expect(textOf(read, 50)).toEqual(textOf(before, 50))
  })
})

describe('MOT-5: text.scramble', () => {
  it('is a key channel, not an expression channel', () => {
    expect(isKeyframeChannelName('text.scramble')).toBe(true)
    expect(isExpressionChannel('text.scramble')).toBe(false)
  })

  it('a clip with textScramble and no keys resolves to progress 1 (the real text)', () => {
    const f = fixture({ textScramble: { charset: 'upper', seed: 4 } })
    expect(textOf(f.engine.getProject(), 10).scramble).toMatchObject({ progress: 1, seed: 4, changeEvery: 2, preserve: 'spaces' })
    expect(textOf(f.engine.getProject(), 10).scramble!.charset).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ')
  })

  it('keys interpolate, clamp to 0..1, and the clip gains a localFrame', () => {
    const f = fixture({ textScramble: { charset: 'XYZ' }, keyframes: { channels: { 'text.scramble': track(key(0, -1), key(50, 2)) } } })
    const p = f.engine.getProject()
    expect(textOf(p, 0).scramble!.progress).toBe(0)
    expect(textOf(p, 25).scramble!.progress).toBeGreaterThan(0)
    expect(textOf(p, 25).scramble!.progress).toBeLessThan(1)
    expect(textOf(p, 50).scramble!.progress).toBe(1)
    expect(textOf(p, 25).localFrame).toBe(25)
    expect(textOf(p, 25).scramble!.charset).toBe('XYZ')
  })

  it('a clip without textScramble resolves exactly as before, key or no key', () => {
    const f = fixture({ keyframes: { channels: { 'text.scramble': track(key(0, 0), key(50, 1)) } } })
    const t = textOf(f.engine.getProject(), 10)
    expect('scramble' in t).toBe(false)
    expect('localFrame' in t).toBe(false)
  })

  it('survives a save and load', () => {
    const f = fixture({ textScramble: { charset: 'lower', seed: 7, changeEvery: 3 }, keyframes: { channels: { 'text.scramble': track(key(0, 0), key(50, 1)) } } })
    const read = readProjectDocument(JSON.parse(JSON.stringify(f.engine.getProject())))
    expect(textOf(read, 25).scramble).toMatchObject({ seed: 7, changeEvery: 3 })
  })
});
