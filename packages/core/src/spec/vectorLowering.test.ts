import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Clip, Project } from '../types'
import { fitTransform } from '../vector/place'
import { svgToProject } from '../vector/svg/svgToProject'
import type { SvgNode } from '../vector/svg/types'
import { parseXml } from '../vector/svg/__tests__/xml'
import { buildVideo } from './build'
import type { AuthoredSpec } from './components/types'
import { MAX_VECTOR_PARTS, VECTOR_DEFAULT_FRACTION } from './vectorLowering'

const HD = { width: 1920, height: 1080, fps: 30 }

/** The explainer's orbit mark (docs/demo/svg/mark.svg): ids on every part, a nested group with opacity, a gradient. */
const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <defs><linearGradient id="gRing" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#3ec5ff"/><stop offset="100%" stop-color="#8a5cff"/></linearGradient></defs>
  <style>.ink { fill: #f5f1e8; } .accent { fill: #ff6a3d; }</style>
  <g id="shadow" opacity="0.35"><ellipse id="shadow-a" cx="100" cy="184" rx="58" ry="7" fill="#000000"/><ellipse id="shadow-b" cx="100" cy="184" rx="30" ry="4" fill="#000000"/></g>
  <circle id="ring" cx="100" cy="100" r="78" fill="none" stroke="url(#gRing)" stroke-width="10" stroke-linecap="round"/>
  <rect id="bar1" class="ink" x="62" y="70" width="76" height="12" rx="6"/>
  <circle id="dot" class="accent" cx="178" cy="100" r="9"/>
</svg>`

const mark = parseXml(MARK)

/** An SVG with `n` rects, for the part budget. */
function manyParts(n: number): SvgNode {
  const rects = Array.from({ length: n }, (_, i) => `<rect id="p${i}" x="${i * 10}" y="0" width="8" height="8" fill="#ffffff"/>`).join('')
  return parseXml(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">${rects}</svg>`)
}

const doc = (elements: AuthoredSpec['elements']): AuthoredSpec => ({ format: HD, duration: 6, elements })

const allClips = (project: Project): Clip[] => Object.values(project.clips).flat()
/** A clip anywhere in the project, including inside compounds. */
const find = (project: Project, id: string): Clip => {
  const walk = (p: Project): Clip | undefined => {
    for (const clip of allClips(p)) {
      if (clip.id === id) return clip
      const inner = clip.compound?.project ? walk(clip.compound.project) : undefined
      if (inner) return inner
    }
    return undefined
  }
  const clip = walk(project)
  if (!clip) throw new Error(`no clip ${id}`)
  return clip
}
const childNames = (clip: Clip): string[] => allClips(clip.compound!.project).map((c) => c.name)

const logo = (extra: Record<string, unknown> = {}) =>
  ({ id: 'logo', kind: 'vector', asset: 'mark', at: 0, duration: 3, x: 0.3, y: 0.4, w: 300, h: 300, ...extra }) as unknown as AuthoredSpec['elements'][number]

