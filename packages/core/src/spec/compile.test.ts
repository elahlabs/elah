import { describe, expect, it } from 'vitest'
import { compileVideoSpec } from './compile'
import { readProjectDocument } from '../editor/projectDocument'
import type { Clip, Project } from '../types'
import type { SpecElement, VideoSpec } from './types'

function baseSpec(elements: SpecElement[], overrides: Partial<VideoSpec> = {}): VideoSpec {
  return {
    format: { width: 1080, height: 1920, fps: 30 },
    duration: 5,
    elements,
    ...overrides,
  }
}

function allClips(project: Project): Clip[] {
  return Object.values(project.clips).flat()
}

function clipFor(project: Project, elementClipIds: Record<string, string>, elementId: string): Clip {
  const id = elementClipIds[elementId]!
  return allClips(project).find((c) => c.id === id)!
}

/** Every clip in `project`, recursing into every `compound` clip's own nested project, at any depth. */
function allClipsDeep(project: Project): Clip[] {
  return allClips(project).flatMap((c) => (c.compound ? [c, ...allClipsDeep(c.compound.project)] : [c]))
}

describe('compileVideoSpec — never throws', () => {
  it('does not throw on a spec full of bad references and unknown names', () => {
    const spec = baseSpec([
      { id: 't', kind: 'text', text: 'Hi', at: 0, duration: 2, font: '$nope', layout: { anchorTo: { element: 'ghost', edge: 'bottom' } } },
      { id: 's', kind: 'shape', shape: 'rect', at: 0, duration: 2, enter: 'not-a-real-preset' },
      { id: 'i', kind: 'icon', icon: 'not-a-real-icon', at: 0, duration: 2 },
    ])
    expect(() => compileVideoSpec(spec)).not.toThrow()
  })
})

describe('reference rewrite — anchorTo / fitTo / clip("id")', () => {
  it('rewrites layout.anchorTo.element to the real clip id', () => {
    const spec = baseSpec([
      { id: 'title', kind: 'text', text: 'Hi', at: 0, duration: 2 },
      { id: 'sub', kind: 'text', text: 'Sub', at: 0, duration: 2, layer: 1, layout: { anchorTo: { element: 'title', edge: 'bottom', gap: 8 } } },
    ])
    const { project, elementClipIds, issues } = compileVideoSpec(spec)
    const sub = clipFor(project, elementClipIds, 'sub')
    expect(sub.layout?.anchorTo?.clip).toBe(elementClipIds.title)
    expect(sub.layout?.anchorTo?.gap).toBe(8)
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0)
  })

  it('rewrites layout.fitTo.element (shapes only) to the real clip id', () => {
    const spec = baseSpec([
      { id: 'label', kind: 'text', text: 'Label', at: 0, duration: 2 },
      { id: 'pill', kind: 'shape', shape: 'rect', at: 0, duration: 2, layer: -1, layout: { fitTo: { element: 'label', padding: 6 } } },
    ])
    const { project, elementClipIds } = compileVideoSpec(spec)
    const pill = clipFor(project, elementClipIds, 'pill')
    expect(pill.layout?.fitTo?.clip).toBe(elementClipIds.label)
  })

  it('rewrites clip("element id") inside an expression source to clip("clip id")', () => {
    const spec = baseSpec([
      { id: 'driver', kind: 'shape', shape: 'rect', at: 0, duration: 2 },
      { id: 'follower', kind: 'shape', shape: 'rect', at: 0, duration: 2, layer: 1, expressions: [{ channel: 'x', source: 'clip("driver").x' }] },
    ])
    const { project, elementClipIds } = compileVideoSpec(spec)
    const follower = clipFor(project, elementClipIds, 'follower')
    const track = follower.keyframes?.channels.x
    expect(track?.source).toEqual({ kind: 'expression', source: `clip("${elementClipIds.driver}").x` })
  })

  it('a reference to an element that does not exist is an error issue, and the field is dropped (not left dangling)', () => {
    const spec = baseSpec([{ id: 't', kind: 'text', text: 'Hi', at: 0, duration: 2, layout: { anchorTo: { element: 'ghost', edge: 'bottom' } } }])
    const { project, elementClipIds, issues } = compileVideoSpec(spec)
    const t = clipFor(project, elementClipIds, 't')
    expect(t.layout?.anchorTo).toBeUndefined()
    expect(issues.some((i) => i.severity === 'error' && i.code === 'bad-reference')).toBe(true)
  })

  it('a reference into a DIFFERENT compound (a different level) is an error issue — layout resolves per level', () => {
    const spec = baseSpec([
      { id: 'outer', kind: 'text', text: 'Outer', at: 0, duration: 2 },
      {
        id: 'g',
        kind: 'group',
        at: 0,
        duration: 2,
        layer: 1,
        children: [{ id: 'inner', kind: 'shape', shape: 'rect', at: 0, duration: 2, layout: { anchorTo: { element: 'outer', edge: 'bottom' } } }],
      },
    ])
    const { issues } = compileVideoSpec(spec)
    expect(issues.some((i) => i.code === 'bad-reference')).toBe(true)
  })
})

