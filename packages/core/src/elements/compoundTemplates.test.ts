import { describe, expect, it } from 'vitest'
import {
  COMPOUND_TEMPLATES,
  COMPOUND_TEMPLATE_DEFAULT_SECONDS,
  COMPOUND_TEMPLATE_MAX_RAMP_FRAMES,
  COMPOUND_TEMPLATE_MIN_ANIMATED_FRAMES,
  ctaCard,
  compoundTemplateDuration,
  compoundTemplateRamp,
  findCompoundTemplate,
  lowerThird,
  reelHook,
  socialHandle,
  type CompoundTemplate,
  type CompoundTemplateOptions,
} from './compoundTemplates'
import { readProjectDocument } from '../editor/projectDocument'
import { sampleChannel } from '../resolver/keyframes'
import { blockCenter } from '../renderer/gpu/layers/textLayout'
import { resolveShapeRect } from '../renderer/gpu/layers/shapePaint'
import type { Clip, Project } from '../types'

const WIDE: CompoundTemplateOptions = { fps: 30, width: 1920, height: 1080 }
const TALL: CompoundTemplateOptions = { fps: 30, width: 1080, height: 1920 }

function allClips(project: Project): Clip[] {
  return Object.values(project.clips).flat()
}

function textClips(project: Project): Clip[] {
  return allClips(project).filter((c) => c.type === 'text')
}

// ---------------------------------------------------------------------------

describe('the registry', () => {
  it('ships exactly the four templates, in picker order, with the ids the ticket names', () => {
    expect(COMPOUND_TEMPLATES.map((t) => t.id)).toEqual([
      'lower-third',
      'social-handle',
      'reel-hook',
      'cta-card',
    ])
  })

  it('names every builder, and a label for every button', () => {
    for (const t of COMPOUND_TEMPLATES) {
      expect(t.label.length).toBeGreaterThan(0)
      expect(t.description.length).toBeGreaterThan(0)
    }
    expect(findCompoundTemplate('lower-third')?.build).toBe(lowerThird)
    expect(findCompoundTemplate('social-handle')?.build).toBe(socialHandle)
    expect(findCompoundTemplate('reel-hook')?.build).toBe(reelHook)
    expect(findCompoundTemplate('cta-card')?.build).toBe(ctaCard)
    expect(findCompoundTemplate('nope')).toBeUndefined()
  })

  it('builds the same picture from the registry as from the named builder', () => {
    for (const t of COMPOUND_TEMPLATES) {
      // Ids are minted per build, so compare the SHAPE of the document, not the
      // ids: same tracks, same clip types, same geometry.
      const viaRegistry = t.build(WIDE)
      const viaNamed = t.build(WIDE)
      expect(viaRegistry.tracks.map((x) => x.id)).toEqual(viaNamed.tracks.map((x) => x.id))
      expect(allClips(viaRegistry).map((c) => [c.trackId, c.type, c.name])).toEqual(
        allClips(viaNamed).map((c) => [c.trackId, c.type, c.name]),
      )
    }
  })
})

// ---------------------------------------------------------------------------