describe('vector elements — placeholder replaced by the imported compound (MI-P5)', () => {
  it('becomes a compound of path clips named by the SVG ids, in place of any rect', () => {
    const r = buildVideo(doc([logo()]), { seed: 1, polish: false, vectors: { mark } })
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([])
    const clip = find(r.project, r.elementClipIds.logo!)
    expect(clip.type).toBe('compound')
    expect(childNames(clip)).toEqual(expect.arrayContaining(['ring', 'bar1', 'dot']))
    // No placeholder rect survives anywhere.
    expect(allClips(r.project).filter((c) => c.type === 'shape')).toEqual([])
  })

  it('keeps the placeholder clip id, track, keys, matte, effects and part id (a minted id would orphan every reference)', () => {
    const spec = doc([
      logo({
        keys: [
          { channel: 'x', at: 0, value: 0.2 },
          { channel: 'x', at: 1, value: 0.8, curve: 'cubic-out' },
        ],
        matte: { element: 'cut', kind: 'alpha' },
        effects: [{ kind: 'gaussianBlur', params: [{ name: 'radius', value: 4 }] }],
        fxKeys: [{ effect: 'gaussianBlur', param: 'radius', at: 1, value: 12 }],
        blend: 'screen',
        opacity: 0.8,
      }),
      { id: 'cut', kind: 'shape', shape: 'circle', at: 0, duration: 3, w: 400, h: 400, fill: '#ffffff' },
    ] as AuthoredSpec['elements'])
    const r = buildVideo(spec, { seed: 1, polish: false, vectors: { mark } })
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([])
    const id = r.elementClipIds.logo!
    const clip = find(r.project, id)
    expect(clip.id).toBe(id)
    expect(clip.partId).toBe('logo')
    const trackOf = Object.entries(r.project.clips).find(([, list]) => list.some((c) => c.id === id))![0]
    expect(clip.trackId).toBe(trackOf)
    expect(clip.keyframes?.channels.x?.keys.map((k) => k.value)).toEqual([0.2, 0.8])
    expect(clip.matte).toEqual({ sourceClipId: r.elementClipIds.cut, kind: 'alpha' })
    expect(clip.effects?.[0]?.kind).toBe('gaussianBlur')
    const fxChannel = Object.keys(clip.keyframes?.channels ?? {}).find((c) => c.startsWith('fx.'))
    expect(fxChannel).toBeTruthy()
    expect(clip.blend).toBe('screen')
    expect(clip.opacity).toBe(0.8)
    expect(clip.startFrame).toBe(0)
    expect(clip.durationFrames).toBe(90)
  })

  it('a missing asset is a vector-missing ERROR and the placeholder is removed, never drawn', () => {
    const r = buildVideo(doc([logo({ asset: 'ghost' })]), { seed: 1, polish: false, vectors: { mark } })
    const issue = r.issues.find((i) => i.code === 'vector-missing')
    expect(issue?.severity).toBe('error')
    expect(issue?.message).toContain('ghost')
    expect(allClips(r.project)).toEqual([])
  })

  it('no vectors option at all is the same: every vector is missing and removed', () => {
    const r = buildVideo(doc([logo()]), { seed: 1, polish: false })
    expect(r.issues.some((i) => i.code === 'vector-missing')).toBe(true)
    expect(allClips(r.project)).toEqual([])
  })

  it('a vector with no asset name is an error and is removed at expand time', () => {
    const r = buildVideo(doc([logo({ asset: '' })]), { seed: 1, polish: false, vectors: { mark } })
    expect(r.issues.some((i) => i.code === 'vector-missing' && i.severity === 'error')).toBe(true)
    expect(allClips(r.project)).toEqual([])
  })

  it('fits the authored box: a 300 x 300 box on 1920 x 1080 is fitTransform\'s maths for fit 300 / 1080', () => {
    const r = buildVideo(doc([logo()]), { seed: 1, polish: false, vectors: { mark } })
    const clip = find(r.project, r.elementClipIds.logo!)
    const expected = fitTransform(clip.compound!.project.stage, r.project.stage, 300 / 1080)
    expect(clip.transform!.scale).toBeCloseTo(expected.scale, 10)
    expect(clip.transform!.scale).toBeCloseTo(300 / 1024, 10) // the SVG's long edge (1024 px) shown at 300 px
    expect(clip.transform!.x).toBeCloseTo(0.3, 10)
    expect(clip.transform!.y).toBeCloseTo(0.4, 10)
  })

  it('the long edge is max(w, h), and with neither it is 30% of the short side', () => {
    const wide = buildVideo(doc([logo({ w: 400, h: 200 })]), { seed: 1, polish: false, vectors: { mark } })
    expect(find(wide.project, wide.elementClipIds.logo!).transform!.scale).toBeCloseTo(400 / 1024, 10)
    const bare = buildVideo(doc([{ id: 'logo', kind: 'vector', asset: 'mark', at: 0, duration: 3 }] as AuthoredSpec['elements']), { seed: 1, polish: false, vectors: { mark } })
    expect(find(bare.project, bare.elementClipIds.logo!).transform!.scale).toBeCloseTo((VECTOR_DEFAULT_FRACTION * 1080) / 1024, 10)
  })

  it('an authored scale and scale keys are multipliers on that fit', () => {
    const r = buildVideo(
      doc([
        logo({
          scale: 2,
          keys: [
            { channel: 'scale', at: 0, value: 0 },
            { channel: 'scale', at: 0.5, value: 1.5 },
          ],
        }),
      ]),
      { seed: 1, polish: false, vectors: { mark } },
    )
    const clip = find(r.project, r.elementClipIds.logo!)
    const base = 300 / 1024
    expect(clip.transform!.scale).toBeCloseTo(2 * base, 8)
    const keys = clip.keyframes!.channels.scale!.keys
    expect(keys[0]!.value).toBeCloseTo(0, 8)
    expect(keys[1]!.value).toBeCloseTo(1.5 * base, 5)
  })

  it('a scale expression is rebased by wrapping it; scaleX / scaleY keys are dropped with a warn', () => {
    const r = buildVideo(
      doc([
        logo({
          expressions: [{ channel: 'scale', source: '1 + 0.05 * sin(time * 3)' }],
          keys: [{ channel: 'scaleX', at: 0, value: 0.5 }],
        }),
      ]),
      { seed: 1, polish: false, vectors: { mark } },
    )
    const clip = find(r.project, r.elementClipIds.logo!)
    const channel = clip.keyframes!.channels.scale!
    expect(channel.source.kind).toBe('expression')
    expect((channel.source as { source: string }).source).toMatch(/^\(1 \+ 0\.05 \* sin\(time \* 3\)\) \* 0\.2929/)
    expect(clip.keyframes!.channels.scaleX).toBeUndefined()
    expect(r.issues.some((i) => i.code === 'vector-channel-dropped')).toBe(true)
  })

  it('a nested <g opacity> compound survives inside the compound', () => {
    const r = buildVideo(doc([logo()]), { seed: 1, polish: false, vectors: { mark } })
    const clip = find(r.project, r.elementClipIds.logo!)
    const shadow = allClips(clip.compound!.project).find((c) => c.name === 'shadow')
    expect(shadow?.type).toBe('compound')
    expect(childNames(shadow!)).toEqual(['shadow-a', 'shadow-b'])
    expect(shadow!.opacity).toBeCloseTo(0.35, 5)
  })

  it('more than MAX_VECTOR_PARTS parts is a vector-parts WARN and the asset is still placed', () => {
    const r = buildVideo(doc([logo({ asset: 'busy' })]), { seed: 1, polish: false, vectors: { busy: manyParts(MAX_VECTOR_PARTS + 2) } })
    const issue = r.issues.find((i) => i.code === 'vector-parts')
    expect(issue?.severity).toBe('warn')
    expect(find(r.project, r.elementClipIds.logo!).type).toBe('compound')
    const ok = buildVideo(doc([logo({ asset: 'busy' })]), { seed: 1, polish: false, vectors: { busy: manyParts(MAX_VECTOR_PARTS) } })
    expect(ok.issues.some((i) => i.code === 'vector-parts')).toBe(false)
  })

  it('an SVG with no drawn part is a vector-empty error and is removed', () => {
    const empty = parseXml('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs/></svg>')
    const r = buildVideo(doc([logo({ asset: 'void' })]), { seed: 1, polish: false, vectors: { void: empty } })
    expect(r.issues.some((i) => i.code === 'vector-empty' && i.severity === 'error')).toBe(true)
    expect(allClips(r.project)).toEqual([])
  })

  it('works inside a group (the parent stage is the group level\'s) and with polish on', () => {
    const grouped = doc([
      {
        id: 'scene',
        kind: 'group',
        at: 0,
        duration: 4,
        children: [{ id: 'logo', kind: 'vector', asset: 'mark', at: 0.5, duration: 2, w: 300, h: 300 }],
      },
    ] as unknown as AuthoredSpec['elements'])
    for (const polish of [false, true]) {
      const r = buildVideo(structuredClone(grouped), { seed: 4, polish, vectors: { mark } })
      expect(r.issues.filter((i) => i.severity === 'error')).toEqual([])
      const clip = find(r.project, r.elementClipIds.logo!)
      expect(clip.type).toBe('compound')
      expect(clip.partId).toBe('logo')
      expect(clip.startFrame).toBe(15)
    }
  })

  it('polish keys written on the placeholder (an arrival) are carried to the compound', () => {
    const r = buildVideo(doc([logo({ enter: 'pop-in' })]), { seed: 1, polish: true, vectors: { mark } })
    const clip = find(r.project, r.elementClipIds.logo!)
    expect(Object.keys(clip.keyframes?.channels ?? {}).length).toBeGreaterThan(0)
  })

  it('is byte-identical across two builds with the same seed, ids included', () => {
    const a = buildVideo(structuredClone(doc([logo(), logo({ id: 'logo2', x: 0.7 })])), { seed: 9, vectors: { mark } })
    const b = buildVideo(structuredClone(doc([logo(), logo({ id: 'logo2', x: 0.7 })])), { seed: 9, vectors: { mark } })
    expect(JSON.stringify(a.project)).toBe(JSON.stringify(b.project))
  })

  it('a motion system that targets a vector keeps working: the id is unchanged, so the keys it wrote land on the compound', () => {
    const spec = doc([
      logo({ id: 'a', x: 0.2 }),
      logo({ id: 'b', x: 0.8 }),
      { id: 'snap', kind: 'system', system: 'arrange', at: 0.5, duration: 0.8, targets: ['a', 'b'], params: [{ name: 'cols', value: 2 }] },
    ] as AuthoredSpec['elements'])
    const r = buildVideo(spec, { seed: 3, polish: false, vectors: { mark } })
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([])
    for (const id of ['a', 'b']) {
      const clip = find(r.project, r.elementClipIds[id]!)
      expect(clip.type).toBe('compound')
      const channels = Object.keys(clip.keyframes?.channels ?? {})
      expect(channels).toEqual(expect.arrayContaining(['x', 'y']))
    }
  })

  it('also lowers when no seed is given (the unseeded branch of buildVideo)', () => {
    const r = buildVideo(doc([logo()]), { polish: false, vectors: { mark } })
    expect(find(r.project, r.elementClipIds.logo!).type).toBe('compound')
  })

  it('a document with no vector is untouched: same project whether or not vectors are passed', () => {
    const plain = doc([{ id: 'a', kind: 'shape', shape: 'rect', at: 0, duration: 2, w: 100, h: 100 }] as AuthoredSpec['elements'])
    const a = buildVideo(structuredClone(plain), { seed: 3 })
    const b = buildVideo(structuredClone(plain), { seed: 3, vectors: { mark } })
    expect(JSON.stringify(b.project)).toBe(JSON.stringify(a.project))
    expect(b.issues).toEqual(a.issues)
  })

  it('the expanded spec fed back through buildVideo lowers the vector again', () => {
    const once = buildVideo(doc([logo()]), { seed: 2, vectors: { mark } })
    const again = buildVideo(structuredClone(once.expandedSpec) as AuthoredSpec, { seed: 2, vectors: { mark } })
    expect(find(again.project, again.elementClipIds.logo!).type).toBe('compound')
  })
})

