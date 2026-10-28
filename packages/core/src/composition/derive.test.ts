import { describe, expect, it } from 'vitest'
import { COMPOUND_TEMPLATES } from '../elements/compoundTemplates'
import { DEFAULT_TEXT_TRANSFORM } from '../resolver/textAnimation'
import type { Clip, Project, Track } from '../types'
import { deriveComposition, propIdentifier, uniquePropName } from './derive'
import { instantiate } from './instantiate'
import type { ProjectComposition } from './types'

let seq = 0
const nextId = (): string => `clip-${++seq}`

function track(id: string, order: number): Track {
  return {
    id, name: id, kind: 'elements', order, height: 54,
    locked: false, disabled: false, muted: false, solo: false,
  }
}

function baseClip(o: Partial<Clip> & { type: Clip['type']; trackId: string }): Clip {
  return {
    id: nextId(), name: 'Clip', startFrame: 0, durationFrames: 30,
    sourceStartFrame: 0, sourceDurationFrames: 30,
    transform: { ...DEFAULT_TEXT_TRANSFORM },
    ...o,
  } as Clip
}

function textClip(trackId: string, name: string, content: string, startFrame = 0): Clip {
  return baseClip({ type: 'text', trackId, name, content, startFrame })
}

function shapeClip(trackId: string, name: string, shapeFill: string, startFrame = 0): Clip {
  return baseClip({ type: 'shape', trackId, name, shapeFill, startFrame } as Partial<Clip> & { type: 'shape'; trackId: string })
}

function mediaClip(type: 'image' | 'video' | 'audio', trackId: string, name: string, src: string | undefined, startFrame = 0): Clip {
  return baseClip({ type, trackId, name, src, startFrame })
}

function compoundClip(trackId: string, name: string, child: Project, startFrame = 0): Clip {
  return baseClip({ type: 'compound', trackId, name, startFrame, compound: { project: child } })
}

function project(entries: Array<{ track: Track; clips: Clip[] }>, composition?: ProjectComposition): Project {
  return {
    id: 'p1', fps: 30, stage: { width: 1080, height: 1920 },
    tracks: entries.map((e) => e.track),
    clips: Object.fromEntries(entries.map((e) => [e.track.id, e.clips])),
    transitions: [],
    version: 1,
    ...(composition ? { composition } : {}),
  } as unknown as Project
}

describe('propIdentifier', () => {
  it('matches the Design examples', () => {
    expect(propIdentifier('Lower third: Priya')).toBe('lowerThirdPriya')
    expect(propIdentifier('Title')).toBe('title')
    expect(propIdentifier('2024 Recap')).toBe('_2024Recap')
    expect(propIdentifier('')).toBe('')
  })
})

describe('uniquePropName', () => {
  it('picks the first unused base2/base3…', () => {
    expect(uniquePropName('title', new Set(['title', 'title2']))).toBe('title3')
  })

  it('does not modify `used`', () => {
    const used = new Set(['title'])
    uniquePropName('title', used)
    expect(used).toEqual(new Set(['title']))
  })
})

