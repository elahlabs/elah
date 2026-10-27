import { describe, expect, it } from 'vitest'
import { instantiate } from './instantiate'
import { compositionPropReader, propReaderFor } from './propReader'
import type { Binding, ProjectComposition, PropDef } from './types'
import { resolveTimeline } from '../resolver/resolveTimeline'
import { DEFAULT_TEXT_TRANSFORM } from '../resolver/textAnimation'
import type { Clip, ClipKeyframes, Keyframe, Project, Track } from '../types'

const numberProp = (name: string, def: number): PropDef => ({ name, type: 'number', default: def, label: name })
const textProp = (name: string, def: string): PropDef => ({ name, type: 'text', default: def, label: name })
const boolProp = (name: string, def: boolean): PropDef => ({ name, type: 'boolean', default: def, label: name })

function composition(props: PropDef[], values?: Record<string, unknown>): ProjectComposition {
  return { props, bindings: [], ...(values ? { values: values as ProjectComposition['values'] } : {}) }
}

describe('compositionPropReader', () => {
  it('returns the stored value over the default', () => {
    const reader = compositionPropReader(composition([numberProp('level', 0.25)], { level: 0.75 }))
    expect(reader('level')).toBe(0.75)
  })

  it('returns the default when unset', () => {
    const reader = compositionPropReader(composition([numberProp('level', 0.25)]))
    expect(reader('level')).toBe(0.25)
  })

  it('reads a boolean stored value as 1/0', () => {
    const reader = compositionPropReader(composition([boolProp('flag', false)], { flag: true }))
    expect(reader('flag')).toBe(1)
  })

  it('reads a boolean default as 1/0', () => {
    const reader = compositionPropReader(composition([boolProp('flag', true)]))
    expect(reader('flag')).toBe(1)
    expect(compositionPropReader(composition([boolProp('flag2', false)]))('flag2')).toBe(0)
  })

  it('returns a string for a text prop', () => {
    const reader = compositionPropReader(composition([textProp('title', 'Hello')], { title: 'Ann' }))
    expect(reader('title')).toBe('Ann')
  })

  it('returns undefined for an unknown name', () => {
    const reader = compositionPropReader(composition([numberProp('level', 0.25)]))
    expect(reader('nope')).toBeUndefined()
  })
})

describe('propReaderFor', () => {
  it('returns the same function for the same composition object', () => {
    const comp = composition([numberProp('level', 0.25)])
    const a = propReaderFor({ composition: comp })
    const b = propReaderFor({ composition: comp })
    expect(a).toBe(b)
  })

  it('is undefined without a composition', () => {
    expect(propReaderFor({})).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Resolve — prop() wired into resolveTimeline through createExpressionContext
// ---------------------------------------------------------------------------

const k = (frame: number, value: number): Keyframe => ({ id: `k${frame}`, frame, value, easing: 'linear' })

function makeTrack(): Track {
  return {
    id: 'el-1', name: 'T', kind: 'elements', order: 0, height: 54,
    locked: false, disabled: false, muted: false, solo: false,
  }
}

function makeClip(o: Partial<Clip> = {}): Clip {
  return {
    id: 't1', trackId: 'el-1', type: 'text', name: 'Title', content: 'x',
    startFrame: 0, durationFrames: 30, sourceStartFrame: 0, sourceDurationFrames: 30,
    transform: { ...DEFAULT_TEXT_TRANSFORM },
    ...o,
  } as unknown as Clip
}

function makeProject(clip: Clip, composition?: ProjectComposition): Project {
  const track = makeTrack()
  return {
    id: 'p1', fps: 30, stage: { width: 1080, height: 1920 },
    tracks: [track], clips: { [track.id]: [clip] }, transitions: [], version: 1,
    ...(composition ? { composition } : {}),
  } as unknown as Project
}

describe('prop() resolved through resolveTimeline', () => {
  const levelClip = makeClip({
    keyframes: { channels: { opacity: { source: { kind: 'expression', source: 'prop("level")' }, keys: [] } } } as ClipKeyframes,
  })

  it('reads the composition default', () => {
    const comp = composition([numberProp('level', 0.25)])
    const project = makeProject(levelClip, comp)
    expect(resolveTimeline(0, project).texts[0]!.opacity).toBe(0.25)
  })

  it('reads a stored value', () => {
    const comp = composition([numberProp('level', 0.25)], { level: 0.5 })
    const project = makeProject(levelClip, comp)
    expect(resolveTimeline(0, project).texts[0]!.opacity).toBe(0.5)
  })

  it('reads the value instantiate wrote', () => {
    const comp = composition([numberProp('level', 0.25)])
    const project = makeProject(levelClip, comp)
    const { project: written } = instantiate(project, { level: 0.75 }, { seed: 1 })
    expect(resolveTimeline(0, written).texts[0]!.opacity).toBe(0.75)
  })

  it('reports prop-unavailable and resolves to 0 without a composition', () => {
    const project = makeProject(levelClip)
    const scene = resolveTimeline(0, project)
    expect(scene.texts[0]!.opacity).toBe(0)
    expect(scene.expressionErrors).toEqual([
      { clipId: 't1', channel: 'opacity', code: 'prop-unavailable', message: 'prop("level") is not available here' },
    ])
  })
})