describe('unknown font / preset / icon / channel -> issue, element kept, nothing thrown', () => {
  it('an unknown font, motion preset, icon and keyframe channel each become an issue and every element still compiles to a clip', () => {
    const spec = baseSpec([
      { id: 't', kind: 'text', text: 'Hi', at: 0, duration: 2, font: 'not-a-real-font' },
      { id: 's', kind: 'shape', shape: 'rect', at: 0, duration: 2, layer: 1, enter: 'not-a-real-preset' },
      { id: 'i', kind: 'icon', icon: 'not-a-real-icon', at: 0, duration: 2, layer: 2 },
      { id: 'x', kind: 'shape', shape: 'rect', at: 0, duration: 2, layer: 3, keys: [{ channel: 'not-a-real-channel', at: 0, value: 1 }] },
    ])
    const { project, issues } = compileVideoSpec(spec)
    expect(allClips(project)).toHaveLength(4)
    expect(issues.some((i) => i.code === 'unknown-font')).toBe(true)
    expect(issues.some((i) => i.code === 'unknown-preset')).toBe(true)
    expect(issues.some((i) => i.code === 'unknown-icon')).toBe(true)
    expect(issues.some((i) => i.code === 'unknown-channel')).toBe(true)
  })

  it('the badly-icon-named element still becomes a plain circle badge, not nothing', () => {
    const spec = baseSpec([{ id: 'i', kind: 'icon', icon: 'not-a-real-icon', at: 0, duration: 2 }])
    const { project, elementClipIds } = compileVideoSpec(spec)
    const clip = clipFor(project, elementClipIds, 'i')
    expect(clip.type).toBe('shape')
    expect(clip.shapeKind).toBe('circle')
  })
})

describe('expressions cannot drive `draw`', () => {
  it('an expression naming "draw" is an error issue and is never written', () => {
    const spec = baseSpec([{ id: 's', kind: 'shape', shape: 'rect', at: 0, duration: 2, expressions: [{ channel: 'draw', source: 'value' }] }])
    const { project, elementClipIds, issues } = compileVideoSpec(spec)
    expect(issues.some((i) => i.severity === 'error' && i.code === 'expression-not-allowed')).toBe(true)
    const clip = clipFor(project, elementClipIds, 's')
    expect(clip.keyframes?.channels.draw?.source.kind).not.toBe('expression')
  })
})

describe('spans + reveal together', () => {
  it('pushes a warn issue — the painter ignores spans while a reveal animator runs', () => {
    const spec = baseSpec([
      { id: 't', kind: 'text', text: 'Hi there', at: 0, duration: 2, spans: [{ start: 0, end: 2 }], reveal: { preset: 'fade' } },
    ])
    const { issues } = compileVideoSpec(spec)
    expect(issues.some((i) => i.severity === 'warn' && i.code === 'spans-with-reveal')).toBe(true)
  })

  it('neither spans nor reveal alone triggers the warning', () => {
    const spansOnly = compileVideoSpec(baseSpec([{ id: 't', kind: 'text', text: 'Hi', at: 0, duration: 2, spans: [{ start: 0, end: 1 }] }]))
    const revealOnly = compileVideoSpec(baseSpec([{ id: 't', kind: 'text', text: 'Hi', at: 0, duration: 2, reveal: { preset: 'fade' } }]))
    expect(spansOnly.issues.some((i) => i.code === 'spans-with-reveal')).toBe(false)
    expect(revealOnly.issues.some((i) => i.code === 'spans-with-reveal')).toBe(false)
  })
})

