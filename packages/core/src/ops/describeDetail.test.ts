import { describe, expect, it } from 'vitest'
import type { Clip, Keyframe, Project, Track, Transition } from '../types'
import { describeProject } from './describe'
import {
  MAX_DETAIL_BYTES,
  MAX_DETAIL_CAPTION_WORDS,
  MAX_DETAIL_CLIPS,
  MAX_DETAIL_KEYS_PER_CHANNEL,
  describeClipDetail,
  describeTransitions,
} from './describeDetail'

function track(id: string, order: number, extra: Partial<Track> = {}): Track {
  return { id, name: id.toUpperCase(), kind: 'video', order, height: 64, locked: false, disabled: false, muted: false, solo: false, ...extra }
}

function clip(id: string, trackId: string, startFrame: number, extra: Partial<Clip> = {}): Clip {
  return {
    id,
    trackId,
    type: 'video',
    name: id,
    startFrame,
    durationFrames: 30,
    sourceStartFrame: 0,
    sourceDurationFrames: 30,
    src: `${id}.mp4`,
    ...extra,
  }
}

function key(frame: number, value: number, extra: Partial<Keyframe> = {}): Keyframe {
  return { id: `k${frame}`, frame, value, easing: 'linear', ...extra }
}

function project(clips: Clip[], extra: Partial<Project> = {}): Project {
  const byTrack: Record<string, Clip[]> = {}
  for (const c of clips) (byTrack[c.trackId] ??= []).push(c)
  const ids = [...new Set(clips.map((c) => c.trackId))]
  return {
    id: 'p',
    fps: 30,
    stage: { width: 1920, height: 1080 },
    tracks: ids.map((id, i) => track(id, i)),
    clips: byTrack,
    transitions: [],
    version: 1,
    ...extra,
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const v of Object.values(value as object)) deepFreeze(v)
  }
  return value
}

const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length

function titleClip(): Clip {
  return clip('title', 'v1', 30, {
    type: 'text',
    name: 'Title Card',
    src: undefined,
    content: 'Hello world',
    fontId: 'inter',
    fontFamily: 'Inter, sans-serif',
    fontSize: 72,
    fontWeight: 700,
    color: '#ffffff',
    textShadow: { color: '#000000', blur: 12, offsetX: 2, offsetY: 4 },
    textOutline: { color: '#112233', width: 3 },
    transform: { x: 0.5, y: 0.8, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } },
    opacity: 0.9,
    keyframes: {
      channels: {
        x: { source: { kind: 'keyframes' }, keys: [key(0, 0.2), key(30, 0.8, { easing: 'quad-out' })] },
        y: { source: { kind: 'expression', source: '0.5 + sin(time * 2) * 0.1' }, keys: [] },
      },
    },
  })
}