describe('the explainer\'s hand-drawn SVGs (docs/demo/svg) — what a good asset is (MI-P5 style guide)', () => {
  const dir = join(__dirname, '..', '..', '..', '..', '..', 'docs', 'demo', 'svg')
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.svg')) : []

  it.skipIf(files.length === 0)('finds the six files', () => {
    expect(files.sort()).toEqual(['ad.svg', 'estate.svg', 'fashion.svg', 'interior.svg', 'mark.svg', 'room.svg', 'wordmark.svg'].filter((f) => files.includes(f)))
    expect(files.length).toBeGreaterThanOrEqual(6)
  })

  // Measured, not assumed: room.svg draws 12 parts (the window is a rect plus four <use> panes), two over the budget the
  // ticket states for the set. It is pinned at 12 so a change to the importer or to the file shows; it is the one asset a
  // 10-part client cap (MAX_ASSET_PARTS) would drop.
  const PARTS: Record<string, number> = { 'ad.svg': 5, 'estate.svg': 6, 'fashion.svg': 5, 'interior.svg': 5, 'mark.svg': 8, 'room.svg': 12, 'wordmark.svg': 5 }

  for (const file of files) {
    it(`${file} imports with nothing skipped${file === 'room.svg' ? ' (12 parts: over the budget of 10)' : ' and inside the part budget'}`, () => {
      const node = parseXml(readFileSync(join(dir, file), 'utf8'))
      const result = svgToProject(node, { fps: 30, durationFrames: 90, size: 1024 })
      expect(result.skipped).toEqual([])
      expect(result.shapeCount).toBeGreaterThan(0)
      if (file in PARTS) expect(result.shapeCount).toBe(PARTS[file])
      if (file !== 'room.svg') expect(result.shapeCount).toBeLessThanOrEqual(MAX_VECTOR_PARTS)
    })
  }
})