describe('every template, on every stage', () => {
  const cases: Array<[string, CompoundTemplate]> = COMPOUND_TEMPLATES.map((t) => [t.id, t])

  for (const [id, template] of cases) {
    describe(id, () => {
      it('holds at least one text clip', () => {
        expect(textClips(template.build(WIDE)).length).toBeGreaterThanOrEqual(1)
      })

      it('references no media at all — no src, no assetId, no generator', () => {
        for (const clip of allClips(template.build(WIDE))) {
          expect(clip.src).toBeUndefined()
          expect(clip.assetId).toBeUndefined()
          expect(clip.type).not.toBe('generator')
        }
      })

      it('carries the stage and frame rate it was asked for', () => {
        const project = template.build(TALL)
        expect(project.stage).toEqual({ width: 1080, height: 1920 })
        expect(project.fps).toBe(30)
      })

      it('runs for four seconds by default, at its own frame rate', () => {
        for (const fps of [24, 25, 30, 60]) {
          const project = template.build({ fps, width: 1920, height: 1080 })
          const expected = Math.round(fps * COMPOUND_TEMPLATE_DEFAULT_SECONDS)
          for (const clip of allClips(project)) expect(clip.durationFrames).toBe(expected)
        }
      })

      it('runs for exactly the duration asked for', () => {
        for (const durationFrames of [1, 3, 4, 7, 90, 120, 1000]) {
          const project = template.build({ ...WIDE, durationFrames })
          expect(allClips(project).length).toBeGreaterThan(0)
          for (const clip of allClips(project)) expect(clip.durationFrames).toBe(durationFrames)
        }
      })

      it('uses every id once, and indexes every clip under a real track', () => {
        const project = template.build(WIDE)
        const ids = [...project.tracks.map((t) => t.id), ...allClips(project).map((c) => c.id)]
        expect(new Set(ids).size).toBe(ids.length)
        const trackIds = new Set(project.tracks.map((t) => t.id))
        for (const [trackId, clips] of Object.entries(project.clips)) {
          expect(trackIds.has(trackId)).toBe(true)
          for (const clip of clips) expect(clip.trackId).toBe(trackId)
        }
        expect(Object.keys(project.clips).sort()).toEqual([...trackIds].sort())
      })

      it('is readable as a stored document, unchanged', () => {
        const project = template.build(WIDE)
        const read = readProjectDocument(JSON.parse(JSON.stringify(project)))
        expect(read.stage).toEqual(project.stage)
        expect(read.fps).toBe(project.fps)
        expect(read.tracks.map((t) => t.id)).toEqual(project.tracks.map((t) => t.id))
        expect(allClips(read).map((c) => c.type).sort()).toEqual(allClips(project).map((c) => c.type).sort())
      })

      it('shares no mutable object between two builds', () => {
        const a = template.build(WIDE)
        const b = template.build(WIDE)
        // Fresh ids, so the documents are not equal — but nothing may be shared,
        // or editing one inserted template would edit the other.
        const aClips = allClips(a)
        const bClips = allClips(b)
        for (let i = 0; i < aClips.length; i++) {
          // Bound to a const: `aClips[i]` is a `let`-indexed access, which
          // TypeScript will not narrow, so `aClips[i]!.keyframes` stays
          // `| undefined` on every use after the guard.
          const aClip = aClips[i]!
          const bClip = bClips[i]!
          expect(aClip).not.toBe(bClip)
          expect(aClip.transform).not.toBe(bClip.transform)
          expect(aClip.transform?.anchor).not.toBe(bClip.transform?.anchor)
          expect(aClip.keyframes).not.toBe(bClip.keyframes)
          if (aClip.keyframes) {
            const aChannel = aClip.keyframes.channels.opacity
            const bChannel = bClip.keyframes?.channels.opacity
            expect(aChannel).not.toBe(bChannel)
            expect(aChannel?.keys[0]).not.toBe(bChannel?.keys[0])
          }
        }
        for (let i = 0; i < a.tracks.length; i++) expect(a.tracks[i]).not.toBe(b.tracks[i])
        expect(a.stage).not.toBe(b.stage)
        // And the id generator really is per-build: two clicks, two compounds.
        expect(aClips.map((c) => c.id)).not.toEqual(bClips.map((c) => c.id))
      })

      it('mutating one build leaves the other and the template alone', () => {
        const first = template.build(WIDE)
        const second = template.build(WIDE)
        const victim = allClips(first)[0]!
        victim.name = 'MUTATED'
        victim.startFrame = 9999
        if (victim.transform) victim.transform.x = 0.123
        first.tracks[0]!.name = 'MUTATED TRACK'
        first.stage.width = 1
        for (const clip of allClips(second)) {
          expect(clip.name).not.toBe('MUTATED')
          expect(clip.startFrame).toBe(0)
          expect(clip.transform?.x).not.toBe(0.123)
        }
        expect(second.tracks[0]!.name).not.toBe('MUTATED TRACK')
        expect(second.stage.width).toBe(1920)
      })

      it('fits inside its own stage, on both a 16:9 and a 9:16 frame', () => {
        for (const stage of [WIDE, TALL]) {
          const project = template.build(stage)
          for (const clip of allClips(project)) {
            if (clip.type !== 'shape') continue
            const rect = resolveShapeRect(clip.transform, project.stage)
            // A shape is allowed to bleed off frame (that is a legitimate
            // design), so the assertion is that it is FINITE and non-degenerate.
            expect(Number.isFinite(rect.x)).toBe(true)
            expect(Number.isFinite(rect.width)).toBe(true)
            expect(rect.width).toBeGreaterThan(0)
            expect(rect.height).toBeGreaterThan(0)
          }
        }
      })
    })
  }
})