describe('describeClipDetail', () => {
  it('returns values, keys, expressions, font and shadow for a text clip', () => {
    const p = project([titleClip()])
    const r = describeClipDetail(p, ['title'])
    expect(r.missing).toEqual([])
    const c = r.clips[0]!
    expect(c).toMatchObject({
      id: 'title',
      type: 'text',
      startSec: 1,
      durationSec: 1,
      opacity: 0.9,
      blend: 'normal',
      transform: { x: 0.5, y: 0.8, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5 },
    })
    expect(c.keys).toEqual({
      x: [
        { atSec: 0, value: 0.2, easing: 'linear' },
        { atSec: 1, value: 0.8, easing: 'quad-out' },
      ],
    })
    expect(c.expressions).toEqual({ y: '0.5 + sin(time * 2) * 0.1' })
    expect(c.text).toMatchObject({
      content: 'Hello world',
      fontId: 'inter',
      fontSize: 72,
      fontWeight: 700,
      color: '#ffffff',
      shadow: { color: '#000000', blur: 12, offsetX: 2, offsetY: 4 },
      outline: { color: '#112233', width: 3 },
    })
  })

  it('rounds numbers to 4 significant digits and seconds to 3 decimals', () => {
    const p = project([
      clip('a', 'v1', 1, {
        durationFrames: 10,
        transform: { x: 0.123456789, y: 0.5, scale: 1.23456789, rotation: 0, anchor: { x: 0.5, y: 0.5 } },
      }),
    ])
    const c = describeClipDetail(p, ['a']).clips[0]!
    expect(c.transform.x).toBe(0.1235)
    expect(c.transform.scale).toBe(1.235)
    expect(c.startSec).toBe(0.033)
    expect(c.durationSec).toBe(0.333)
  })

  it('reports the type default for a clip with no transform of its own', () => {
    const c = describeClipDetail(project([clip('a', 'v1', 0)]), ['a']).clips[0]!
    expect(c.transformIsDefault).toBe(true)
    expect(c.transform).toMatchObject({ x: 0.5, y: 0.5, scale: 1, scaleX: 1, scaleY: 1 })
  })

  it('resolves a clip by name, a compound child by path, and reports unknown refs as missing', () => {
    const child = clip('kid', 'ci1', 0, { type: 'shape', name: 'Dot', src: undefined, shapeKind: 'circle', shapeFill: '#ff0000' })
    const inner = project([child], { id: 'inner' })
    const compound = clip('box', 'v1', 0, { type: 'compound', name: 'Logo Box', src: undefined, compound: { project: inner } })
    const p = project([titleClip(), compound])

    const byName = describeClipDetail(p, ['Title Card'])
    expect(byName.clips.map((c) => c.id)).toEqual(['title'])
    expect(byName.clips[0]!.ref).toBe('Title Card')

    const byPath = describeClipDetail(p, ['box/kid', 'Logo Box/kid'])
    expect(byPath.clips.map((c) => c.id)).toEqual(['box/kid'])
    expect(byPath.clips[0]).toMatchObject({ type: 'shape', shape: { variant: 'circle', fill: '#ff0000' } })

    const r = describeClipDetail(p, ['nope', 'box/ghost', 'title/kid', '', 'title'])
    expect(r.missing).toEqual(['nope', 'box/ghost', 'title/kid', ''])
    expect(r.clips.map((c) => c.id)).toEqual(['title'])

    const box = describeClipDetail(p, ['box']).clips[0]!
    expect(box.children).toEqual([{ id: 'box/kid', name: 'Dot', type: 'shape' }])
  })

  it('prefers an id over a name, and calls a shared name ambiguous rather than picking one', () => {
    const p = project([clip('a', 'v1', 0, { name: 'b' }), clip('b', 'v1', 30, { name: 'Same' }), clip('c', 'v1', 60, { name: 'Same' })])
    expect(describeClipDetail(p, ['b']).clips.map((c) => c.id)).toEqual(['b'])
    const r = describeClipDetail(p, ['Same'])
    expect(r.clips).toEqual([])
    expect(r.ambiguous).toEqual([{ ref: 'Same', ids: ['b', 'c'] }])
    expect(r.missing).toEqual([])
  })

  it('lists crop, mask, matte, effects with params, speed, source range and link', () => {
    const p = project([
      clip('src', 'v1', 0),
      clip('a', 'v1', 0, {
        crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 },
        mask: { kind: 'ellipse', x: 0.5, y: 0.5, width: 0.4, height: 0.4, feather: 0.1, invert: true },
        matte: { sourceClipId: 'src', kind: 'luma' },
        effects: [{ id: 'fx1', kind: 'blur', enabled: false, params: { radius: 3.14159 } }],
        speed: 2,
        sourceStartFrame: 15,
        sourceDurationFrames: 60,
        linkId: 'L1',
        blend: 'screen',
        volume: 0.5,
      }),
    ])
    const c = describeClipDetail(p, ['a']).clips[0]!
    expect(c).toMatchObject({
      crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 },
      mask: { kind: 'ellipse', feather: 0.1, invert: true },
      matte: { sourceClipId: 'src', kind: 'luma' },
      effects: [{ id: 'fx1', kind: 'blur', enabled: false, params: { radius: 3.142 } }],
      speed: 2,
      sourceStartSec: 0.5,
      sourceDurationSec: 2,
      linkId: 'L1',
      blend: 'screen',
      volume: 0.5,
    })
  })

  it('summarises colour and path keys instead of dumping them', () => {
    const d = 'M0 0 L 100 0 L 100 100 Z'
    const p = project([
      clip('s', 'v1', 0, {
        type: 'shape',
        src: undefined,
        shapeKind: 'path',
        shapePath: d,
        shapeViewBox: { x: 0, y: 0, width: 24, height: 24 },
        keyframes: {
          channels: {
            'shape.fill': {
              source: { kind: 'keyframes' },
              keys: [key(0, 0, { vec: [1, 0, 0, 1] }), key(30, 0, { vec: [0, 0, 1, 0.5], hold: true })],
            },
            'shape.path': { source: { kind: 'keyframes' }, keys: [key(0, 0, { path: d }), key(30, 0, { path: `${d} L 0 100 Z` })] },
          },
        },
      }),
    ])
    const c = describeClipDetail(p, ['s']).clips[0]!
    expect(c.keys!['shape.fill']).toEqual([
      { atSec: 0, hex: '#ff0000', easing: 'linear' },
      { atSec: 1, hex: '#0000ff', alpha: 0.5, easing: 'linear', hold: true },
    ])
    expect(c.keys!['shape.path']![0]).toEqual({ atSec: 0, pathLength: d.length, viewBox: '0 0 24 24', easing: 'linear' })
    expect(JSON.stringify(c)).not.toContain('L 0 100')
    expect(c.shape).toMatchObject({ variant: 'path', pathLength: d.length, viewBox: '0 0 24 24' })
  })

  it('lists every transition touching the clip', () => {
    const t: Transition = { id: 't1', kind: 'fade', fromClipId: 'a', toClipId: 'b', trackId: 'v1', startFrame: 20, durationFrames: 20 }
    const p = project([clip('a', 'v1', 0), clip('b', 'v1', 30), clip('c', 'v1', 60)], { transitions: [t] })
    expect(describeClipDetail(p, ['a']).clips[0]!.transitions).toEqual(['t1'])
    expect(describeClipDetail(p, ['b']).clips[0]!.transitions).toEqual(['t1'])
    expect(describeClipDetail(p, ['c']).clips[0]!.transitions).toEqual([])
  })

  it('thins a 100-key channel to at most 60, keeping the first and the last', () => {
    const keys = Array.from({ length: 100 }, (_, i) => key(i * 3, i / 100))
    const p = project([clip('a', 'v1', 0, { durationFrames: 300, keyframes: { channels: { opacity: { source: { kind: 'keyframes' }, keys } } } })])
    const c = describeClipDetail(p, ['a']).clips[0]!
    const listed = c.keys!.opacity!
    expect(listed.length).toBeLessThanOrEqual(MAX_DETAIL_KEYS_PER_CHANNEL)
    expect(listed.length).toBe(60)
    expect(listed[0]).toMatchObject({ atSec: 0, value: 0 })
    expect(listed[listed.length - 1]).toMatchObject({ atSec: 9.9, value: 0.99 })
    // The middle is spread across the whole span, not just the first 60 keys.
    expect(listed[30]!.atSec).toBeGreaterThan(3)
    expect(c.keysThinned).toBe(true)
    expect(c.keyTotals).toEqual({ opacity: 100 })
    // A channel at the cap is not thinned.
    const fit = project([clip('a', 'v1', 0, { keyframes: { channels: { opacity: { source: { kind: 'keyframes' }, keys: keys.slice(0, 60) } } } })])
    expect(describeClipDetail(fit, ['a']).clips[0]!.keysThinned).toBeUndefined()
  })

  it('returns at most 200 caption words and marks the cut', () => {
    const words = Array.from({ length: 300 }, (_, i) => ({ text: `w${i}`, start: i * 3, end: i * 3 + 2 }))
    const p = project([clip('cap', 'v1', 0, { type: 'text', src: undefined, content: 'x', captionMode: 'karaoke', captionHighlight: '#ffff00', words })])
    const cap = describeClipDetail(p, ['cap']).clips[0]!.captions!
    expect(cap.words!.length).toBe(MAX_DETAIL_CAPTION_WORDS)
    expect(cap.wordCount).toBe(300)
    expect(cap.wordsTruncated).toBe(true)
    expect(cap).toMatchObject({ mode: 'karaoke', highlight: '#ffff00' })
    expect(cap.words![1]).toEqual({ text: 'w1', atSec: 0.1, endSec: 0.167 })
  })

  it('caps the clips per call and reports the rest as truncated', () => {
    const clips = Array.from({ length: 15 }, (_, i) => clip(`c${i}`, 'v1', i * 30))
    const refs = clips.map((c) => c.id)
    const r = describeClipDetail(project(clips), refs)
    expect(r.clips.length).toBe(MAX_DETAIL_CLIPS)
    expect(r.truncated).toEqual(['c12', 'c13', 'c14'])
  })

  it('trims caption words, then keys, to keep the JSON within 40 KB', () => {
    const words = Array.from({ length: 300 }, (_, i) => ({ text: `word${i}`, start: i * 3, end: i * 3 + 2 }))
    const caps = Array.from({ length: 8 }, (_, i) =>
      clip(`cap${i}`, 'v1', i * 30, { type: 'text', src: undefined, content: 'x', captionMode: 'reveal', words }),
    )
    const p = project(caps)
    // Eight of these would be well over the cap, so the cut below is real.
    expect(bytes(describeClipDetail(p, ['cap0'])) * 8).toBeGreaterThan(MAX_DETAIL_BYTES)

    const r = describeClipDetail(p, caps.map((c) => c.id))
    expect(r.trimmed.length).toBeGreaterThan(0)
    expect(r.trimmed.every((t) => t.endsWith('.words'))).toBe(true)
    expect(bytes(r)).toBeLessThanOrEqual(MAX_DETAIL_BYTES)
    // The true counts survive the cut.
    expect(r.clips.every((c) => c.captions!.wordCount === 300)).toBe(true)

    const keyed = Array.from({ length: 12 }, (_, i) =>
      clip(`k${i}`, 'v1', i * 30, {
        durationFrames: 300,
        keyframes: {
          channels: Object.fromEntries(
            ['x', 'y', 'scale', 'rotation'].map((ch) => [ch, { source: { kind: 'keyframes' as const }, keys: Array.from({ length: 80 }, (_, n) => key(n * 3, n / 80)) }]),
          ),
        },
      }),
    )
    const k = describeClipDetail(project(keyed), keyed.map((c) => c.id))
    expect(k.trimmed.length).toBeGreaterThan(0)
    expect(k.trimmed.every((t) => t.endsWith('.keys'))).toBe(true)
    expect(bytes(k)).toBeLessThanOrEqual(MAX_DETAIL_BYTES)
    const cut = k.clips.find((c) => !c.keys)!
    expect(cut.keyTotals).toEqual({ x: 80, y: 80, scale: 80, rotation: 80 })
  })

  it('does not throw on hostile input and does not mutate the project', () => {
    const p = deepFreeze(project([titleClip(), clip('a', 'v1', 0, { transform: { x: NaN, y: 0, scale: Infinity, rotation: 0, anchor: { x: 0.5, y: 0.5 } } })]))
    expect(() => describeClipDetail(p, ['title', 'a', 'x/y/z', 7 as unknown as string])).not.toThrow()
    expect(() => describeClipDetail(p, undefined as unknown as string[])).not.toThrow()
    expect(describeClipDetail(p, ['a']).clips[0]!.transform.x).toBe(0)
  })
})

