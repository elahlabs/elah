/**
 * AGT-4b: the cheap op gaps. removeTransition, setMarker, linkClips/unlinkClips, renameClip, removeEffect,
 * setInOut and setTrack each go through sanitize -> apply -> describeOp, and the whole plan is ONE undo step.
 */
import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import { createEffect } from '../effects/registry'
import type { Project } from '../types'
import { sanitizeOps } from './sanitize'
import { applyOps } from './apply'
import { opDescriber } from './describeOp'
import { EDITOR_OP_NAMES, type EditorOp } from './types'

function fixture() {
  const engine = new TimelineEngine({ fps: 30, stage: { width: 1920, height: 1080 } })
  const v = engine.addTrack('video', { name: 'Main' }).id
  const spare = engine.addTrack('elements', { name: 'Spare' }).id
  const intro = engine.addClip({ trackId: v, type: 'image', name: 'Intro', src: 'a.png', startFrame: 0, durationFrames: 150 }).id
  const shot2 = engine.addClip({ trackId: v, type: 'video', name: 'Shot 2', src: 'b.mp4', startFrame: 150, durationFrames: 150 }).id
  const shot3 = engine.addClip({ trackId: v, type: 'video', name: 'Shot 3', src: 'c.mp4', startFrame: 300, durationFrames: 150 }).id
  const t1 = engine.addTransition({ fromClipId: intro, toClipId: shot2, trackId: v, kind: 'fade', durationFrames: 30 })!.id
  const t2 = engine.addTransition({ fromClipId: shot2, toClipId: shot3, trackId: v, kind: 'wipe', durationFrames: 30 })!.id
  return { engine, v, spare, intro, shot2, shot3, t1, t2 }
}

/** Sanitize against the engine's project, then apply; the raw ops are what a model would send. */
function run(engine: TimelineEngine, raw: unknown[]) {
  const clean = sanitizeOps(raw, engine.getProject())
  const res = applyOps(engine, clean.ops)
  return { clean, res }
}

const project = (engine: TimelineEngine): Project => engine.getProject()

describe('the eight ops are in the vocabulary', () => {
  it('names them all', () => {
    for (const n of ['removeTransition', 'setMarker', 'linkClips', 'unlinkClips', 'renameClip', 'removeEffect', 'setInOut', 'setTrack']) {
      expect(EDITOR_OP_NAMES, n).toContain(n)
    }
  })
})

describe('removeTransition', () => {
  it('sanitize resolves a pair or an id, and refuses a pair with no transition', () => {
    const { engine, intro, shot2, shot3, t1 } = fixture()
    const { ops, dropped } = sanitizeOps(
      [
        { op: 'removeTransition', from: 'Intro', to: 'Shot 2' },
        { op: 'removeTransition', transition: t1 },
        { op: 'removeTransition', from: shot2 },
        { op: 'removeTransition', from: intro, to: shot3 },
        { op: 'removeTransition', transition: 'nope' },
        { op: 'removeTransition' },
      ],
      engine.getProject(),
    )
    expect(ops).toEqual([
      { op: 'removeTransition', from: intro, to: shot2 },
      { op: 'removeTransition', transition: t1 },
      { op: 'removeTransition', from: shot2 },
    ])
    expect(dropped.map((d) => d.index)).toEqual([3, 4, 5])
    expect(dropped[0]!.reason).toBe('no transition between "Intro" and "Shot 3"')
    expect(dropped[1]!.reason).toBe('no transition "nope"')
    expect(dropped[2]!.reason).toMatch(/needs a transition id/)
  })

  it('removing by {from,to} removes the right transition, and one undo restores it', () => {
    const { engine, shot2, shot3, t1, t2 } = fixture()
    const before = engine.getProject()
    const { res } = run(engine, [{ op: 'removeTransition', from: shot2, to: shot3 }])
    expect(res.skipped).toEqual([])
    expect(project(engine).transitions.map((t) => t.id)).toEqual([t1])
    expect(res.touched.changed.sort()).toEqual([shot2, shot3].sort())
    engine.undo()
    expect(engine.getProject()).toBe(before)
    expect(project(engine).transitions.map((t) => t.id)).toEqual([t1, t2])
  })

  it('removes by id, and by from alone (the transition that leaves it)', () => {
    const { engine, shot2, t1, t2 } = fixture()
    run(engine, [{ op: 'removeTransition', transition: t1 }])
    expect(project(engine).transitions.map((t) => t.id)).toEqual([t2])
    run(engine, [{ op: 'removeTransition', from: shot2 }])
    expect(project(engine).transitions).toEqual([])
  })

  it('skips a transition that is already gone', () => {
    const { engine, intro, shot2 } = fixture()
    const raw = [{ op: 'removeTransition', from: intro, to: shot2 }]
    const clean = sanitizeOps(raw, engine.getProject())
    engine.removeTransition(project(engine).transitions[0]!.id)
    const res = applyOps(engine, clean.ops)
    expect(res.applied).toEqual([])
    expect(res.skipped[0]!.reason).toBe('no transition between "Intro" and "Shot 2"')
  })

  it('describes the transition by its kind and the two clips', () => {
    const { engine, intro, shot2, shot3, t2 } = fixture()
    const say = opDescriber(engine.getProject())
    expect(say({ op: 'removeTransition', from: intro, to: shot2 })).toBe('Remove the cross-fade between “Intro” and “Shot 2”')
    expect(say({ op: 'removeTransition', transition: t2 })).toBe('Remove the wipe between “Shot 2” and “Shot 3”')
    expect(say({ op: 'removeTransition', from: shot3 })).toBe('Remove the transition leaving “Shot 3”')
  })
})

