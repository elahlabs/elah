import { describe, expect, it } from 'vitest'
import { TimelineEngine } from './TimelineEngine'
import type { Clip, ClipComponentInstance, Project } from '../types'
import { buildVideo } from '../spec/build'
import { layProject } from '../spec/layProject'
import type { AuthoredSpec } from '../spec/components/types'

/**
 * EG-P2 engine half: a component instance's nested project and its
 * `component` record change together in ONE undo step, a refusal writes
 * nothing, and Detach deletes the `component` key (not sets it undefined).
 */

const SPEC: AuthoredSpec = {
  format: { width: 1080, height: 1920, fps: 30 },
  duration: 6,
  elements: [
    { id: 'cloud', kind: 'component', component: 'chip-cloud', at: 0, duration: 4.5, items: ['A', 'B', 'C', 'D'].map((text) => ({ text })) },
    { id: 'plain', kind: 'text', text: 'Not a component', size: 60, at: 0, duration: 2 },
  ],
}

function laid() {
  const engine = new TimelineEngine({ fps: 30, stage: { width: 1080, height: 1920 }, initialTracks: [] })
  layProject(engine, buildVideo(structuredClone(SPEC), { seed: 7 }).project)
  const all = (): Clip[] => Object.values(engine.getProject().clips).flat()
  const compound = () => all().find((c) => c.partId === 'cloud')!
  return { engine, all, compound }
}

/** A child that differs from the stored one, plus a record that says so. */
function edited(child: Project, component: ClipComponentInstance) {
  const nextChild = structuredClone(child)
  const first = Object.values(nextChild.clips).flat()[0]!
  first.name = 'changed by the test'
  const nextComponent: ClipComponentInstance = { ...component, input: { ...component.input, text: 'new intent' } }
  return { nextChild, nextComponent }
}

describe('TimelineEngine.updateCompoundInstance', () => {
  it('writes the child AND the component record, and one undo restores both', () => {
    const { engine, compound } = laid()
    const before = engine.getProject()
    const c = compound()
    const { nextChild, nextComponent } = edited(c.compound!.project, c.component!)

    const result = engine.updateCompoundInstance(c.id, nextChild, nextComponent, { expectedChild: c.compound!.project })
    expect(result.ok).toBe(true)
    const after = compound()
    expect(after.component).toEqual(nextComponent)
    expect(after.compound!.project).toEqual(nextChild)
    // Everything else on the clip is kept.
    expect(after.partId).toBe('cloud')
    expect(after.startFrame).toBe(c.startFrame)

    expect(engine.undo()).toBe(true)
    expect(engine.getProject()).toEqual(before)
    expect(compound().component).toEqual(c.component)
    expect(compound().compound!.project).toEqual(c.compound!.project)
  })

  it('clones the component record it is given', () => {
    const { engine, compound } = laid()
    const c = compound()
    const { nextChild, nextComponent } = edited(c.compound!.project, c.component!)
    engine.updateCompoundInstance(c.id, nextChild, nextComponent)
    ;(nextComponent.input as { text: string }).text = 'mutated afterwards'
    expect((compound().component!.input as { text: string }).text).toBe('new intent')
  })

  describe('every refusal writes neither the child nor the record', () => {
    function refuse(setup: (e: TimelineEngine, id: string) => void, code: string, mutate?: (child: Project) => Project) {
      const { engine, compound } = laid()
      const c = compound()
      setup(engine, c.id)
      const { nextChild, nextComponent } = edited(c.compound!.project, c.component!)
      const before = engine.getProject()
      const result = engine.updateCompoundInstance(c.id, mutate ? mutate(nextChild) : nextChild, nextComponent, {
        expectedChild: code === 'stale-child' ? { ...c.compound!.project, id: 'someone-else' } : undefined,
      })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe(code)
      expect(engine.getProject()).toBe(before) // same object: nothing was written, no history entry
    }

    it('stale-child', () => refuse(() => undefined, 'stale-child'))
    it('track-locked', () => refuse((e, id) => e.updateTrack(e.findClip(id)!.trackId, { locked: true }), 'track-locked'))
    it('track-disabled', () => refuse((e, id) => e.updateTrack(e.findClip(id)!.trackId, { disabled: true }), 'track-disabled'))
    it('fps-mismatch', () => refuse(() => undefined, 'fps-mismatch', (child) => ({ ...child, fps: 24 })))
    it('too-deep', () =>
      refuse(
        () => undefined,
        'too-deep',
        (child) => {
          let deep = child
          for (let i = 0; i < 4; i++) {
            const outer = new TimelineEngine({ fps: 30, stage: { width: 1080, height: 1920 } })
            const t = outer.addTrack('elements')
            outer.addClip({ type: 'compound', trackId: t.id, startFrame: 0, durationFrames: 30, compound: { project: deep } })
            deep = outer.getProject()
          }
          return deep
        },
      ))
    it('not-a-compound', () => {
      const { engine, all } = laid()
      const plain = all().find((c) => c.partId === 'plain')!
      const before = engine.getProject()
      const r = engine.updateCompoundInstance(plain.id, compoundChild(engine), { v: 1, name: 'x', input: {}, seed: 1, style: { energy: 'standard', camera: true, ambient: 'none', transition: 'cut' } })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.code).toBe('not-a-compound')
      expect(engine.getProject()).toBe(before)
    })
    it('clip-not-found', () => {
      const { engine, compound } = laid()
      const c = compound()
      const before = engine.getProject()
      const r = engine.updateCompoundInstance('nope', c.compound!.project, c.component!)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.code).toBe('clip-not-found')
      expect(engine.getProject()).toBe(before)
    })
  })
})

