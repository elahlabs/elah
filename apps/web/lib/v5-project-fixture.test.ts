import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  PROJECT_VERSION,
  TimelineEngine,
  createGenerator,
  readProjectDocument,
  setKeyframe,
  type Clip,
  type Project,
} from '@elah/core'

/**
 * A version-5 project that uses the clip types the open-source playground has
 * no editor for: a compound (nested timeline), a generator, an adjustment and
 * a sequence clip, a GPU-only `zoom` transition and a keyed skew. It is built
 * with the core's own factories, then saved as `__fixtures__/v5-project.json`
 * so the playground can be checked by loading the same file (CONV-4).
 *
 * Regenerate the JSON with `WRITE_V5_FIXTURE=1` set; ids are random, so a
 * fresh write always changes the file.
 */

const FIXTURE = fileURLToPath(new URL('./__fixtures__/v5-project.json', import.meta.url))
const V1_FIXTURE = fileURLToPath(
  new URL('../../../packages/cli/src/__fixtures__/multi-layer.json', import.meta.url),
)
const STAGE = { width: 1280, height: 720 }
const CENTRE = { x: 0.5, y: 0.5 }

function nestedProject(): Project {
  const inner = new TimelineEngine({ fps: 30, stage: STAGE, initialTracks: [{ kind: 'elements', name: 'Inner' }] })
  const track = inner.getProject().tracks[0].id
  inner.addClip({
    type: 'shape',
    trackId: track,
    name: 'Inner circle',
    startFrame: 0,
    durationFrames: 90,
    shape: { shapeKind: 'circle', shapeFill: '#ffd166' },
    transform: { x: 0.5, y: 0.5, scale: 0.6, rotation: 0, anchor: CENTRE },
  })
  inner.addClip({
    type: 'text',
    trackId: track,
    name: 'Inner title',
    startFrame: 90,
    durationFrames: 30,
    text: { content: 'Nested', fontSize: 96, color: '#ffffff' },
  })
  return inner.getProject()
}

export function buildV5Project(): Project {
  const engine = new TimelineEngine({
    fps: 30,
    stage: STAGE,
    initialTracks: [
      { kind: 'video', name: 'Video 1' },
      { kind: 'video', name: 'Video 2' },
      { kind: 'elements', name: 'Elements' },
    ],
  })
  const [v1, v2, el] = engine.getProject().tracks.map((t) => t.id)

  const generator = engine.addClip({
    type: 'generator',
    trackId: v1,
    name: 'Gradient',
    startFrame: 0,
    durationFrames: 60,
    generator: createGenerator('gradientBackground', { spin: 30 }),
  })
  const compound = engine.addClip({
    type: 'compound',
    trackId: v1,
    name: 'Nested timeline',
    startFrame: 60,
    durationFrames: 120,
    compound: { project: nestedProject() },
  })
  engine.addTransition({
    fromClipId: generator.id,
    toClipId: compound.id,
    trackId: v1,
    kind: 'zoom',
    durationFrames: 20,
  })

  engine.addClip({
    type: 'sequence',
    trackId: v2,
    name: 'Logo frames',
    startFrame: 0,
    durationFrames: 45,
    sequence: {
      kind: 'frames',
      frameUrlTemplate: '/assets/cinematic-logo.png?f={frame}',
      frameCount: 15,
      fps: 15,
      loop: true,
    },
    transform: { x: 0.85, y: 0.18, scale: 0.2, rotation: 0, anchor: CENTRE },
  })
  engine.addClip({
    type: 'adjustment',
    trackId: v2,
    name: 'Adjustment',
    startFrame: 120,
    durationFrames: 60,
  })

  const shape = engine.addClip({
    type: 'shape',
    trackId: el,
    name: 'Skewed card',
    startFrame: 0,
    durationFrames: 180,
    shape: { shapeKind: 'rect', shapeFill: '#00c2ff' },
    transform: { x: 0.3, y: 0.7, scale: 0.3, rotation: 0, anchor: CENTRE },
  })
  const ctx = { stage: STAGE }
  let keyed: Clip = engine.findClip(shape.id)!.clip
  keyed = { ...keyed, ...setKeyframe(keyed, 'skewX', 0, ctx, 0) }
  keyed = { ...keyed, ...setKeyframe(keyed, 'skewX', 60, ctx, 0.4) }
  engine.updateClip(shape.id, el, { keyframes: keyed.keyframes, transform: keyed.transform })

  return engine.getProject()
}

function allClips(project: Project): Clip[] {
  return Object.values(project.clips).flat()
}

if (process.env.WRITE_V5_FIXTURE) {
  writeFileSync(FIXTURE, JSON.stringify(buildV5Project(), null, 2) + '\n')
}

describe('v5 project fixture', () => {
  const stored = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Project

  it('is what the converged core builds today', () => {
    const fresh = buildV5Project()
    expect(fresh.version).toBe(PROJECT_VERSION)
    expect(allClips(fresh).map((c) => c.type).sort()).toEqual(allClips(stored).map((c) => c.type).sort())
  })

  it('is a version-5 document with every new feature in it', () => {
    expect(stored.version).toBe(5)
    const types = new Set(allClips(stored).map((c) => c.type))
    for (const type of ['compound', 'generator', 'adjustment', 'sequence'] as const) expect(types.has(type)).toBe(true)
    expect(stored.transitions.map((t) => t.kind)).toEqual(['zoom'])
    const skew = allClips(stored).find((c) => c.keyframes?.channels.skewX)
    expect(skew?.keyframes?.channels.skewX?.keys.map((k) => k.value)).toEqual([0, 0.4])
  })

  it('reads back through readProjectDocument with every clip intact', () => {
    const read = readProjectDocument(structuredClone(stored))
    expect(read.version).toBe(5)
    expect(allClips(read)).toEqual(allClips(stored))
    expect(read.transitions).toEqual(stored.transitions)
    const compound = allClips(read).find((c) => c.type === 'compound')!
    const inner = allClips(stored).find((c) => c.type === 'compound')!
    expect(allClips(compound.compound!.project)).toEqual(allClips(inner.compound!.project))
  })

  it('survives a save and reload through the engine', () => {
    const engine = new TimelineEngine({ fps: 30 })
    engine.loadProject(readProjectDocument(structuredClone(stored)))
    const saved = JSON.parse(JSON.stringify(engine.getProject())) as unknown
    const reread = readProjectDocument(saved)
    expect(reread.version).toBe(5)
    expect(allClips(reread)).toEqual(allClips(stored))
  })

  it('still reads an open-source version-1 document unchanged', () => {
    const v1 = JSON.parse(readFileSync(V1_FIXTURE, 'utf8')) as Project
    expect(v1.version).toBe(1)
    const read = readProjectDocument(structuredClone(v1))
    expect(read.version).toBe(1)
    expect(read.tracks.map((t) => t.id)).toEqual(v1.tracks.map((t) => t.id))
    expect(allClips(read)).toEqual(allClips(v1))
  })
})
