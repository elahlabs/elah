import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import type { Clip, Project } from '../types'
import { buildVideo } from './build'
import { COMPONENT_REGISTRY } from './components'
import { COMPONENT_SAMPLES, componentSample } from './components/componentSamples'
import { COMPONENT_NAMES, type AuthoredSpec } from './components/types'
import { expandInstance, reconcileCompound } from './instance'
import { insertComponentInstance } from './insertInstance'

/**
 * EG-P5: one component laid on a live timeline as an editable instance.
 * Each test names the line it protects; mutation proofs are in the ticket.
 */

const SEED = 11

function engineWithContent(stage = { width: 1080, height: 1920 }): { engine: TimelineEngine; video: string } {
  const engine = new TimelineEngine({ fps: 30, stage })
  const video = engine.addTrack('video').id
  engine.addClip({ trackId: video, type: 'image', name: 'Interview', src: 'a.png', startFrame: 0, durationFrames: 300 })
  return { engine, video }
}

const allClips = (p: Project): Clip[] => Object.values(p.clips).flat()

describe('insertComponentInstance', () => {
  it('lands at frame N on a NEW track, stamps component and partId, leaves existing clips identical', () => {
    const { engine } = engineWithContent()
    const before = engine.getProject()
    const clipsBefore = structuredClone(before.clips)
    const tracksBefore = structuredClone(before.tracks)

    const sample = componentSample('chip-cloud', 'gal-chip-cloud')
    const out = insertComponentInstance(engine, sample, { atFrame: 97, seed: SEED })
    expect(out.ok).toBe(true)
    if (!out.ok) return

    const after = engine.getProject()
    const clip = allClips(after).find((c) => c.id === out.clipId)!
    expect(clip.startFrame).toBe(97)
    expect(clip.type).toBe('compound')
    expect(clip.component?.name).toBe('chip-cloud')
    expect(clip.component?.seed).toBe(SEED)
    expect(clip.partId).toBe('gal-chip-cloud')
    // Children carry partIds scoped to the component.
    const kids = Object.values(clip.compound!.project.clips).flat()
    expect(kids.length).toBeGreaterThan(3)
    expect(kids.every((k) => typeof k.partId === 'string' && k.partId.startsWith('gal-chip-cloud-'))).toBe(true)

    // A new elements track, above the existing one.
    expect(tracksBefore.some((t) => t.id === out.trackId)).toBe(false)
    const track = after.tracks.find((t) => t.id === out.trackId)!
    expect(track.kind).toBe('elements')
    expect(track.order).toBeGreaterThan(Math.max(...tracksBefore.map((t) => t.order)))

    // Existing tracks and clips are untouched.
    // Exactly one track and one clip were added: no ambient layer, no camera helper.
    expect(after.tracks).toHaveLength(tracksBefore.length + 1)
    expect(allClips(after)).toHaveLength(allClips(before).length + 1)
    for (const t of tracksBefore) expect(after.tracks.find((x) => x.id === t.id)).toEqual(t)
    for (const [trackId, list] of Object.entries(clipsBefore)) expect(after.clips[trackId]).toEqual(list)
    expect(after.stage).toEqual(before.stage)
    expect(out.result.range).toEqual({ startFrame: 97, endFrame: 97 + clip.durationFrames })
  })

  it('is ONE undo step: a single undo() restores the exact prior project', () => {
    const { engine } = engineWithContent()
    const before = engine.getProject()
    const out = insertComponentInstance(engine, componentSample('kinetic-title', 'gal-title'), { atFrame: 30, seed: SEED })
    expect(out.ok).toBe(true)
    expect(engine.getProject()).not.toBe(before)
    engine.undo()
    expect(engine.getProject()).toBe(before)
  })

  it('never changes the stage, even on an empty timeline with a different aspect', () => {
    for (const stage of [{ width: 1920, height: 1080 }, { width: 1080, height: 1080 }, { width: 720, height: 1280 }]) {
      const empty = new TimelineEngine({ fps: 30, stage })
      expect(insertComponentInstance(empty, componentSample('big-number', 'n'), { atFrame: 0, seed: SEED }).ok).toBe(true)
      expect(empty.getProject().stage).toEqual(stage)

      const { engine } = engineWithContent(stage)
      expect(insertComponentInstance(engine, componentSample('big-number', 'n'), { atFrame: 12, seed: SEED }).ok).toBe(true)
      expect(engine.getProject().stage).toEqual(stage)
    }
  })

  it('does not write Project.authored, and reads its design tokens and energy', () => {
    const { engine } = engineWithContent()
    const authored = {
      v: 1 as const,
      spec: {
        format: { width: 1080, height: 1920, fps: 30 },
        duration: 20,
        design: { colors: [{ name: 'accent', value: '#ff3366' }] },
        motion: { energy: 'bold' },
        elements: [],
      },
      seed: 3,
      createdAt: '2026-10-07T00:00:00.000Z',
    }
    engine.setAuthored(authored)
    const out = insertComponentInstance(engine, componentSample('chip-cloud', 'c'), { atFrame: 0, seed: SEED })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(engine.getProject().authored).toEqual(authored)
    const clip = engine.findClip(out.clipId)!.clip
    expect(clip.component?.design?.colors).toEqual([{ name: 'accent', value: '#ff3366' }])
    expect(clip.component?.style.energy).toBe('bold')
  })

  it('a style energy that differs from the piece becomes the component energy', () => {
    const { engine } = engineWithContent()
    const out = insertComponentInstance(engine, componentSample('chip-cloud', 'c'), { atFrame: 0, seed: SEED, style: { energy: 'calm' } })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(engine.findClip(out.clipId)!.clip.component?.style.energy).toBe('calm')
  })

  it('an unknown component or a bad frame writes nothing', () => {
    const { engine } = engineWithContent()
    const before = engine.getProject()
    const bogus = { ...componentSample('chip-cloud', 'x'), component: 'not-a-component' }
    expect(insertComponentInstance(engine, bogus, { atFrame: 0, seed: SEED })).toMatchObject({ ok: false, reason: 'unknown-component' })
    expect(insertComponentInstance(engine, componentSample('chip-cloud', 'x'), { atFrame: -4, seed: SEED })).toMatchObject({
      ok: false,
      reason: 'invalid-frame',
    })
    expect(engine.getProject()).toBe(before)
  })

  it('the stored child equals the EG-P2 baseline: an edit after insert reports nothing as hand-edited', () => {
    const { engine } = engineWithContent()
    const out = insertComponentInstance(engine, componentSample('kinetic-title', 'gal-title', 0), { atFrame: 0, seed: SEED })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const clip = engine.findClip(out.clipId)!.clip
    // A graphic at frame 0 still gets its own arrival and exit: polish must not see it as spanning the piece.
    expect(Object.keys(clip.keyframes?.channels ?? {})).toContain('opacity')
    const child = clip.compound!.project
    const ctx = { format: { width: child.stage.width, height: child.stage.height, fps: child.fps } }
    const baseline = expandInstance(clip.component!, ctx)
    const incoming = expandInstance(clip.component!, ctx, { text: 'A different headline entirely' })
    expect(baseline.ok && incoming.ok).toBe(true)
    if (!baseline.ok || !incoming.ok) return
    const merged = reconcileCompound(child, baseline.child, incoming.child)
    // Nothing the insert wrote reads as a user edit, so every changed field re-flowed.
    expect(merged.report.kept).toEqual([])
    expect(merged.report.reflowed.length).toBeGreaterThan(0)
  })

  it('stacks: two inserts at the same frame land on two different new tracks', () => {
    const { engine } = engineWithContent()
    const a = insertComponentInstance(engine, componentSample('chip-cloud', 'a'), { atFrame: 40, seed: 1 })
    const b = insertComponentInstance(engine, componentSample('checklist', 'b'), { atFrame: 40, seed: 2 })
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    expect(a.trackId).not.toBe(b.trackId)
  })
})