function compoundChild(engine: TimelineEngine): Project {
  return Object.values(engine.getProject().clips).flat().find((c) => c.compound)!.compound!.project
}

describe('TimelineEngine.detachComponent', () => {
  it('deletes the component key, leaves the compound and every part untouched, in one undo step', () => {
    const { engine, compound } = laid()
    const before = engine.getProject()
    const c = compound()
    expect(c.component).toBeDefined()

    const r = engine.detachComponent(c.id)
    expect(r.ok).toBe(true)
    const after = compound()
    expect('component' in after).toBe(false)
    expect(after.compound).toEqual(c.compound)
    expect(after.partId).toBe('cloud')
    const { component: _gone, ...rest } = c
    expect(after).toEqual(rest)
    // The rest of the project is untouched.
    expect(Object.values(engine.getProject().clips).flat().filter((x) => x.id !== c.id)).toEqual(
      Object.values(before.clips).flat().filter((x) => x.id !== c.id),
    )

    engine.undo()
    expect(engine.getProject()).toEqual(before)
    expect(compound().component).toEqual(c.component)
  })

  it('refuses a clip that is not an instance, is not a compound, is missing, or sits on a locked lane', () => {
    const { engine, all, compound } = laid()
    const c = compound()
    const plain = all().find((x) => x.partId === 'plain')!
    expect(engine.detachComponent(plain.id)).toMatchObject({ ok: false, error: { code: 'not-a-compound' } })
    expect(engine.detachComponent('nope')).toMatchObject({ ok: false, error: { code: 'clip-not-found' } })
    engine.updateTrack(c.trackId, { locked: true })
    const before = engine.getProject()
    expect(engine.detachComponent(c.id)).toMatchObject({ ok: false, error: { code: 'track-locked' } })
    expect(engine.getProject()).toBe(before)
    engine.updateTrack(c.trackId, { locked: false })
    expect(engine.detachComponent(c.id).ok).toBe(true)
    expect(engine.detachComponent(c.id)).toMatchObject({ ok: false, error: { code: 'no-component' } })
  })
})