describe('compound (group) length', () => {
  it("a compound clip's duration is the GROUP's own authored duration, regardless of its children's span", () => {
    const spec = baseSpec([
      {
        id: 'g',
        kind: 'group',
        at: 0,
        duration: 3, // 90 frames at 30fps
        children: [{ id: 'inner', kind: 'text', text: 'Hi', at: 0, duration: 1 }], // only 30 frames
      },
    ])
    const { project, elementClipIds } = compileVideoSpec(spec)
    const compound = clipFor(project, elementClipIds, 'g')
    expect(compound.type).toBe('compound')
    expect(compound.durationFrames).toBe(90)
    expect(compound.sourceDurationFrames).toBe(90)
    expect(compound.assetFrames).toBe(90)
  })

  it('the child project is fps- and stage-matched to the parent', () => {
    const spec = baseSpec([{ id: 'g', kind: 'group', at: 0, duration: 2, children: [{ id: 'inner', kind: 'shape', shape: 'rect', at: 0, duration: 2 }] }])
    const { project, elementClipIds } = compileVideoSpec(spec)
    const compound = clipFor(project, elementClipIds, 'g')
    expect(compound.compound?.project.fps).toBe(project.fps)
    expect(compound.compound?.project.stage).toEqual(project.stage)
  })
})

describe('deterministic ids', () => {
  it('two compiles of one spec with the same seed produce byte-identical documents', () => {
    const spec = baseSpec([
      { id: 't', kind: 'text', text: 'Hi', at: 0, duration: 2 },
      { id: 's', kind: 'shape', shape: 'rect', at: 0, duration: 2, layer: 1, keys: [{ channel: 'opacity', at: 0, value: 0.5 }] },
    ])
    const a = compileVideoSpec(spec, { seed: 42 })
    const b = compileVideoSpec(spec, { seed: 42 })
    expect(a.project).toEqual(b.project)
    expect(a.elementClipIds).toEqual(b.elementClipIds)
  })

  it('two different seeds produce different ids', () => {
    const spec = baseSpec([{ id: 't', kind: 'text', text: 'Hi', at: 0, duration: 2 }])
    const a = compileVideoSpec(spec, { seed: 1 })
    const b = compileVideoSpec(spec, { seed: 2 })
    expect(a.project.id).not.toBe(b.project.id)
  })

  it('no seed at all still compiles (ids are simply not guaranteed to repeat)', () => {
    const spec = baseSpec([{ id: 't', kind: 'text', text: 'Hi', at: 0, duration: 2 }])
    expect(() => compileVideoSpec(spec)).not.toThrow()
  })
})

describe('readProjectDocument round-trip', () => {
  it('the compiled project is a legal document — the same reader "Import project from JSON" uses accepts it', () => {
    const spec = baseSpec(
      [
        { id: 'title', kind: 'text', text: 'Hello', at: 0, duration: 3, layer: 1 },
        { id: 'ring', kind: 'shape', shape: 'arc', at: 0, duration: 3, layer: 2, draw: { from: 0, to: 0.75 } },
        { id: 'badge', kind: 'icon', icon: 'check', at: 0, duration: 3, layer: 3 },
        {
          id: 'g',
          kind: 'group',
          at: 0,
          duration: 3,
          layer: 4,
          children: [{ id: 'inner-text', kind: 'text', text: 'Nested', at: 0, duration: 3 }],
        },
      ],
      { background: '#101010' },
    )
    const { project, issues } = compileVideoSpec(spec)
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0)
    expect(() => readProjectDocument(project)).not.toThrow()
    const read = readProjectDocument(project)
    expect(read.fps).toBe(30)
    expect(allClips(read).length).toBe(allClips(project).length)
  })
})

describe('layer -> order direction, and background at the back', () => {
  it("the background track's order is lower than every element's track order", () => {
    const spec = baseSpec(
      [
        { id: 'a', kind: 'shape', shape: 'rect', at: 0, duration: 2, layer: -5 },
        { id: 'b', kind: 'shape', shape: 'rect', at: 0, duration: 2, layer: 5 },
      ],
      { background: '#112233' },
    )
    const { project } = compileVideoSpec(spec)
    const bgTrack = project.tracks.find((t) => t.name === 'Background')!
    for (const t of project.tracks) {
      if (t.id === bgTrack.id) continue
      expect(bgTrack.order).toBeLessThan(t.order)
    }
  })

  it('a higher-layer element ends up on a higher-order track than a lower-layer element', () => {
    const spec = baseSpec([
      { id: 'a', kind: 'shape', shape: 'rect', at: 0, duration: 2, layer: 0 },
      { id: 'b', kind: 'shape', shape: 'rect', at: 0, duration: 2, layer: 9 },
    ])
    const { project, elementClipIds } = compileVideoSpec(spec)
    const a = clipFor(project, elementClipIds, 'a')
    const b = clipFor(project, elementClipIds, 'b')
    const orderOf = (clip: Clip) => project.tracks.find((t) => t.id === clip.trackId)!.order
    expect(orderOf(b)).toBeGreaterThan(orderOf(a))
  })
})