describe('component samples', () => {
  it('there is a sample for every registered component', () => {
    expect(Object.keys(COMPONENT_SAMPLES).sort()).toEqual([...COMPONENT_NAMES].sort())
    expect(COMPONENT_NAMES).toHaveLength(17)
  })

  it.each(COMPONENT_NAMES)('%s: the sample expands with zero error issues and respects its def bounds', (name) => {
    const def = COMPONENT_REGISTRY.get(name)!
    const sample = componentSample(name, `s-${name}`)
    if (def.items) {
      expect(sample.items?.length ?? 0).toBeGreaterThanOrEqual(def.items.min)
      expect(sample.items?.length ?? 0).toBeLessThanOrEqual(def.items.max)
    }
    // It carries real content, not just a name.
    expect(Boolean((sample.text ?? '').trim()) || (sample.items?.length ?? 0) > 0).toBe(true)
    expect(sample.duration).toBeGreaterThanOrEqual(def.duration.min)
    expect(sample.duration).toBeLessThanOrEqual(def.duration.max)

    const spec: AuthoredSpec = { format: { width: 1080, height: 1920, fps: 30 }, duration: 10, elements: [sample] }
    const built = buildVideo(spec, { seed: SEED })
    expect(built.issues.filter((i) => i.severity === 'error')).toEqual([])
    // The sample is not silently ignored: the component produced parts.
    const group = allClips(built.project).find((c) => c.component)!
    expect(Object.values(group.compound!.project.clips).flat().length).toBeGreaterThan(1)

    // And it inserts, on a portrait and a landscape stage.
    for (const stage of [{ width: 1080, height: 1920 }, { width: 1920, height: 1080 }]) {
      const { engine } = engineWithContent(stage)
      const out = insertComponentInstance(engine, sample, { atFrame: 5, seed: SEED })
      expect(out).toMatchObject({ ok: true })
    }
  })

  it('componentSample returns a fresh copy each call', () => {
    const a = componentSample('chip-cloud', 'a')
    a.items![0]!.text = 'mutated'
    expect(componentSample('chip-cloud', 'b').items![0]!.text).not.toBe('mutated')
    expect(COMPONENT_SAMPLES['chip-cloud'].items![0]!.text).not.toBe('mutated')
  })
})