describe('describeTransitions', () => {
  it('lists a transition between two clips, soonest first, with names and seconds', () => {
    const p = project(
      [clip('a', 'v1', 0, { name: 'Intro' }), clip('b', 'v1', 30, { name: 'Main' }), clip('c', 'v1', 90, { name: 'Outro' })],
      {
        transitions: [
          { id: 't2', kind: 'slide', fromClipId: 'b', toClipId: 'c', trackId: 'v1', startFrame: 80, durationFrames: 15, direction: 'left', easing: 'ease-out' },
          { id: 't1', kind: 'fade', fromClipId: 'a', toClipId: 'b', trackId: 'v1', startFrame: 20, durationFrames: 20 },
        ],
      },
    )
    const r = describeTransitions(p)
    expect(r.dropped).toBe(0)
    expect(r.transitions).toEqual([
      {
        id: 't1',
        kind: 'fade',
        track: { id: 'v1', name: 'V1' },
        from: { id: 'a', name: 'Intro' },
        to: { id: 'b', name: 'Main' },
        atSec: 0.667,
        durationSec: 0.667,
      },
      {
        id: 't2',
        kind: 'slide',
        direction: 'left',
        easing: 'ease-out',
        track: { id: 'v1', name: 'V1' },
        from: { id: 'b', name: 'Main' },
        to: { id: 'c', name: 'Outro' },
        atSec: 2.667,
        durationSec: 0.5,
      },
    ])
    // Both clips see it.
    expect(describeClipDetail(p, ['a']).clips[0]!.transitions).toEqual(['t1'])
    expect(describeClipDetail(p, ['b']).clips[0]!.transitions).toEqual(['t1', 't2'])
  })

  it('uses the project fps and counts a transition with a deleted clip as dropped', () => {
    const p = project([clip('a', 'v1', 0), clip('b', 'v1', 24)], {
      fps: 24,
      transitions: [
        { id: 'ok', kind: 'fade', fromClipId: 'a', toClipId: 'b', trackId: 'v1', startFrame: 12, durationFrames: 24 },
        { id: 'gone', kind: 'fade', fromClipId: 'a', toClipId: 'deleted', trackId: 'v1', startFrame: 12, durationFrames: 24 },
        { id: 'gone2', kind: 'wipe', fromClipId: 'deleted', toClipId: 'b', trackId: 'v1', startFrame: 12, durationFrames: 24 },
      ],
    })
    const r = describeTransitions(p)
    expect(r.transitions.map((t) => t.id)).toEqual(['ok'])
    expect(r.dropped).toBe(2)
    expect(r.transitions[0]).toMatchObject({ atSec: 0.5, durationSec: 1 })
    expect(describeClipDetail(p, ['a']).clips[0]!.transitions).toEqual(['ok'])
  })
})

