import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import { resolveTimeline } from '../resolver/resolveTimeline'
import { applyOps } from './apply'
import { elementFrameFor } from '../renderer/gpu/layers/elementFrame'
import type { TextMeasurer } from '../renderer/gpu/layers/textMeasure'
import type { EditorOp } from './types'

/**
 * `addLowerThird`, `addTitleCard` and `addCallout` write `layout` instead of
 * relying only on the fixed offsets (PV-P3b): with a measurer, a subtitle
 * sits under its title by the title's measured box whatever its length; the
 * fixed `xy` fallbacks stay for a consumer with no measurer.
 */

function fixture(): TimelineEngine {
  return new TimelineEngine({ fps: 30, stage: { width: 1920, height: 1080 } })
}

/** 10 stage px per character, from the ticket. */
const MEASURE: TextMeasurer = {
  measure: (_font, text) => ({ width: text.length * 10, ascent: 0, descent: 0 }),
}

describe('applyOps: layout (PV-P3b)', () => {
  it('addLowerThird: the subtitle anchors under the title\'s measured box, and falls back to the fixed offset without a measurer', () => {
    const engine = fixture()
    applyOps(engine, [
      { op: 'addLowerThird', title: 'Priya Rao', subtitle: 'Founder', at: 1, duration: 4 },
    ] as EditorOp[])
    const project = engine.getProject()
    const clips = Object.values(project.clips).flat()
    const title = clips.find((c) => c.content === 'Priya Rao')!
    const sub = clips.find((c) => c.content === 'Founder')!

    expect(sub.layout).toEqual({ anchorTo: { clip: title.id, edge: 'bottom', align: 'start', gap: 8 } })

    const scene = resolveTimeline(60, project, { measure: MEASURE })
    const subActive = scene.texts.find((t) => t.id === sub.id)!
    // Title box (511, 842.8, 130, 85.6); subtitle box 110 x 71.2 placed at
    // (511, 936.4) — the numbers the ticket worked out by hand.
    expect(subActive.transform!.x).toBeCloseTo(566 / 1920, 3)
    expect(subActive.transform!.y).toBeCloseTo(0.9, 2)

    // Without a measurer the layout pass cannot frame the text, so the
    // subtitle keeps its own authored (fixed-offset) transform.
    const sceneNoMeasure = resolveTimeline(60, project)
    const subNoMeasure = sceneNoMeasure.texts.find((t) => t.id === sub.id)!
    expect(subNoMeasure.transform!.y).toBeCloseTo(0.895, 3)
  })

  it('addLowerThird without a subtitle: the title carries no layout', () => {
    const engine = fixture()
    applyOps(engine, [{ op: 'addLowerThird', title: 'Priya Rao', at: 1, duration: 4 } as EditorOp])
    const project = engine.getProject()
    const title = Object.values(project.clips).flat().find((c) => c.content === 'Priya Rao')!
    expect(title.layout).toBeUndefined()
  })

  it('addTitleCard: the subtitle sits below the title by its measured height plus 16px, sharing its centre', () => {
    const engine = fixture()
    applyOps(engine, [
      { op: 'addTitleCard', title: 'Day one', subtitle: 'Episode 1', at: 0, duration: 3 },
    ] as EditorOp[])
    const project = engine.getProject()
    const clips = Object.values(project.clips).flat()
    const title = clips.find((c) => c.content === 'Day one')!
    const sub = clips.find((c) => c.content === 'Episode 1')!
    expect(sub.layout).toEqual({ anchorTo: { clip: title.id, edge: 'bottom', align: 'center', gap: 16 } })

    const stage = project.stage
    const scene = resolveTimeline(45, project, { measure: MEASURE })
    const titleActive = scene.texts.find((t) => t.id === title.id)!
    const subActive = scene.texts.find((t) => t.id === sub.id)!
    const titleFrame = elementFrameFor(titleActive, stage, MEASURE)!
    const subFrame = elementFrameFor(subActive, stage, MEASURE)!

    expect(subFrame.y).toBeCloseTo(titleFrame.y + titleFrame.height + 16, 3)
    expect(subFrame.x + subFrame.width / 2).toBeCloseTo(titleFrame.x + titleFrame.width / 2, 3)
  })

  it('addCallout: a region keeps the callout pinned to that corner regardless of its box', () => {
    const engine = fixture()
    applyOps(engine, [{ op: 'addCallout', text: 'Fact', at: 0, duration: 2, region: 'top-left' } as EditorOp])
    const project = engine.getProject()
    const clip = Object.values(project.clips).flat().find((c) => c.content === 'Fact')!
    expect(clip.layout).toEqual({ region: 'top-left' })

    const scene = resolveTimeline(30, project, { measure: MEASURE })
    const active = scene.texts.find((t) => t.id === clip.id)!
    const frame = elementFrameFor(active, project.stage, MEASURE)!
    expect(frame.x).toBeCloseTo(96, 0)
    expect(frame.y).toBeCloseTo(54, 0)
  })

  it('addCallout without a region: the clip carries no layout', () => {
    const engine = fixture()
    applyOps(engine, [{ op: 'addCallout', text: 'Fact', at: 0, duration: 2 } as EditorOp])
    const project = engine.getProject()
    const clip = Object.values(project.clips).flat().find((c) => c.content === 'Fact')!
    expect(clip.layout).toBeUndefined()
  })
})