describe('overlap packing at the compile level', () => {
  it('two overlapping elements on one layer land on two different tracks (never one overlapping track)', () => {
    const spec = baseSpec([
      { id: 'a', kind: 'shape', shape: 'rect', at: 0, duration: 2, layer: 0 },
      { id: 'b', kind: 'shape', shape: 'rect', at: 1, duration: 2, layer: 0 },
    ])
    const { project, elementClipIds } = compileVideoSpec(spec)
    const a = clipFor(project, elementClipIds, 'a')
    const b = clipFor(project, elementClipIds, 'b')
    expect(a.trackId).not.toBe(b.trackId)
  })
})

describe('background', () => {
  it('compiles to a full-stage rect at the back for the whole spec duration', () => {
    const spec = baseSpec([{ id: 'a', kind: 'shape', shape: 'rect', at: 0, duration: 1 }], { duration: 4, background: '#ff0000' })
    const { project } = compileVideoSpec(spec)
    const bgTrack = project.tracks.find((t) => t.name === 'Background')!
    const bgClip = project.clips[bgTrack.id]![0]!
    expect(bgClip.durationFrames).toBe(4 * 30)
    expect(bgClip.shapeFill).toBe('#ff0000')
    expect(bgClip.transform?.scaleX).toBeCloseTo(project.stage.width / Math.min(project.stage.width, project.stage.height), 10)
  })

  it('a $token background resolves through design.colors', () => {
    const spec = baseSpec([{ id: 'a', kind: 'shape', shape: 'rect', at: 0, duration: 1 }], {
      background: '$accent',
      design: { colors: [{ name: 'accent', value: '#22c55e' }] },
    })
    const { project } = compileVideoSpec(spec)
    const bgTrack = project.tracks.find((t) => t.name === 'Background')!
    expect(project.clips[bgTrack.id]![0]!.shapeFill).toBe('#22c55e')
  })
})

describe('fontIds', () => {
  it('collects every bundled font a text element resolves', () => {
    const spec = baseSpec([{ id: 't', kind: 'text', text: 'Hi', at: 0, duration: 2, font: 'inter' }])
    const { fontIds } = compileVideoSpec(spec)
    expect(fontIds).toContain('inter')
  })
})

// ---------------------------------------------------------------------------
// AV-7: two gaps AV-1 declared untested.
// ---------------------------------------------------------------------------

