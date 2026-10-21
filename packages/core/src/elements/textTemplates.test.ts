import { describe, it, expect } from 'vitest'
import {
  BUILT_IN_TEXT_TEMPLATES,
  MAX_TEMPLATE_RAMP_FRAMES,
  MIN_TEMPLATE_RAMP_FRAMES,
  applyTextTemplate,
  findTextTemplate,
  resolveTemplateRamp,
  type TextTemplate,
} from './textTemplates'
import { DEFAULT_TEXT_TRANSFORM, sampleTextAnimation } from '../resolver/textAnimation'
import { TEXT_ANIMATION_EASINGS } from '../resolver/textAnimation'
import type { Clip, Transform } from '../types'

function makeTextClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'clip-1',
    trackId: 'track-1',
    type: 'text',
    name: 'Text',
    startFrame: 0,
    durationFrames: 120,
    sourceInFrame: 0,
    sourceDurationFrames: 120,
    content: 'Hello world',
    ...overrides,
  } as Clip
}

describe('BUILT_IN_TEXT_TEMPLATES', () => {
  it('ships more than one template, which is what "reusable templates" means', () => {
    expect(BUILT_IN_TEXT_TEMPLATES.length).toBeGreaterThan(1)
  })

  it('has unique ids so a picker key can never collide', () => {
    const ids = BUILT_IN_TEXT_TEMPLATES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has unique names so two chips are never indistinguishable', () => {
    const names = BUILT_IN_TEXT_TEMPLATES.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('only uses easing curves the sampler actually implements', () => {
    const known = new Set(TEXT_ANIMATION_EASINGS)
    for (const template of BUILT_IN_TEXT_TEMPLATES) {
      for (const spec of [template.animation.in, template.animation.out]) {
        if (!spec) continue
        if (spec.ease) expect(known).toContain(spec.ease)
        if (spec.opacityEase) expect(known).toContain(spec.opacityEase)
      }
    }
  })

  it('animates at least one channel at each end it defines', () => {
    // A spec with an easing curve but no channel is a silent no-op — it looks
    // configured and does nothing.
    for (const template of BUILT_IN_TEXT_TEMPLATES) {
      for (const spec of [template.animation.in, template.animation.out]) {
        if (!spec) continue
        const drives =
          spec.opacity !== undefined ||
          spec.offsetX !== undefined ||
          spec.offsetY !== undefined ||
          spec.scale !== undefined ||
          spec.rotation !== undefined
        expect(drives).toBe(true)
      }
    }
  })

  it('keeps scale multipliers in a range that cannot invert or vanish the text', () => {
    for (const template of BUILT_IN_TEXT_TEMPLATES) {
      for (const spec of [template.animation.in, template.animation.out]) {
        if (spec?.scale === undefined) continue
        expect(spec.scale).toBeGreaterThan(0)
        expect(spec.scale).toBeLessThanOrEqual(3)
      }
    }
  })

  it('keeps opacity extremes inside 0..1', () => {
    for (const template of BUILT_IN_TEXT_TEMPLATES) {
      for (const spec of [template.animation.in, template.animation.out]) {
        if (spec?.opacity === undefined) continue
        expect(spec.opacity).toBeGreaterThanOrEqual(0)
        expect(spec.opacity).toBeLessThanOrEqual(1)
      }
    }
  })

  it('uses more than one easing curve across the set', () => {
    // The point of the layered model is that templates differ in FEEL, not just
    // in font. If every template eased identically we would have rebuilt the
    // flat version with more ceremony.
    const used = new Set<string>()
    for (const template of BUILT_IN_TEXT_TEMPLATES) {
      if (template.animation.in?.ease) used.add(template.animation.in.ease)
      if (template.animation.out?.ease) used.add(template.animation.out.ease)
    }
    expect(used.size).toBeGreaterThanOrEqual(4)
  })

  it('drives more than one channel on at least half the templates', () => {
    // Same reasoning: a set where every entry is a lone fade is the flat design.
    const layered = BUILT_IN_TEXT_TEMPLATES.filter((t) => {
      const spec = t.animation.in
      if (!spec) return false
      const channels = [spec.opacity, spec.offsetX, spec.offsetY, spec.scale, spec.rotation]
      return channels.filter((c) => c !== undefined).length > 1
    })
    expect(layered.length).toBeGreaterThanOrEqual(BUILT_IN_TEXT_TEMPLATES.length / 2)
  })

  it('keeps every placement inside the stage', () => {
    for (const template of BUILT_IN_TEXT_TEMPLATES) {
      if (!template.placement) continue
      expect(template.placement.x).toBeGreaterThan(0)
      expect(template.placement.x).toBeLessThan(1)
      expect(template.placement.y).toBeGreaterThan(0)
      expect(template.placement.y).toBeLessThan(1)
    }
  })

  it('uses a ramp fraction that can never on its own eat a whole clip', () => {
    for (const template of BUILT_IN_TEXT_TEMPLATES) {
      expect(template.animation.rampFraction).toBeGreaterThan(0)
      // Both ramps together must leave the clip solid for at least one frame.
      expect(template.animation.rampFraction).toBeLessThanOrEqual(0.5)
    }
  })

  it('gives every template a description for the picker tooltip', () => {
    for (const template of BUILT_IN_TEXT_TEMPLATES) {
      expect(template.description.trim().length).toBeGreaterThan(0)
    }
  })
})

describe('findTextTemplate', () => {
  it('finds a shipped template by id', () => {
    expect(findTextTemplate('template-title-card')?.name).toBe('Title Card')
  })

  it('returns undefined for an id we do not ship', () => {
    expect(findTextTemplate('template-nope')).toBeUndefined()
  })
})

describe('resolveTemplateRamp', () => {
  it('takes the requested fraction of clip length when nothing binds', () => {
    // 0.1 of 120 = 12; under half the clip and under the frame ceiling.
    expect(resolveTemplateRamp(0.1, 120)).toBe(12)
  })

  it('never exceeds half the clip, so the text is solid for at least one frame', () => {
    // 0.9 of 20 would be 18, which would overlap the two ramps heavily.
    expect(resolveTemplateRamp(0.9, 20)).toBe(10)
  })

  it('never exceeds the absolute frame ceiling on a long clip', () => {
    // 0.25 of 6000 = 1500 frames of fade. Capped.
    expect(resolveTemplateRamp(0.25, 6000)).toBe(MAX_TEMPLATE_RAMP_FRAMES)
  })

  it('never returns less than one frame, even on a two-frame clip', () => {
    expect(resolveTemplateRamp(0.1, 2)).toBe(MIN_TEMPLATE_RAMP_FRAMES)
  })

  it('survives a degenerate stored duration', () => {
    for (const duration of [0, -5, NaN, Infinity, -Infinity, 3.7]) {
      const ramp = resolveTemplateRamp(0.2, duration)
      expect(Number.isInteger(ramp)).toBe(true)
      expect(ramp).toBeGreaterThanOrEqual(1)
    }
  })

  it('survives a degenerate fraction', () => {
    for (const fraction of [NaN, Infinity, -1]) {
      const ramp = resolveTemplateRamp(fraction, 120)
      expect(Number.isInteger(ramp)).toBe(true)
      expect(ramp).toBeGreaterThanOrEqual(1)
    }
  })

  it('always returns a whole number of frames', () => {
    // 0.15 of 33 = 4.95 — must not reach the sampler as a fraction.
    expect(Number.isInteger(resolveTemplateRamp(0.15, 33))).toBe(true)
  })
})

describe('applyTextTemplate', () => {
  const titleCard = findTextTemplate('template-title-card') as TextTemplate
  const lowerThird = findTextTemplate('template-lower-third') as TextTemplate
  const quote = findTextTemplate('template-quote') as TextTemplate

  it('writes the template style onto the clip', () => {
    const patch = applyTextTemplate(titleCard, makeTextClip())
    expect(patch.fontFamily).toBe(titleCard.style.fontFamily)
    expect(patch.fontWeight).toBe(titleCard.style.fontWeight)
    expect(patch.fontSize).toBe(titleCard.style.fontSize)
    expect(patch.textAlign).toBe(titleCard.style.textAlign)
    expect(patch.color).toBe(titleCard.style.color)
  })

  it('clears a bundled font and italic, so the template family actually wins (PV-P4b)', () => {
    // The failure this prevents is INVISIBLE: `fontId` keeps winning over
    // `fontFamily` in resolveTextStyle, so a template applied over a bundled font
    // changes every other field and leaves the typeface untouched. The keys must
    // be PRESENT and undefined — `toEqual` ignores an undefined key, so `in` is
    // the only assertion that sees them.
    const patch = applyTextTemplate(
      titleCard,
      makeTextClip({ fontId: 'inter', fontStyle: 'italic' }),
    )
    expect('fontId' in patch).toBe(true)
    expect('fontStyle' in patch).toBe(true)
    expect(patch.fontId).toBeUndefined()
    expect(patch.fontStyle).toBeUndefined()
  })

  it('clears a glyph gradient, so the template colour can win (PV-P4c-1)', () => {
    // A gradient REPLACES `color` at paint time, so a template that sets a
    // colour and leaves the gradient in place changes nothing visible — and
    // nothing reports an error, because both fields are perfectly valid.
    const patch = applyTextTemplate(
      titleCard,
      makeTextClip({ textFill: { type: 'linear', angle: 0, stops: [{ offset: 0, color: '#000' }, { offset: 1, color: '#fff' }] } }),
    )
    expect('textFill' in patch).toBe(true)
    expect(patch.textFill).toBeUndefined()
    expect(patch.color).toBe(titleCard.style.color)
  })

  it('never rewrites the author’s text', () => {
    const patch = applyTextTemplate(titleCard, makeTextClip({ content: 'my words' }))
    expect('content' in patch).toBe(false)
  })

  it('never moves the clip on the timeline', () => {
    const patch = applyTextTemplate(titleCard, makeTextClip())
    expect('startFrame' in patch).toBe(false)
    expect('durationFrames' in patch).toBe(false)
    expect('trackId' in patch).toBe(false)
  })

  it('resolves the ramp against this clip’s length', () => {
    const short = applyTextTemplate(titleCard, makeTextClip({ durationFrames: 10 }))
    const long = applyTextTemplate(titleCard, makeTextClip({ durationFrames: 600 }))
    expect(short.textAnimation?.durationFrames).toBe(
      resolveTemplateRamp(titleCard.animation.rampFraction, 10),
    )
    expect(long.textAnimation?.durationFrames).toBe(MAX_TEMPLATE_RAMP_FRAMES)
  })

  it('clears box fields the new template does not use', () => {
    // Quote paints a panel; Title Card does not. Applying Title Card after Quote
    // must not leave the panel behind.
    const withPanel = applyTextTemplate(quote, makeTextClip())
    expect(withPanel.backgroundColor).toBeDefined()

    const clipCarryingPanel = makeTextClip({
      backgroundColor: '#000000',
      backgroundOpacity: 0.35,
      padding: 32,
      borderRadius: 12,
      borderWidth: 4,
      borderColor: '#ff0000',
    })
    const patch = applyTextTemplate(titleCard, clipCarryingPanel)
    expect('backgroundColor' in patch).toBe(true)
    expect(patch.backgroundColor).toBeUndefined()
    expect(patch.backgroundOpacity).toBeUndefined()
    expect(patch.padding).toBeUndefined()
    expect(patch.borderRadius).toBeUndefined()
    expect(patch.borderWidth).toBeUndefined()
    expect(patch.borderColor).toBeUndefined()
  })

  it('leaves the clip where it is when the template has no placement', () => {
    const patch = applyTextTemplate(titleCard, makeTextClip())
    expect('transform' in patch).toBe(false)
  })

  it('positions the clip when the template is defined by its placement', () => {
    const patch = applyTextTemplate(lowerThird, makeTextClip())
    expect(patch.transform?.x).toBe(lowerThird.placement?.x)
    expect(patch.transform?.y).toBe(lowerThird.placement?.y)
  })

  it('keeps scale and rotation when placing a clip that already had a transform', () => {
    const authored: Transform = {
      x: 0.1,
      y: 0.1,
      scale: 2.5,
      rotation: 0.4,
      anchor: { x: 0.5, y: 0.5 },
    }
    const patch = applyTextTemplate(lowerThird, makeTextClip({ transform: authored }))
    expect(patch.transform?.scale).toBe(2.5)
    expect(patch.transform?.rotation).toBe(0.4)
    expect(patch.transform?.x).toBe(lowerThird.placement?.x)
  })

  it('uses the text renderer’s own default when placing a clip with no transform', () => {
    // Getting this wrong makes the clip jump: a synthesized transform must
    // reproduce the renderer default exactly for everything it does not set.
    const patch = applyTextTemplate(lowerThird, makeTextClip({ transform: undefined }))
    expect(patch.transform?.scale).toBe(DEFAULT_TEXT_TRANSFORM.scale)
    expect(patch.transform?.rotation).toBe(DEFAULT_TEXT_TRANSFORM.rotation)
    expect(patch.transform?.anchor).toEqual(DEFAULT_TEXT_TRANSFORM.anchor)
  })

  it('does not alias the clip’s own transform object', () => {
    const authored: Transform = {
      x: 0.1,
      y: 0.1,
      scale: 1,
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
    }
    const clip = makeTextClip({ transform: authored })
    const patch = applyTextTemplate(lowerThird, clip)
    expect(patch.transform).not.toBe(authored)
    expect(patch.transform?.anchor).not.toBe(authored.anchor)
    // The source clip is untouched.
    expect(clip.transform?.x).toBe(0.1)
  })

  it('is idempotent — applying the same template twice changes nothing further', () => {
    const clip = makeTextClip()
    const first = applyTextTemplate(lowerThird, clip)
    const second = applyTextTemplate(lowerThird, { ...clip, ...first } as Clip)
    expect(second).toEqual(first)
  })
})

describe('applied templates render without visual defects', () => {
  // The DoD for this feature is "selected, edited, previewed and exported
  // without visual or timeline bugs". Preview and export both go through
  // sampleTextAnimation, so pushing every template through the sampler across a
  // clip's whole life is the check that covers both paths at once.
  const DURATIONS = [4, 9, 30, 120, 900]

  for (const template of BUILT_IN_TEXT_TEMPLATES) {
    for (const durationFrames of DURATIONS) {
      it(`${template.name} stays finite and visible across a ${durationFrames}-frame clip`, () => {
        const clip = makeTextClip({ durationFrames })
        const patch = applyTextTemplate(template, clip)
        const animation = patch.textAnimation

        let sawFullOpacity = false

        for (let localFrame = 0; localFrame < durationFrames; localFrame++) {
          const sample = sampleTextAnimation({
            animation,
            localFrame,
            clipDurationFrames: durationFrames,
            transform: patch.transform,
            defaultTransform: DEFAULT_TEXT_TRANSFORM,
          })

          expect(Number.isFinite(sample.opacity)).toBe(true)
          expect(sample.opacity).toBeGreaterThanOrEqual(0)
          expect(sample.opacity).toBeLessThanOrEqual(1)
          if (sample.opacity >= 0.999) sawFullOpacity = true

          if (sample.transform) {
            expect(Number.isFinite(sample.transform.x)).toBe(true)
            expect(Number.isFinite(sample.transform.y)).toBe(true)
            expect(Number.isFinite(sample.transform.rotation)).toBe(true)
            expect(Number.isFinite(sample.transform.scale)).toBe(true)
          }
        }

        // The half-clip ramp cap exists precisely so this holds: there is always
        // at least one frame where the text is fully opaque.
        expect(sawFullOpacity).toBe(true)
      })
    }
  }

  it('keeps text solid for a frame even when a template asks for a ramp longer than the clip', () => {
    // No shipped template has a fraction big enough to make the two ramps
    // overlap, so nothing above exercises the half-clip cap through the sampler.
    // This is the case the cap exists for: a greedy fraction on a short clip.
    // Without it both opacity ramps overlap, `sampleTextAnimation` takes their
    // minimum, and the text never once reaches full opacity.
    const greedy: TextTemplate = {
      id: 'template-test-greedy',
      name: 'Greedy',
      description: 'Test-only: asks for a ramp far longer than the clip.',
      style: {
        fontFamily: 'sans-serif',
        fontWeight: 'bold',
        fontSize: 40,
        textAlign: 'center',
        color: '#ffffff',
      },
      animation: { in: { opacity: 0 }, out: { opacity: 0 }, rampFraction: 0.9 },
    }

    const durationFrames = 20
    const patch = applyTextTemplate(greedy, makeTextClip({ durationFrames }))

    let sawFullOpacity = false
    for (let localFrame = 0; localFrame < durationFrames; localFrame++) {
      const sample = sampleTextAnimation({
        animation: patch.textAnimation,
        localFrame,
        clipDurationFrames: durationFrames,
        transform: patch.transform,
        defaultTransform: DEFAULT_TEXT_TRANSFORM,
      })
      if (sample.opacity >= 0.999) sawFullOpacity = true
    }
    expect(sawFullOpacity).toBe(true)
  })

  it('keeps a placed template on stage for the frames it is drawn', () => {
    // A placement plus a slide must not strand the block outside the frame.
    const clip = makeTextClip({ durationFrames: 90 })
    for (const template of BUILT_IN_TEXT_TEMPLATES) {
      if (!template.placement) continue
      const patch = applyTextTemplate(template, clip)

      for (let localFrame = 0; localFrame < clip.durationFrames; localFrame++) {
        const sample = sampleTextAnimation({
          animation: patch.textAnimation,
          localFrame,
          clipDurationFrames: clip.durationFrames,
          transform: patch.transform,
          defaultTransform: DEFAULT_TEXT_TRANSFORM,
        })
        const t = sample.transform ?? patch.transform
        if (!t) continue
        // The block centre may leave the safe area during a slide but must stay
        // within the stage itself, or the clip visibly disappears mid-ramp.
        expect(t.x).toBeGreaterThan(0)
        expect(t.x).toBeLessThan(1)
        expect(t.y).toBeGreaterThan(0)
        expect(t.y).toBeLessThan(1)
      }
    }
  })
})
