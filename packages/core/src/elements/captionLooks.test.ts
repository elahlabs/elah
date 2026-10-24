import { describe, expect, it } from 'vitest'
import {
  CAPTION_LOOKS,
  CAPTION_LOOK_SAMPLE,
  TEXT_ANIMATOR_PRESETS,
  animatorLengthFrames,
  captionLookAnimator,
  captionLookOutlasts,
  captionLookPatch,
  findCaptionLook,
} from './captions'
import { BUILT_IN_TEXT_TEMPLATES } from './textTemplates'
import type { Clip } from '../types'

const clip = (over: Partial<Clip> = {}): Clip =>
  ({
    id: 'c1',
    trackId: 't1',
    type: 'text',
    name: 'Caption',
    startFrame: 0,
    durationFrames: CAPTION_LOOK_SAMPLE.durationFrames,
    sourceInFrame: 0,
    sourceDurationFrames: CAPTION_LOOK_SAMPLE.durationFrames,
    content: CAPTION_LOOK_SAMPLE.text,
    ...over,
  }) as Clip

describe('CAPTION_LOOKS', () => {
  it('ships a usable set with unique ids and unique one-line labels', () => {
    expect(CAPTION_LOOKS.length).toBeGreaterThanOrEqual(8)
    expect(new Set(CAPTION_LOOKS.map((l) => l.id)).size).toBe(CAPTION_LOOKS.length)
    expect(new Set(CAPTION_LOOKS.map((l) => l.label)).size).toBe(CAPTION_LOOKS.length)
    for (const l of CAPTION_LOOKS) {
      expect(l.label, l.id).not.toMatch(/\n/)
      expect(l.label.length, l.id).toBeLessThanOrEqual(24)
    }
  })

  it('is built only from templates and reveals that exist (no second animation model)', () => {
    for (const l of CAPTION_LOOKS) {
      expect(BUILT_IN_TEXT_TEMPLATES.some((t) => t.id === l.templateId), `${l.id} template`).toBe(true)
      if (l.revealId) expect(TEXT_ANIMATOR_PRESETS.some((p) => p.id === l.revealId), `${l.id} reveal`).toBe(true)
      if (l.mode === 'karaoke' || l.mode === 'highlight') expect(l.highlight, `${l.id} highlight`).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('does not reuse the names of any other product', () => {
    const banned = ['ekdam', 'neon script', 'kinetic stack', 'pop viral', 'active box', 'word scatter']
    for (const l of CAPTION_LOOKS) for (const b of banned) expect(l.label.toLowerCase()).not.toContain(b)
  })

  it('every look finishes its reveal inside the sample caption (length warning)', () => {
    for (const l of CAPTION_LOOKS) {
      expect(captionLookOutlasts(l, CAPTION_LOOK_SAMPLE.text, CAPTION_LOOK_SAMPLE.durationFrames), l.id).toBe(false)
    }
  })

  it('every shipped reveal finishes inside the sample caption, so no look can inherit a slow one', () => {
    for (const p of TEXT_ANIMATOR_PRESETS) {
      expect(animatorLengthFrames(CAPTION_LOOK_SAMPLE.text, p.animator), p.id).toBeLessThanOrEqual(CAPTION_LOOK_SAMPLE.durationFrames)
    }
  })

  it('captionLookOutlasts detects a caption too short for the reveal, and ignores looks with none', () => {
    const typed = findCaptionLook('typed-out')!
    const len = animatorLengthFrames(CAPTION_LOOK_SAMPLE.text, captionLookAnimator(typed)!)
    expect(captionLookOutlasts(typed, CAPTION_LOOK_SAMPLE.text, len - 1)).toBe(true)
    expect(captionLookOutlasts(typed, CAPTION_LOOK_SAMPLE.text, len)).toBe(false)
    expect(captionLookOutlasts(findCaptionLook('quiet-line')!, CAPTION_LOOK_SAMPLE.text, 1)).toBe(false)
  })
})

describe('captionLookPatch', () => {
  it('lays template style, reveal animator and stroke on the clip', () => {
    const p = captionLookPatch(findCaptionLook('outline-pop')!, clip())
    expect(p.fontFamily).toBe('Impact')
    expect(p.textOutline).toEqual({ color: '#000000', width: 7 })
    expect(p.textAnimator).toEqual(TEXT_ANIMATOR_PRESETS.find((a) => a.id === 'word-pop')!.animator)
    expect(p.captionMode).toBeUndefined()
  })

  it('a timed look carries its mode, highlight and estimated words', () => {
    const p = captionLookPatch(findCaptionLook('karaoke-fill')!, clip())
    expect(p.captionMode).toBe('karaoke')
    expect(p.captionHighlight).toBe('#ffd400')
    expect(p.words?.map((w) => w.text)).toEqual(['Make', 'every', 'second', 'count'])
    expect(p.textAnimator).toBeUndefined()
  })

  it('keeps real transcript words rather than re-estimating them', () => {
    const words = [{ text: 'Make', start: 0, end: 5 }]
    expect(captionLookPatch(findCaptionLook('karaoke-fill')!, clip({ words })).words).toBeUndefined()
  })

  it('switching to a plain look clears the previous reveal, mode, highlight and stroke', () => {
    const before = clip({ ...captionLookPatch(findCaptionLook('social-heavy')!, clip()) } as Partial<Clip>)
    expect(before.captionMode).toBe('reveal')
    const after = { ...before, ...captionLookPatch(findCaptionLook('quiet-line')!, before) }
    expect(after.captionMode).toBeUndefined()
    expect(after.textAnimator).toBeUndefined()
    expect(after.textOutline).toBeUndefined()
  })
})