describe('MAX_COMPOUND_DEPTH flattening', () => {
  it('a group nested five deep is flattened into its parent level with a warn issue, and the document still compiles', () => {
    // g1 -> g2 -> g3 -> g4 -> g5 -> leaf. g4's children are compiled at
    // depth 4 (== MAX_COMPOUND_DEPTH), so g5 — a group at THAT level — is the
    // one that gets flattened; its own child (leaf) is merged into g4's level.
    const spec = baseSpec([
      {
        id: 'g1',
        kind: 'group',
        at: 0,
        duration: 5,
        children: [
          {
            id: 'g2',
            kind: 'group',
            at: 0,
            duration: 5,
            children: [
              {
                id: 'g3',
                kind: 'group',
                at: 0,
                duration: 5,
                children: [
                  {
                    id: 'g4',
                    kind: 'group',
                    at: 0,
                    duration: 5,
                    children: [
                      {
                        id: 'g5',
                        kind: 'group',
                        at: 0,
                        duration: 5,
                        children: [{ id: 'leaf', kind: 'text', text: 'Deep', at: 0, duration: 5 }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ])
    const { project, elementClipIds, issues } = compileVideoSpec(spec)
    expect(issues.some((i) => i.severity === 'warn' && i.code === 'max-depth-flattened')).toBe(true)
    // Renderable: nothing thrown, the deepest leaf still compiled to a real clip, and the document reads back.
    expect(elementClipIds.leaf).toBeTruthy()
    const leafClip = allClipsDeep(project).find((c) => c.id === elementClipIds.leaf)
    expect(leafClip).toBeTruthy()
    expect(leafClip!.type).toBe('text')
    expect(() => readProjectDocument(project)).not.toThrow()
  })
})

describe('keyframe channel units — a keyed value converts the same way the static field does', () => {
  it('a rotation KEY of 90 compiles to PI/2 radians, same as the element\'s own `rotation: 90`', () => {
    const spec = baseSpec([
      { id: 'a', kind: 'shape', shape: 'rect', at: 0, duration: 2, keys: [{ channel: 'rotation', at: 0, value: 90 }] },
    ])
    const { project, elementClipIds } = compileVideoSpec(spec)
    const a = clipFor(project, elementClipIds, 'a')
    const key = a.keyframes?.channels.rotation?.keys[0]
    expect(key?.value).toBeCloseTo(Math.PI / 2, 10)
  })

  it("an element's own (non-keyed) `rotation: 90` still compiles to PI/2 radians (regression guard)", () => {
    const spec = baseSpec([{ id: 'a', kind: 'shape', shape: 'rect', at: 0, duration: 2, rotation: 90 }])
    const { project, elementClipIds } = compileVideoSpec(spec)
    const a = clipFor(project, elementClipIds, 'a')
    expect(a.transform?.rotation).toBeCloseTo(Math.PI / 2, 10)
  })

  it('a cornerRadius KEY in px converts to a 0..0.5 fraction of the stage\'s shorter side, same as the static `radius` field', () => {
    // 1080x1920 stage: shorter side is 1080. A 216px radius key -> 216/1080 = 0.2.
    const spec = baseSpec([
      { id: 'a', kind: 'shape', shape: 'rect', at: 0, duration: 2, keys: [{ channel: 'cornerRadius', at: 0, value: 216 }] },
    ])
    const { project, elementClipIds } = compileVideoSpec(spec)
    const a = clipFor(project, elementClipIds, 'a')
    const key = a.keyframes?.channels.cornerRadius?.keys[0]
    expect(key?.value).toBeCloseTo(0.2, 10)
  })

  it('an out-of-range cornerRadius key is clamped to 0.5 with a warn issue, not left as a raw px value', () => {
    const spec = baseSpec([
      { id: 'a', kind: 'shape', shape: 'rect', at: 0, duration: 2, keys: [{ channel: 'cornerRadius', at: 0, value: 999999 }] },
    ])
    const { project, elementClipIds, issues } = compileVideoSpec(spec)
    const a = clipFor(project, elementClipIds, 'a')
    const key = a.keyframes?.channels.cornerRadius?.keys[0]
    expect(key?.value).toBeCloseTo(0.5, 10)
    expect(issues.some((i) => i.severity === 'warn' && i.code === 'clamped' && i.path === 'elements[0].keys[0].value')).toBe(true)
  })

  it('an unrelated channel (opacity) is passed through unconverted', () => {
    const spec = baseSpec([{ id: 'a', kind: 'shape', shape: 'rect', at: 0, duration: 2, keys: [{ channel: 'opacity', at: 0, value: 0.5 }] }])
    const { project, elementClipIds } = compileVideoSpec(spec)
    const a = clipFor(project, elementClipIds, 'a')
    expect(a.keyframes?.channels.opacity?.keys[0]?.value).toBe(0.5)
  })
})

describe('layer ordering inside a compound — a group child obeys layer too', () => {
  it("a higher-layer child ends up on a higher-order track than a lower-layer child, within the SAME group's children", () => {
    const spec = baseSpec([
      {
        id: 'g',
        kind: 'group',
        at: 0,
        duration: 2,
        children: [
          { id: 'a', kind: 'shape', shape: 'rect', at: 0, duration: 2, layer: 0 },
          { id: 'b', kind: 'shape', shape: 'rect', at: 0, duration: 2, layer: 9 },
        ],
      },
    ])
    const { project, elementClipIds } = compileVideoSpec(spec)
    const compound = clipFor(project, elementClipIds, 'g')
    const childProject = compound.compound!.project
    const clipA = allClips(childProject).find((c) => c.id === elementClipIds.a)!
    const clipB = allClips(childProject).find((c) => c.id === elementClipIds.b)!
    const orderOf = (clip: Clip) => childProject.tracks.find((t) => t.id === clip.trackId)!.order
    expect(orderOf(clipB)).toBeGreaterThan(orderOf(clipA))
  })
})