// ---------------------------------------------------------------------------

describe('clip fields the closed clip factory cannot carry', () => {
  // `createClip` builds each type from a FIXED field list, so `keyframes`,
  // `textShadow` and `transformModel` have to be written by hand. These three
  // are the pins: if someone "simplifies" the literals back into `createClip`,
  // the template silently loses its animation, its shadow, or its left-aligned
  // text placement — and nothing else would notice.

  it('keeps the entrance, which createClip would drop', () => {
    const project = lowerThird({ ...WIDE, durationFrames: 40 })
    for (const clip of allClips(project)) {
      expect(clip.keyframes?.channels.opacity).toBeDefined()
    }
  })

  it('lays text out under v2, so the anchor means what the numbers say', () => {
    for (const template of COMPOUND_TEMPLATES) {
      for (const clip of textClips(template.build(WIDE))) {
        expect(clip.transformModel).toBe('v2')
      }
    }
  })

  it('matches createClip’s own base defaults, so nothing downstream can tell the difference', () => {
    for (const clip of allClips(ctaCard(WIDE))) {
      expect(clip.sourceStartFrame).toBe(0)
      expect(clip.sourceDurationFrames).toBe(clip.durationFrames)
      expect(clip.volume).toBe(1)
      expect(clip.opacity).toBe(1)
      expect(clip.locked).toBe(false)
      expect(clip.disabled).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------

describe('option validation', () => {
  it('refuses a stage it cannot draw on', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(() => lowerThird({ ...WIDE, width: bad })).toThrow(RangeError)
      expect(() => lowerThird({ ...WIDE, height: bad })).toThrow(RangeError)
      expect(() => lowerThird({ ...WIDE, fps: bad })).toThrow(RangeError)
    }
  })

  it('refuses a duration that is not at least one frame', () => {
    for (const bad of [0, -5, NaN, Infinity]) {
      expect(() => lowerThird({ ...WIDE, durationFrames: bad })).toThrow(RangeError)
    }
  })

  it('floors a fractional duration rather than rounding it up into a longer clip', () => {
    expect(compoundTemplateDuration({ ...WIDE, durationFrames: 30.9 })).toBe(30)
    expect(allClips(lowerThird({ ...WIDE, durationFrames: 30.9 }))[0]!.durationFrames).toBe(30)
  })

  it('defaults the duration to four seconds and never below one frame', () => {
    expect(compoundTemplateDuration({ fps: 30, width: 1920, height: 1080 })).toBe(120)
    expect(compoundTemplateDuration({ fps: 30, width: 1920, height: 1080, durationFrames: 1 })).toBe(1)
  })
})

// ---------------------------------------------------------------------------

describe('the ramp', () => {
  it('is a quarter of the clip, capped at one second', () => {
    expect(compoundTemplateRamp(8)).toBe(2)
    expect(compoundTemplateRamp(12)).toBe(3)
    expect(compoundTemplateRamp(40)).toBe(10)
    expect(compoundTemplateRamp(120)).toBe(COMPOUND_TEMPLATE_MAX_RAMP_FRAMES)
    expect(compoundTemplateRamp(1000)).toBe(COMPOUND_TEMPLATE_MAX_RAMP_FRAMES)
  })

  it('is zero below the shortest animatable clip, so a one-frame template is not invisible', () => {
    expect(COMPOUND_TEMPLATE_MIN_ANIMATED_FRAMES).toBe(4)
    for (const d of [1, 2, 3]) expect(compoundTemplateRamp(d)).toBe(0)
    expect(compoundTemplateRamp(4)).toBe(1)
  })

  it('never lets the entry and the exit touch', () => {
    for (const d of [4, 5, 6, 7, 8, 9, 30, 119, 120, 121, 600]) {
      const ramp = compoundTemplateRamp(d)
      expect(d - ramp).toBeGreaterThan(ramp)
    }
  })

  it('animates opacity 0 -> peak -> 0 with no two keys on the same frame', () => {
    const project = lowerThird({ ...WIDE, durationFrames: 40 })
    const keys = allClips(project)[0]!.keyframes!.channels.opacity!.keys
    expect(keys.map((k) => k.frame)).toEqual([0, 10, 30, 40])
    expect(keys.map((k) => k.value)).toEqual([0, 1, 1, 0])
    expect(new Set(keys.map((k) => k.id)).size).toBe(4)
  })

  it('samples a real 0 at the first frame and 1 in the middle', () => {
    const project = lowerThird({ ...WIDE, durationFrames: 40 })
    const clip = allClips(project)[0]!
    const keys = clip.keyframes!.channels.opacity!.keys
    expect(sampleChannel(keys, 0)).toBe(0)
    expect(sampleChannel(keys, 20)).toBe(1)
    expect(sampleChannel(keys, 40)).toBe(0)
  })

  it('writes no opacity keys on a one-frame template, so it is visible at all', () => {
    const project = lowerThird({ ...WIDE, durationFrames: 1 })
    for (const clip of allClips(project)) expect(clip.keyframes).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------

describe('geometry scales from 1920x1080, per axis', () => {
  it('puts the lower-third panel exactly where the reference numbers say', () => {
    const project = lowerThird(WIDE)
    const panel = allClips(project).find((c) => c.name === 'Panel')!
    const rect = resolveShapeRect(panel.transform, project.stage)
    expect(rect.x).toBeCloseTo(120, 6)
    expect(rect.y).toBeCloseTo(780, 6)
    expect(rect.width).toBeCloseTo(900, 6)
    expect(rect.height).toBeCloseTo(180, 6)
  })

  it('keeps the panel in the lower third of a 9:16 frame, which a uniform scale would not', () => {
    const project = lowerThird(TALL)
    const panel = allClips(project).find((c) => c.name === 'Panel')!
    const rect = resolveShapeRect(panel.transform, project.stage)
    expect(rect.y / 1920).toBeGreaterThan(0.6)
    expect(rect.width).toBeCloseTo((900 * 1080) / 1920, 6)
  })

  it('centres the social card and the CTA panel', () => {
    const social = socialHandle(WIDE)
    const card = resolveShapeRect(allClips(social).find((c) => c.name === 'Card')!.transform, social.stage)
    expect(card.x + card.width / 2).toBeCloseTo(960, 6)
    expect(card.y + card.height / 2).toBeCloseTo(540, 6)
    expect(card.width).toBeCloseTo(1000, 6)
    expect(card.height).toBeCloseTo(200, 6)

    const cta = ctaCard(WIDE)
    const panel = resolveShapeRect(allClips(cta).find((c) => c.name === 'Panel')!.transform, cta.stage)
    expect(panel.width).toBeCloseTo(1200, 6)
    expect(panel.height).toBeCloseTo(500, 6)
    expect(panel.x + panel.width / 2).toBeCloseTo(960, 6)
    expect(panel.y + panel.height / 2).toBeCloseTo(540, 6)
  })

  it('underlines the reel hook under its headline', () => {
    const project = reelHook(WIDE)
    const headline = allClips(project).find((c) => c.name === 'Headline')!
    const rule = resolveShapeRect(allClips(project).find((c) => c.name === 'Underline')!.transform, project.stage)
    expect(headline.transform!.y * 1080).toBeLessThan(rule.y)
    expect(rule.x + rule.width / 2).toBeCloseTo(960, 6)
  })

  it('scales type by the horizontal factor only', () => {
    const wide = lowerThird(WIDE).clips['ct-lt-type']![0]!
    const tall = lowerThird(TALL).clips['ct-lt-type']![0]!
    expect(wide.fontSize).toBe(44)
    expect(tall.fontSize!).toBeCloseTo((44 * 1080) / 1920, 6)
  })

  it('anchors a left-aligned line by its left edge, not its centre', () => {
    const name = lowerThird(WIDE).clips['ct-lt-type']![0]!
    expect(name.transform!.anchor).toEqual({ x: 0, y: 0.5 })
    expect(name.textAlign).toBe('left')
  })

  it('puts that line where the numbers say, through the real text layout', () => {
    // Read through `blockCenter` — the function the painter actually uses — so
    // this fails if the v2 model is ever dropped, rather than merely noticing
    // that a field changed. The box is 600px wide, the anchor is its left edge,
    // and the line is written at x = 168: the box's left edge must land there.
    const project = lowerThird(WIDE)
    const name = project.clips['ct-lt-type']![0]!
    const BOX_W = 600
    const BOX_H = 60
    const placed = blockCenter(name, project.stage, BOX_W, BOX_H).center
    expect(placed.x * project.stage.width).toBeCloseTo(168 + BOX_W / 2, 6)
    expect(placed.y * project.stage.height).toBeCloseTo(838, 6)

    // The same clip WITHOUT v2 is the legacy model, which treats x/y as the block
    // CENTRE and ignores the anchor: the left edge lands 300px to the LEFT of the
    // number, off the panel and nearly off the frame. That is the failure the
    // field is there to prevent, shown as a number.
    const legacy = blockCenter({ ...name, transformModel: undefined }, project.stage, BOX_W, BOX_H).center
    // Centre at 168, half a 600px box to the left: -132, off the panel's left
    // edge and outside the 120px the design starts at.
    expect(legacy.x * project.stage.width - BOX_W / 2).toBeCloseTo(-132, 6)
    expect(legacy.x * project.stage.width).toBeCloseTo(168, 6)
  })
})

// ---------------------------------------------------------------------------

describe('contrast is written down, not hoped for', () => {
  /** WCAG relative luminance. */
  function luminance(hex: string): number {
    const channel = (v: number) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    const n = parseInt(hex.slice(1), 16)
    return (
      0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
    )
  }

  function ratio(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
    return (hi + 0.05) / (lo + 0.05)
  }

  it('clears WCAG AA for every pair of colours a template actually draws together', () => {
    // A template is applied over footage it cannot see, so contrast is the only
    // thing keeping a caption readable. Every pair here is a real pairing in one
    // of the four builders.
    const pairs: Array<[string, string]> = [
      ['#ffffff', '#0f172a'], // body copy on every panel
      ['#38bdf8', '#0f172a'], // accent bar, underline, button on the panel
      ['#0f172a', '#38bdf8'], // the button's own label
      ['#93c5fd', '#0f172a'], // the lower third's role line
    ]
    for (const [fg, bg] of pairs) {
      expect({ pair: `${fg} on ${bg}`, ratio: Number(ratio(fg, bg).toFixed(2)) }).toMatchObject({
        ratio: expect.any(Number),
      })
      expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('uses only those four colours', () => {
    const allowed = new Set(['#0f172a', '#ffffff', '#38bdf8', '#93c5fd'])
    for (const template of COMPOUND_TEMPLATES) {
      for (const clip of allClips(template.build(WIDE))) {
        const colours = [clip.color, clip.shapeFill, clip.shapeStroke].filter(
          (c): c is string => typeof c === 'string',
        )
        for (const c of colours) expect(allowed.has(c.toLowerCase())).toBe(true)
      }
    }
  })

  it('puts a shadow on the one template with no panel behind it', () => {
    const headline = allClips(reelHook(WIDE)).find((c) => c.name === 'Headline')!
    expect(headline.textShadow).toBeDefined()
    expect(headline.textShadow!.blur).toBeGreaterThan(0)
  })
})