describe('deriveComposition', () => {
  it('gives two same-named text clips title, title2', () => {
    const t1 = textClip('el-1', 'Title', 'Hello')
    const t2 = textClip('el-1', 'Title', 'World')
    const p = project([{ track: track('el-1', 0), clips: [t1, t2] }])
    const comp = deriveComposition(p)!
    const names = comp.props.map((d) => d.name)
    expect(names).toContain('title')
    expect(names).toContain('title2')
  })

  it('derives a colour prop from a shape fill', () => {
    const s = shapeClip('el-1', 'Badge', '#FF0000')
    const p = project([{ track: track('el-1', 0), clips: [s] }])
    const comp = deriveComposition(p)!
    const badge = comp.props.find((d) => d.name === 'badgeColor')!
    expect(badge).toBeTruthy()
    expect(badge.type).toBe('color')
    expect(badge.default).toBe('#ff0000')
  })

  it('skips a shape with a non-hex fill', () => {
    const s = shapeClip('el-1', 'Badge', 'transparent')
    const p = project([{ track: track('el-1', 0), clips: [s] }])
    expect(deriveComposition(p)).toBeUndefined()
  })

  it('skips a shape whose fill is a gradient paint (PV-P6a), even with a hex shapeFill fallback', () => {
    const s = shapeClip('el-1', 'Badge', '#FF0000')
    s.shapeFillPaint = { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#fff' }, { offset: 1, color: '#000' }] }
    const p = project([{ track: track('el-1', 0), clips: [s] }])
    expect(deriveComposition(p)).toBeUndefined()
  })

  it('derives an image prop from a recoverable src', () => {
    const img = mediaClip('image', 'el-1', 'Logo', 'https://cdn.example/logo.png')
    const p = project([{ track: track('el-1', 0), clips: [img] }])
    const comp = deriveComposition(p)!
    const logo = comp.props.find((d) => d.name === 'logo')!
    expect(logo.type).toBe('image')
    expect(logo.default).toBe('https://cdn.example/logo.png')
  })

  it('skips an image with a blob: src', () => {
    const img = mediaClip('image', 'el-1', 'Logo', 'blob:local-object')
    const p = project([{ track: track('el-1', 0), clips: [img] }])
    expect(deriveComposition(p)).toBeUndefined()
  })

  it('derives a binding into a compound child, with a parent/child clip path', () => {
    const inner = textClip('inner-1', 'Name', 'Someone')
    const child = project([{ track: track('inner-1', 0), clips: [inner] }])
    const card = compoundClip('el-1', 'Card', child)
    const p = project([{ track: track('el-1', 0), clips: [card] }])
    const comp = deriveComposition(p)!
    const binding = comp.bindings.find((b) => b.prop === 'name')!
    expect(binding).toBeTruthy()
    expect(binding.clipId).toBe(`${card.id}/${inner.id}`)
  })

  it('returns the project\'s own composition untouched', () => {
    const t1 = textClip('el-1', 'Title', 'Hello')
    const own: ProjectComposition = { props: [], bindings: [] }
    const p = project([{ track: track('el-1', 0), clips: [t1] }], own)
    expect(deriveComposition(p)).toBe(own)
  })

  it('is undefined for an empty project', () => {
    const p = project([{ track: track('el-1', 0), clips: [] }])
    expect(deriveComposition(p)).toBeUndefined()
  })

  it('instantiate can write into a derived composition', () => {
    const t1 = textClip('el-1', 'Title', 'Hello')
    const p = project([{ track: track('el-1', 0), clips: [t1] }])
    const comp = deriveComposition(p)!
    const withDerived: Project = { ...p, composition: comp }
    const { project: out, issues } = instantiate(withDerived, { title: 'X' }, { seed: 1 })
    expect(issues).toEqual([])
    const written = Object.values(out.clips).flat().find((c) => c.id === t1.id)!
    expect(written.content).toBe('X')
  })
})

describe('deriveComposition — PV-P1d compound template smoke test', () => {
  for (const t of COMPOUND_TEMPLATES) {
    it(`${t.id}: derives at least one text prop and instantiate writes it`, () => {
      const child = t.build({ fps: 30, width: 1080, height: 1920 })
      const comp = deriveComposition(child)!
      const textProps = comp.props.filter((d) => d.type === 'text')
      expect(textProps.length).toBeGreaterThanOrEqual(1)

      const withDerived: Project = { ...child, composition: comp }
      const { issues, project: out } = instantiate(withDerived, { [textProps[0]!.name]: 'X' }, { seed: 1 })
      expect(issues).toEqual([])
      const binding = comp.bindings.find((b) => b.prop === textProps[0]!.name)!
      const written = Object.values(out.clips).flat().find((c) => c.id === binding.clipId)!
      expect(written.content).toBe('X')
    })
  }
})