describe('setMarker', () => {
  function withMarkers() {
    const f = fixture()
    const a = f.engine.addMarker(30, { name: 'Beat' })
    const b = f.engine.addMarker(90, { name: 'Drop' })
    return { ...f, a, b }
  }

  it('sanitize takes an id or an exact name and refuses nonsense with a reason', () => {
    const { engine, a, b } = withMarkers()
    const { ops, dropped } = sanitizeOps(
      [
        { op: 'setMarker', marker: 'Beat', name: 'Hit', color: '#FF0000' },
        { op: 'setMarker', marker: b.id, at: 4, color: 'label-3' },
        { op: 'setMarker', marker: 'Nope', name: 'x' },
        { op: 'setMarker', marker: a.id },
        { op: 'setMarker', marker: a.id, remove: true, name: 'x' },
        { op: 'setMarker', marker: a.id, color: 'red' },
        { op: 'setMarker', marker: a.id, remove: true },
        { op: 'setMarker', marker: a.id, name: 'again' },
      ],
      engine.getProject(),
    )
    expect(ops).toEqual([
      { op: 'setMarker', marker: a.id, name: 'Hit', color: '#ff0000' },
      { op: 'setMarker', marker: b.id, at: 4, color: 'label-3' },
      { op: 'setMarker', marker: a.id, remove: true },
    ])
    expect(dropped.map((d) => d.index)).toEqual([2, 3, 4, 5, 7])
    expect(dropped[0]!.reason).toBe('no marker "Nope"')
    expect(dropped[1]!.reason).toMatch(/nothing to change/)
    expect(dropped[2]!.reason).toMatch(/do not combine/)
    expect(dropped[3]!.reason).toMatch(/#rrggbb or label-1 to label-8/)
    expect(dropped[4]!.reason).toMatch(/removed earlier in the plan/)
  })

  it('renames, moves and recolours a marker in one undo step; remove deletes it', () => {
    const { engine, a, b } = withMarkers()
    const before = engine.getProject()
    const { res } = run(engine, [
      { op: 'setMarker', marker: a.id, name: 'Hit', at: 2, color: '#ff0000' },
      { op: 'setMarker', marker: 'Drop', remove: true },
    ])
    expect(res.skipped).toEqual([])
    expect(project(engine).markers).toEqual([{ id: a.id, frame: 60, name: 'Hit', color: '#ff0000' }])
    expect(b.id).not.toBe(a.id)
    engine.undo()
    expect(engine.getProject()).toBe(before)
    expect(project(engine).markers?.map((m) => m.name)).toEqual(['Beat', 'Drop'])
  })

  it('describes by the marker name, or its time when it has none', () => {
    const { engine, a } = withMarkers()
    const bare = engine.addMarker(60)
    const say = opDescriber(engine.getProject())
    expect(say({ op: 'setMarker', marker: a.id, name: 'Hit', at: 2 })).toBe('On marker “Beat”: rename it “Hit”, move it to 0:02')
    expect(say({ op: 'setMarker', marker: a.id, remove: true })).toBe('Remove marker “Beat”')
    expect(say({ op: 'setMarker', marker: bare.id, remove: true })).toBe('Remove the marker at 0:02')
  })
})

describe('linkClips and unlinkClips', () => {
  it('sanitize needs two distinct clips to link', () => {
    const { engine, intro, shot2 } = fixture()
    const { ops, dropped } = sanitizeOps(
      [
        { op: 'linkClips', clips: ['Intro', shot2] },
        { op: 'linkClips', clips: [intro] },
        { op: 'linkClips', clips: [intro, intro] },
        { op: 'linkClips', clips: ['ghost', intro] },
        { op: 'unlinkClips', clips: [] },
        { op: 'unlinkClips', clips: [intro] },
      ],
      engine.getProject(),
    )
    expect(ops).toEqual([
      { op: 'linkClips', clips: [intro, shot2] },
      { op: 'unlinkClips', clips: [intro] },
    ])
    expect(dropped.map((d) => d.index)).toEqual([1, 2, 3, 4])
    expect(dropped[0]!.reason).toBe('linkClips needs at least two clips')
    expect(dropped[2]!.reason).toBe('no clip "ghost" on the timeline')
  })

  it('links, then unlinks, each as one undo step', () => {
    const { engine, intro, shot2, shot3 } = fixture()
    const before = engine.getProject()
    const linked = run(engine, [{ op: 'linkClips', clips: [intro, shot2] }])
    expect(linked.res.skipped).toEqual([])
    const link = engine.findClip(intro)!.clip.linkId
    expect(link).toBeTruthy()
    expect(engine.findClip(shot2)!.clip.linkId).toBe(link)
    expect(engine.findClip(shot3)!.clip.linkId).toBeUndefined()
    const afterLink = engine.getProject()
    const unlinked = run(engine, [{ op: 'unlinkClips', clips: [intro] }])
    expect(unlinked.res.skipped).toEqual([])
    // A group left with one clip dissolves.
    expect(engine.findClip(intro)!.clip.linkId).toBeUndefined()
    expect(engine.findClip(shot2)!.clip.linkId).toBeUndefined()
    engine.undo()
    expect(engine.getProject()).toBe(afterLink)
    engine.undo()
    expect(engine.getProject()).toBe(before)
  })

  it('skips unlinking clips that were never linked', () => {
    const { engine, intro } = fixture()
    const { res } = run(engine, [{ op: 'unlinkClips', clips: [intro] }])
    expect(res.applied).toEqual([])
    expect(res.skipped[0]!.reason).toBe('none of those clips is linked')
  })

  it('describes both', () => {
    const { engine, intro, shot2, shot3 } = fixture()
    const say = opDescriber(engine.getProject())
    expect(say({ op: 'linkClips', clips: [intro, shot2] })).toBe('Link “Intro” and “Shot 2” so they move together')
    expect(say({ op: 'unlinkClips', clips: [intro, shot2, shot3] })).toBe('Unlink “Intro”, “Shot 2” and “Shot 3”')
  })
})

describe('renameClip', () => {
  it('sanitize trims to 80 characters and refuses an empty name', () => {
    const { engine, intro } = fixture()
    const { ops, dropped } = sanitizeOps(
      [
        { op: 'renameClip', clip: intro, name: `  ${'x'.repeat(120)}  ` },
        { op: 'renameClip', clip: intro, name: '   ' },
        { op: 'renameClip', clip: 'ghost', name: 'y' },
      ],
      engine.getProject(),
    )
    expect(ops).toEqual([{ op: 'renameClip', clip: intro, name: 'x'.repeat(80) }])
    expect(dropped.map((d) => d.index)).toEqual([1, 2])
    expect(dropped[0]!.reason).toBe('name is empty')
  })

  it('renames the clip; one undo puts the name back', () => {
    const { engine, intro } = fixture()
    const before = engine.getProject()
    const { res } = run(engine, [{ op: 'renameClip', clip: 'Intro', name: 'Opening' }])
    expect(res.skipped).toEqual([])
    expect(engine.findClip(intro)!.clip.name).toBe('Opening')
    expect(res.touched.changed).toEqual([intro])
    engine.undo()
    expect(engine.getProject()).toBe(before)
  })

  it('skips a rename to the same name, and describes the rename', () => {
    const { engine, intro } = fixture()
    const { res } = run(engine, [{ op: 'renameClip', clip: intro, name: 'Intro' }])
    expect(res.skipped[0]!.reason).toBe('"Intro" already has that name')
    expect(opDescriber(engine.getProject())({ op: 'renameClip', clip: intro, name: 'Opening' })).toBe('Rename “Intro” to “Opening”')
  })
})

describe('removeEffect', () => {
  function withEffects() {
    const f = fixture()
    const blur = createEffect('gaussianBlur')
    const glow = createEffect('bloom')
    const glow2 = createEffect('bloom')
    f.engine.updateClip(f.shot2, f.v, {
      effects: [blur, glow],
      keyframes: {
        channels: {
          [`fx.${blur.id}.radius` as const]: { source: { kind: 'keyframes' }, keys: [{ id: 'k1', frame: 0, value: 4, easing: 'linear' }] },
          [`fx.${glow.id}.intensity` as const]: { source: { kind: 'keyframes' }, keys: [{ id: 'k2', frame: 0, value: 1, easing: 'linear' }] },
        },
      },
    })
    f.engine.updateClip(f.shot3, f.v, { effects: [glow, glow2] })
    return { ...f, blur, glow, glow2 }
  }

  it('sanitize checks the effect against the clip and refuses an ambiguous kind', () => {
    const { engine, shot2, shot3, blur, glow2 } = withEffects()
    const { ops, dropped } = sanitizeOps(
      [
        { op: 'removeEffect', clip: shot2, effect: blur.id },
        { op: 'removeEffect', clip: shot2, effect: 'gaussianBlur' },
        { op: 'removeEffect', clip: shot3, effect: glow2.id },
        { op: 'removeEffect', clip: shot2, effect: 'vignette' },
        { op: 'removeEffect', clip: shot3, effect: 'bloom' },
        { op: 'removeEffect', clip: shot2 },
      ],
      engine.getProject(),
    )
    expect(ops.map((o) => (o as { effect: string }).effect)).toEqual([blur.id, 'gaussianBlur', glow2.id])
    expect(dropped.map((d) => d.index)).toEqual([3, 4, 5])
    expect(dropped[0]!.reason).toMatch(/^this clip has no "vignette" effect \(it has: gaussianBlur /)
    expect(dropped[1]!.reason).toMatch(/has 2 "bloom" effects \(ids: .+\); name one by id/)
    expect(dropped[2]!.reason).toBe('effect is empty')
  })

  it('removes exactly one effect, and only the keys that drove it', () => {
    const { engine, shot2, blur, glow } = withEffects()
    const before = engine.getProject()
    const { res } = run(engine, [{ op: 'removeEffect', clip: shot2, effect: blur.id }])
    expect(res.skipped).toEqual([])
    const clip = engine.findClip(shot2)!.clip
    expect(clip.effects?.map((e) => e.id)).toEqual([glow.id])
    expect(Object.keys(clip.keyframes!.channels)).toEqual([`fx.${glow.id}.intensity`])
    engine.undo()
    expect(engine.getProject()).toBe(before)
    expect(engine.findClip(shot2)!.clip.effects).toHaveLength(2)
  })

  it('removing the last effect leaves a clip with none, and a missing effect is skipped', () => {
    const { engine, shot2, blur, glow } = withEffects()
    run(engine, [
      { op: 'removeEffect', clip: shot2, effect: blur.id },
      { op: 'removeEffect', clip: shot2, effect: glow.id },
    ])
    const clip = engine.findClip(shot2)!.clip
    expect(clip.effects).toBeUndefined()
    expect(clip.keyframes).toBeUndefined()
    const again = applyOps(engine, [{ op: 'removeEffect', clip: shot2, effect: glow.id }])
    expect(again.skipped[0]!.reason).toBe(`"Shot 2" has no "${glow.id}" effect`)
  })

  it('describes the effect by its label', () => {
    const { engine, shot2, blur } = withEffects()
    expect(opDescriber(engine.getProject())({ op: 'removeEffect', clip: shot2, effect: blur.id })).toBe('Remove the gaussian blur effect from “Shot 2”')
  })
})

describe('setInOut', () => {
  it('sanitize needs a range, one end, or clear; and an out after the in', () => {
    const { engine } = fixture()
    const { ops, dropped } = sanitizeOps(
      [
        { op: 'setInOut', inSec: 1, outSec: '4' },
        { op: 'setInOut', inSec: 2, outSec: null },
        { op: 'setInOut', clear: true },
        { op: 'setInOut', inSec: 4, outSec: 4 },
        { op: 'setInOut', inSec: null, outSec: null },
        { op: 'setInOut', clear: true, inSec: 1 },
      ],
      engine.getProject(),
    )
    expect(ops).toEqual([
      { op: 'setInOut', inSec: 1, outSec: 4 },
      { op: 'setInOut', inSec: 2 },
      { op: 'setInOut', clear: true },
    ])
    expect(dropped.map((d) => d.index)).toEqual([3, 4, 5])
    expect(dropped[0]!.reason).toBe('outSec must be after inSec')
    expect(dropped[1]!.reason).toBe('give inSec, outSec or clear')
  })

  it('sets, moves one end, and clears the range; each is undoable', () => {
    const { engine } = fixture()
    const before = engine.getProject()
    expect(run(engine, [{ op: 'setInOut', inSec: 1, outSec: 4 }]).res.skipped).toEqual([])
    expect(project(engine).inOut).toEqual({ in: 30, out: 120 })
    expect(run(engine, [{ op: 'setInOut', outSec: 6 }]).res.skipped).toEqual([])
    expect(project(engine).inOut).toEqual({ in: 30, out: 180 })
    expect(run(engine, [{ op: 'setInOut', clear: true }]).res.skipped).toEqual([])
    expect(project(engine).inOut).toBeUndefined()
    engine.undo()
    expect(project(engine).inOut).toEqual({ in: 30, out: 180 })
    engine.undo()
    engine.undo()
    expect(engine.getProject()).toBe(before)
  })

  it('skips a range that would end before it starts, and keeps the old one', () => {
    const { engine } = fixture()
    run(engine, [{ op: 'setInOut', inSec: 1, outSec: 4 }])
    const res = applyOps(engine, [{ op: 'setInOut', outSec: 0.5 }, { op: 'setInOut', clear: true }, { op: 'setInOut', clear: true }])
    expect(res.skipped.map((s) => s.index)).toEqual([0, 2])
    expect(res.skipped[0]!.reason).toMatch(/out must be after in/)
    expect(res.skipped[1]!.reason).toBe('there is no in/out range to clear')
  })

  it('describes the range', () => {
    const { engine } = fixture()
    const say = opDescriber(engine.getProject())
    expect(say({ op: 'setInOut', inSec: 1, outSec: 4 })).toBe('Set the in/out range from 0:01 to 0:04')
    expect(say({ op: 'setInOut', inSec: 2 })).toBe('Set the in point at 0:02')
    expect(say({ op: 'setInOut', outSec: 5 })).toBe('Set the out point at 0:05')
    expect(say({ op: 'setInOut', clear: true })).toBe('Clear the in/out range')
  })
})

describe('setTrack', () => {
  it('sanitize resolves a track by id or name; removing one with clips is refused', () => {
    const { engine, v, spare } = fixture()
    const { ops, dropped } = sanitizeOps(
      [
        { op: 'setTrack', track: 'Main', name: 'A-roll', locked: true },
        { op: 'setTrack', track: spare, hidden: true, muted: false },
        { op: 'setTrack', track: 'Spare', remove: true },
        { op: 'setTrack', track: v, remove: true },
        { op: 'setTrack', track: 'Nope', name: 'x' },
        { op: 'setTrack', track: v },
        { op: 'setTrack', track: v, remove: true, name: 'x' },
        { op: 'setTrack', track: 'Spare', locked: true },
      ],
      engine.getProject(),
    )
    expect(ops).toEqual([
      { op: 'setTrack', track: v, name: 'A-roll', locked: true },
      { op: 'setTrack', track: spare, hidden: true, muted: false },
      { op: 'setTrack', track: spare, remove: true },
    ])
    expect(dropped.map((d) => d.index)).toEqual([3, 4, 5, 6, 7])
    expect(dropped[0]!.reason).toBe('track has clips')
    expect(dropped[1]!.reason).toBe('no track "Nope"')
    expect(dropped[2]!.reason).toMatch(/nothing to change/)
    expect(dropped[3]!.reason).toMatch(/do not combine/)
    expect(dropped[4]!.reason).toMatch(/removed earlier in the plan/)
  })

  it('refuses to remove a protected track', () => {
    const { engine } = fixture()
    const guarded = engine.addTrack('audio', { name: 'Guard', protected: true }).id
    const { ops, dropped } = sanitizeOps([{ op: 'setTrack', track: guarded, remove: true }], engine.getProject())
    expect(ops).toEqual([])
    expect(dropped[0]!.reason).toBe('track "Guard" is protected and cannot be removed')
  })

  it('renames, locks, hides and mutes; one undo restores the lane', () => {
    const { engine, v } = fixture()
    const before = engine.getProject()
    const { res } = run(engine, [{ op: 'setTrack', track: 'Main', name: 'A-roll', locked: true, hidden: true, muted: true }])
    expect(res.skipped).toEqual([])
    expect(project(engine).tracks.find((t) => t.id === v)).toMatchObject({ name: 'A-roll', locked: true, disabled: true, muted: true })
    engine.undo()
    expect(engine.getProject()).toBe(before)
    expect(project(engine).tracks.find((t) => t.id === v)).toMatchObject({ name: 'Main', locked: false, disabled: false, muted: false })
  })

  it('removes an empty track and one undo brings it back', () => {
    const { engine, spare } = fixture()
    const before = engine.getProject()
    const { res } = run(engine, [{ op: 'setTrack', track: 'Spare', remove: true }])
    expect(res.skipped).toEqual([])
    expect(project(engine).tracks.some((t) => t.id === spare)).toBe(false)
    engine.undo()
    expect(engine.getProject()).toBe(before)
  })

  it('apply refuses a non-empty track even if sanitize was bypassed', () => {
    const { engine, v } = fixture()
    const res = applyOps(engine, [{ op: 'setTrack', track: v, remove: true }])
    expect(res.applied).toEqual([])
    expect(res.skipped[0]!.reason).toBe('track has clips')
    expect(Object.values(project(engine).clips).flat()).toHaveLength(3)
  })

  it('describes each form', () => {
    const { engine, v, spare } = fixture()
    const say = opDescriber(engine.getProject())
    expect(say({ op: 'setTrack', track: v, name: 'A-roll', locked: true, hidden: false })).toBe('Track “Main”: rename it “A-roll”, lock it, show it')
    expect(say({ op: 'setTrack', track: v, muted: true })).toBe('Track “Main”: mute it')
    expect(say({ op: 'setTrack', track: spare, remove: true })).toBe('Remove the empty track “Spare”')
  })
})

describe('a plan mixing new and old ops', () => {
  it('applies as ONE undo step and one undo restores everything', () => {
    const { engine, intro, shot2, shot3 } = fixture()
    engine.addMarker(30, { name: 'Beat' })
    const before = engine.getProject()
    const raw: unknown[] = [
      { op: 'removeTransition', from: 'Intro', to: 'Shot 2' },
      { op: 'addText', text: 'Hello', at: 1, duration: 2 },
      { op: 'renameClip', clip: shot3, name: 'Finale' },
      { op: 'setMarker', marker: 'Beat', name: 'Hit' },
      { op: 'linkClips', clips: [intro, shot2] },
      { op: 'setInOut', inSec: 1, outSec: 4 },
      { op: 'setTrack', track: 'Spare', name: 'Extras' },
    ]
    const clean = sanitizeOps(raw, engine.getProject())
    expect(clean.dropped).toEqual([])
    const res = applyOps(engine, clean.ops as EditorOp[], { description: 'Tidy up' })
    expect(res.skipped).toEqual([])
    expect(res.applied).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(engine.lastHistoryDescription()).toBe('Tidy up')
    expect(project(engine).transitions).toHaveLength(1)
    expect(engine.findClip(shot3)!.clip.name).toBe('Finale')
    expect(project(engine).markers![0]!.name).toBe('Hit')
    expect(project(engine).inOut).toEqual({ in: 30, out: 120 })
    expect(project(engine).tracks.some((t) => t.name === 'Extras')).toBe(true)
    // One undo step for the whole plan.
    engine.undo()
    expect(engine.getProject()).toBe(before)
  })
})
