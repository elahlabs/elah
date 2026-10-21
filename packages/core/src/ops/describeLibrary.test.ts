import { describe, expect, it } from 'vitest'
import type { MediaAsset } from '../assets/types'
import { describeLibrary, MAX_SEEN_PER_ASSET, MAX_SEEN_TOTAL_CHARS } from './describeLibrary'

type Words = NonNullable<MediaAsset['transcript']>['words']

const asset = (id: string, durationSec: number, extra: Partial<MediaAsset> = {}): MediaAsset =>
  ({ id, kind: 'video', name: id, src: `blob:${id}`, durationSec, byteSize: 1, lastModified: 0, addedAt: 0, ...extra }) as MediaAsset

describe('describeLibrary', () => {
  it('caps at 40 with the longest first, and says how many were left out', () => {
    const many = Array.from({ length: 50 }, (_, i) => asset(`a${i}`, i + 1))
    const d = describeLibrary(many)
    expect(d.assets).toHaveLength(40)
    expect(d.assetsOmitted).toBe(10)
    expect(d.assets[0]!.id).toBe('a49') // the longest source is never the one dropped
    expect(d.assets.some((a) => a.id === 'a0')).toBe(false)
  })

  it('sets assetsOmitted only when something was left out', () => {
    expect('assetsOmitted' in describeLibrary([asset('x', 5)])).toBe(false)
    expect(describeLibrary([asset('x', 5), asset('y', 6)], { max: 1 }).assetsOmitted).toBe(1)
  })

  it('reports a transcript as cached only when it holds a word', () => {
    const t = (words: Words) => ({ words, language: 'en', taskId: 't', createdAt: 1 })
    const d = describeLibrary([
      asset('none', 3),
      asset('empty', 4, { transcript: t([]) }),
      asset('has', 5, { transcript: t([{ text: 'hi', startSeconds: 0, endSeconds: 0.4 }]) }),
    ])
    expect(Object.fromEntries(d.assets.map((a) => [a.id, a.transcript]))).toEqual({ none: 'none', empty: 'none', has: 'cached' })
  })

  it('names, summaries and tags stay inside their budgets, and the sound flag passes through', () => {
    const d = describeLibrary([
      asset('v', 12.3456, {
        name: 'n'.repeat(100),
        hasAudio: false,
        analysis: { summary: 's'.repeat(400), tags: Array.from({ length: 12 }, (_, i) => `t${i}`), frameCount: 1, topObjects: [], durationSec: 12 },
      }),
    ]).assets[0]!
    expect(d.name).toHaveLength(60)
    expect(d.about).toHaveLength(240)
    expect(d.tags).toHaveLength(8)
    expect(d.hasAudio).toBe(false)
    expect(d.durationSec).toBe(12.35)
    expect(describeLibrary([asset('v', 1, { name: 'abcdefgh' })], { maxNameChars: 3 }).assets[0]!.name).toBe('abc')
  })

  it('leaves out about, tags and the sound flag when the asset has none', () => {
    expect(describeLibrary([asset('v', 2)]).assets[0]).toEqual({ id: 'v', kind: 'video', name: 'v', durationSec: 2, transcript: 'none' })
  })
})

describe('describeLibrary: seen (AGN-P11)', () => {
  const obs = (n: number, summary = 'a person at a desk') =>
    Array.from({ length: n }, (_, i) => ({ timestampSec: i * 1.234, summary, tags: ['a', 'b', 'c', 'd', 'e', 'f'] }))

  it('lists observations with times, tags trimmed', () => {
    const d = describeLibrary([asset('v', 9, { footage: { state: 'analysed', observations: obs(2) } })]).assets[0]!
    expect(d.seen).toEqual([
      { atSec: 0, what: 'a person at a desk', tags: ['a', 'b', 'c', 'd'] },
      { atSec: 1.2, what: 'a person at a desk', tags: ['a', 'b', 'c', 'd'] },
    ])
  })

  it('caps observations per asset and cuts each summary', () => {
    const d = describeLibrary([asset('v', 9, { footage: { state: 'analysed', observations: obs(40, 'x'.repeat(400)) } })]).assets[0]!
    expect(d.seen).toHaveLength(MAX_SEEN_PER_ASSET)
    expect(d.seen!.every((s) => s.what.length === 160)).toBe(true)
  })

  it('keeps the whole library description inside the total budget', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      asset(`a${i}`, 100 - i, { footage: { state: 'analysed', observations: obs(40, 'y'.repeat(400)) } }),
    )
    const d = describeLibrary(many)
    const chars = d.assets.reduce((n, a) => n + (a.seen ?? []).reduce((m, s) => m + s.what.length + (s.tags ?? []).join('').length, 0), 0)
    expect(chars).toBeLessThanOrEqual(MAX_SEEN_TOTAL_CHARS)
    expect(Math.max(...d.assets.map((a) => a.seen?.length ?? 0))).toBeLessThanOrEqual(MAX_SEEN_PER_ASSET)
    // the longest source is served first
    expect(d.assets[0]!.seen?.length).toBe(MAX_SEEN_PER_ASSET)
    expect(JSON.stringify(d).length).toBeLessThan(40_000)
  })

  it('never offers observations from a run that was not analysed', () => {
    const d = describeLibrary([asset('v', 9, { footage: { state: 'not-analysed', observations: obs(3) } })]).assets[0]!
    expect('seen' in d).toBe(false)
  })

  it('leaves seen out when there is nothing, and skips blank or untimed entries', () => {
    expect('seen' in describeLibrary([asset('v', 3)]).assets[0]!).toBe(false)
    const d = describeLibrary([
      asset('v', 3, { footage: { observations: [{ timestampSec: 1, summary: '  ', tags: [] }, { timestampSec: NaN, summary: 'x', tags: [] }] } }),
    ]).assets[0]!
    expect('seen' in d).toBe(false)
  })
})

describe('describeLibrary: SVG assets (SVG-1a)', () => {
  it('an SVG image reads as svg with its origin line; a PNG stays an image with none', () => {
    const d = describeLibrary([
      asset('icon', 0, {
        kind: 'image',
        name: 'material-symbols/home',
        vector: { origin: 'iconify', source: { provider: 'iconify', set: 'material-symbols', setName: 'Material Symbols', name: 'home', licence: 'Apache-2.0', pageUrl: 'https://x' } },
      }),
      asset('drawn', 0, { kind: 'image', name: 'orbit', vector: { origin: 'model' } }),
      asset('legacy', 0, { kind: 'image', name: 'Logo.svg' }),
      asset('photo', 0, { kind: 'image', name: 'Skyline.png', src: 'https://cdn.example.com/a.png' }),
    ])
    const by = Object.fromEntries(d.assets.map((a) => [a.id, a]))
    expect(by.icon).toMatchObject({ kind: 'svg', origin: 'Open-source icon · Material Symbols (Apache-2.0)' })
    expect(by.drawn).toMatchObject({ kind: 'svg', origin: 'Drawn by the assistant' })
    expect(by.legacy!.kind).toBe('svg')
    expect('origin' in by.legacy!).toBe(false)
    expect(by.photo!.kind).toBe('image')
    expect('origin' in by.photo!).toBe(false)
  })
})
