import { describe, it, expect } from 'vitest'
import { stampMediaRefs } from './mediaRefs'
import type { Clip, ClipMediaRef, Project } from '../types'

const ref = (n: number, extra: Partial<ClipMediaRef> = {}): ClipMediaRef => ({
  v: 1,
  id: 'local:' + String(n).repeat(64),
  name: `f${n}.mp4`,
  byteSize: 100 + n,
  lastModified: 1000 + n,
  kind: 'video',
  ...extra,
})

const clip = (id: string, extra: Partial<Clip> = {}): Clip =>
  ({
    id,
    trackId: 'v1',
    type: 'video',
    name: id,
    startFrame: 0,
    durationFrames: 30,
    sourceStartFrame: 0,
    sourceDurationFrames: 30,
    ...extra,
  }) as Clip

const project = (clips: Clip[], extraTracks: Record<string, Clip[]> = {}): Project =>
  ({
    id: 'p',
    fps: 30,
    stage: { width: 1920, height: 1080 },
    tracks: [{ id: 'v1', name: 'V', kind: 'video', order: 0 }],
    clips: { v1: clips, ...extraTracks },
    transitions: [],
    version: 1,
  }) as unknown as Project

describe('stampMediaRefs (LM-P1)', () => {
  it('stamps by assetId', () => {
    const p = project([clip('a', { assetId: 'asset-1', src: 'blob:x' })])
    const out = stampMediaRefs(p, [{ id: 'asset-1', src: 'blob:other', media: ref(1) }])
    expect(out.clips.v1[0].media).toEqual(ref(1))
    expect(p.clips.v1[0].media).toBeUndefined()
  })

  it('falls back to src when the assetId is unknown', () => {
    const p = project([clip('a', { assetId: 'stale', src: 'blob:x' })])
    const out = stampMediaRefs(p, [{ id: 'asset-9', src: 'blob:x', media: ref(2) }])
    expect(out.clips.v1[0].media).toEqual(ref(2))
  })

  it('keeps an existing reference when the asset is gone', () => {
    const p = project([clip('a', { src: 'blob:x', media: ref(3) })])
    expect(stampMediaRefs(p, [])).toBe(p)
    const out = stampMediaRefs(p, [{ id: 'z', src: 'blob:unrelated', media: ref(4) }])
    expect(out).toBe(p)
    expect(out.clips.v1[0].media).toEqual(ref(3))
  })

  it('ignores an asset that has no reference', () => {
    const p = project([clip('a', { src: 'blob:x' })])
    expect(stampMediaRefs(p, [{ id: 'a1', src: 'blob:x' }])).toBe(p)
  })

  it('stamps a clip inside a compound, recursively', () => {
    const inner = project([clip('in', { src: 'blob:inner' })])
    const outer = project([clip('c', { type: 'compound', compound: { project: inner } })])
    const out = stampMediaRefs(outer, [{ id: 'a', src: 'blob:inner', media: ref(5) }])
    expect(out).not.toBe(outer)
    expect(out.clips.v1[0].compound!.project.clips.v1[0].media).toEqual(ref(5))
    expect(outer.clips.v1[0].compound!.project).toBe(inner)
  })

  it('does not stamp clips that are not media clips', () => {
    const p = project([clip('t', { type: 'text', src: 'blob:x' })])
    expect(stampMediaRefs(p, [{ id: 'a', src: 'blob:x', media: ref(6) }])).toBe(p)
  })

  it('returns its input when the project is fully stamped', () => {
    const p = project([clip('a', { src: 'blob:x', media: ref(7) })])
    // A structurally equal reference (not the same object) is still "stamped".
    expect(stampMediaRefs(p, [{ id: 'a1', src: 'blob:x', media: ref(7) }])).toBe(p)
  })

  it('shares untouched track buckets', () => {
    const other = [clip('o', { trackId: 'v2', src: 'blob:o' })]
    const p = project([clip('a', { src: 'blob:x' })], { v2: other })
    const out = stampMediaRefs(p, [{ id: 'a1', src: 'blob:x', media: ref(8) }])
    expect(out.clips.v2).toBe(other)
    expect(out.clips.v1).not.toBe(p.clips.v1)
  })

  it('returns the identical result object for the same project twice', () => {
    const p = project([clip('a', { src: 'blob:x' })])
    const assets = [{ id: 'a1', src: 'blob:x', media: ref(9) }]
    const first = stampMediaRefs(p, assets)
    // A fresh array of fresh-but-equal asset objects, as a re-announce gives.
    const second = stampMediaRefs(p, [{ id: 'a1', src: 'blob:x', media: ref(9) }])
    expect(first).not.toBe(p)
    expect(second).toBe(first)
  })

  it('recomputes when the assets change', () => {
    const p = project([clip('a', { src: 'blob:x' })])
    const first = stampMediaRefs(p, [{ id: 'a1', src: 'blob:x', media: ref(1) }])
    const second = stampMediaRefs(p, [{ id: 'a1', src: 'blob:x', media: ref(2) }])
    expect(second).not.toBe(first)
    expect(second.clips.v1[0].media).toEqual(ref(2))
  })
})