describe('describeProject is untouched', () => {
  it('describes a fixed project byte for byte, before and after the detail describers run', () => {
    const t: Transition = { id: 't1', kind: 'fade', fromClipId: 'a', toClipId: 'b', trackId: 'v1', startFrame: 20, durationFrames: 20 }
    const make = () =>
      project(
        [
          clip('a', 'v1', 0, {
            blend: 'screen',
            keyframes: { channels: { opacity: { source: { kind: 'keyframes' }, keys: [key(0, 1)] } } },
          }),
          clip('b', 'v1', 30, { speed: 2 }),
          titleClip(),
        ],
        { transitions: [t] },
      )
    const expected =
      '{"fps":30,"stage":{"width":1920,"height":1080},"durationFrames":60,"durationSec":2,"tracks":[{"id":"v1","kind":"video","name":"V1","clips":[{"id":"a","type":"video","name":"a","startFrame":0,"durationFrames":30,"endFrame":29,"startSec":0,"durationSec":1,"keyed":["opacity"],"blend":"screen"},{"id":"b","type":"video","name":"b","startFrame":30,"durationFrames":30,"endFrame":59,"startSec":1,"durationSec":1,"speed":2},{"id":"title","type":"text","name":"Title Card","startFrame":30,"durationFrames":30,"endFrame":59,"startSec":1,"durationSec":1,"content":"Hello world","keyed":["x"],"expressions":["y"]}]}]}'
    const p = deepFreeze(make())
    expect(JSON.stringify(describeProject(p))).toBe(expected)
    describeClipDetail(p, ['a', 'b', 'title'])
    describeTransitions(p)
    expect(JSON.stringify(describeProject(p))).toBe(expected)
    expect(JSON.stringify(p)).toBe(JSON.stringify(make()))
  })
})
