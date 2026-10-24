/**
 * Tests for the nine data/list/group components (AV-8b): stat-ring,
 * stat-bars, big-number, icon-row, badge-callouts, chip-cloud, checklist,
 * testimonial-cards, comparison.
 *
 * Every component gets: a clean expansion + compile for a typical input and
 * for `items` min/max, part-id/duration hygiene, a staggered-arrival check,
 * idle motion on holding parts, an exit on every content part, a visible
 * highlight where the craft calls for one, a margin/overlap layout check
 * where the layout is organic, and determinism per seed. `stat-ring` and
 * `big-number` additionally check the `counter` generator's `to` and its
 * explicit `prefix`/`suffix` (per the coordinator's note: the generator
 * defaults `suffix` to `'+'`, which is wrong on a plain stat).
 */
import { describe, expect, it } from 'vitest'
import { buildVideo } from '../../build'
import { expandComponents } from '../index'
import type { AuthoredSpec, ComponentItem, SpecComponent } from '../types'
import type { SpecElement, SpecFormat } from '../../types'
import { estimateTextWidth } from './dataKit'

const FORMAT: SpecFormat = { width: 1080, height: 1920, fps: 30 }

function authored(component: SpecComponent, extra: Partial<AuthoredSpec> = {}): AuthoredSpec {
  return {
    format: FORMAT,
    duration: component.duration,
    elements: [component],
    ...extra,
  }
}

/** The one top-level group's children — the component's expanded parts. */
function partsOf(component: SpecComponent, seed = 1): SpecElement[] {
  const { spec, issues } = expandComponents(authored(component), { seed })
  const errors = issues.filter((i) => i.severity === 'error')
  expect(errors, JSON.stringify(errors)).toEqual([])
  const group = spec.elements[0]!
  expect(group.kind).toBe('group')
  return group.children ?? []
}

function compilesClean(component: SpecComponent): void {
  const { issues } = buildVideo(authored(component), { polish: false })
  const errors = issues.filter((i) => i.severity === 'error')
  expect(errors, JSON.stringify(errors)).toEqual([])
}

/** Every part's id is scoped to the component, and no part outruns the component's own duration. */
function checkHygiene(component: SpecComponent, parts: SpecElement[]): void {
  expect(parts.length).toBeGreaterThan(0)
  for (const p of parts) {
    expect(p.id.startsWith(`${component.id}-`)).toBe(true)
    expect(p.at + p.duration).toBeLessThanOrEqual(component.duration + 1e-6)
  }
}

/** At least one part carries an idle expression (float/breathe) — nothing holds perfectly still. */
function hasIdleMotion(parts: SpecElement[]): boolean {
  return parts.some((p) => (p.expressions?.length ?? 0) > 0)
}

/** A part "exits" if its keys bring `opacity` down to (approximately) 0 before or at its own end. */
function hasExit(part: SpecElement): boolean {
  const opacityKeys = (part.keys ?? []).filter((k) => k.channel === 'opacity')
  if (opacityKeys.length === 0) return false
  const last = opacityKeys[opacityKeys.length - 1]!
  return last.value <= 0.01
}

/** Estimated box, in stage px, centred on (x, y) — matches the ticket's own overlap-test formula for text. */
function boxOf(el: SpecElement, format: SpecFormat): { x: number; y: number; w: number; h: number } {
  const cx = (el.x ?? 0.5) * format.width
  const cy = (el.y ?? 0.5) * format.height
  let w = el.w ?? 0
  let h = el.h ?? 0
  if (el.kind === 'text' && el.text) {
    w = estimateTextWidth(el.text, el.size ?? 32, el.pill?.padding ?? 0)
    h = (el.size ?? 32) * 1.6
  }
  return { x: cx - w / 2, y: cy - h / 2, w, h }
}

function overlapFraction(a: ReturnType<typeof boxOf>, b: ReturnType<typeof boxOf>): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  const inter = ix * iy
  const smaller = Math.min(a.w * a.h, b.w * b.h)
  return smaller <= 0 ? 0 : inter / smaller
}

/** No two boxes overlap more than 20% of the smaller, and every box stays inside x 0.06–0.94. */
function checkLayout(boxes: Array<ReturnType<typeof boxOf>>, format: SpecFormat): void {
  for (const b of boxes) {
    expect(b.x / format.width).toBeGreaterThanOrEqual(0.06 - 1e-6)
    expect((b.x + b.w) / format.width).toBeLessThanOrEqual(0.94 + 1e-6)
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      expect(overlapFraction(boxes[i]!, boxes[j]!)).toBeLessThanOrEqual(0.2 + 1e-6)
    }
  }
}

function counterPart(parts: SpecElement[], idSuffix: string): SpecElement {
  const p = parts.find((x) => x.id.endsWith(idSuffix) && x.generator === 'counter')
  if (!p) throw new Error(`no counter part ending "${idSuffix}"`)
  return p
}

function paramValue(part: SpecElement, name: string): unknown {
  return part.params?.find((p) => p.name === name)?.value
}

// ---------------------------------------------------------------------------
// stat-ring
// ---------------------------------------------------------------------------

describe('stat-ring', () => {
  const base = (items: ComponentItem[], extra: Partial<SpecComponent> = {}): SpecComponent => ({
    id: 'ring',
    kind: 'component',
    component: 'stat-ring',
    at: 0,
    duration: 3.5,
    items,
    ...extra,
  })

  it('compiles clean for a typical input and for items min/max (both 1)', () => {
    compilesClean(base([{ text: 'Retention', value: 87 }]))
    compilesClean(base([{ value: 0 }]))
    compilesClean(base([{ value: 250, text: 'x'.repeat(80) }]))
  })

  it('hygiene: ids scoped, parts end by the component duration', () => {
    const c = base([{ text: 'Retention', value: 87 }])
    checkHygiene(c, partsOf(c))
  })

  it('the ring breathes and the arc/track are not static', () => {
    const c = base([{ text: 'Retention', value: 87 }])
    expect(hasIdleMotion(partsOf(c))).toBe(true)
  })

  it('every content part exits', () => {
    const c = base([{ text: 'Retention', value: 87 }])
    const parts = partsOf(c)
    for (const p of parts) expect(hasExit(p)).toBe(true)
  })

  it("the counter's `to` equals the item's value, with prefix/suffix always explicit", () => {
    const c = base([{ text: 'Retention', value: 87 }])
    const counter = counterPart(partsOf(c), '-counter')
    expect(paramValue(counter, 'to')).toBe(87)
    expect(paramValue(counter, 'prefix')).toBe('')
    expect(paramValue(counter, 'suffix')).toBe('')
  })

  it('the accent arc draws to value/100 of the circle', () => {
    const c = base([{ value: 40 }])
    const arc = partsOf(c).find((p) => p.id.endsWith('-arc'))!
    expect(arc.draw?.to).toBeCloseTo(0.4)
  })

  it('variant "full" draws the whole ring regardless of value', () => {
    const c = base([{ value: 40 }], { variant: 'full' })
    const arc = partsOf(c).find((p) => p.id.endsWith('-arc'))!
    expect(arc.draw?.to).toBe(1)
  })

  it('is deterministic for one seed', () => {
    const c = base([{ text: 'Retention', value: 87 }])
    const a = expandComponents(authored(c), { seed: 5 })
    const b = expandComponents(authored(c), { seed: 5 })
    expect(JSON.stringify(a.spec)).toBe(JSON.stringify(b.spec))
  })
})

// ---------------------------------------------------------------------------
// big-number
// ---------------------------------------------------------------------------

describe('big-number', () => {
  const base = (items: ComponentItem[], extra: Partial<SpecComponent> = {}): SpecComponent => ({
    id: 'big',
    kind: 'component',
    component: 'big-number',
    at: 0,
    duration: 3,
    items,
    ...extra,
  })

  it('compiles clean for a typical input and for items min/max (both 1)', () => {
    compilesClean(base([{ text: 'Happy customers', value: 12500 }]))
    compilesClean(base([{ value: 0 }]))
    compilesClean(base([{ value: 999999, text: 'y' }]))
  })

  it('hygiene, idle motion and exits', () => {
    const c = base([{ text: 'Happy customers', value: 12500 }])
    const parts = partsOf(c)
    checkHygiene(c, parts)
    expect(hasIdleMotion(parts)).toBe(true)
    for (const p of parts) expect(hasExit(p)).toBe(true)
  })

  it("the counter's `to` equals the item's value, with prefix/suffix always explicit", () => {
    const c = base([{ text: 'Happy customers', value: 12500 }])
    const counter = counterPart(partsOf(c), '-counter')
    expect(paramValue(counter, 'to')).toBe(12500)
    expect(paramValue(counter, 'prefix')).toBe('')
    expect(paramValue(counter, 'suffix')).toBe('')
  })

  it('the decorative plus-signs use icon elements with both color and stroke set', () => {
    const c = base([{ text: 'Happy customers', value: 12500 }])
    const plus = partsOf(c).find((p) => p.kind === 'icon' && p.icon === 'plus')!
    expect(plus.color).toBeTruthy()
    expect(plus.stroke).toBe(plus.color)
  })
})

// ---------------------------------------------------------------------------
// icon-row
// ---------------------------------------------------------------------------

describe('icon-row', () => {
  const items3: ComponentItem[] = [{ icon: 'star' }, { icon: 'circle-check', style: 'highlight' }, { icon: 'heart' }]
  const items7: ComponentItem[] = Array.from({ length: 7 }, (_, i) => ({ icon: 'star', text: `i${i}` }))
  const base = (items: ComponentItem[], extra: Partial<SpecComponent> = {}): SpecComponent => ({
    id: 'row',
    kind: 'component',
    component: 'icon-row',
    at: 0,
    duration: 3.5,
    items,
    ...extra,
  })

  it('compiles clean for a typical input and for items min (3) and max (7)', () => {
    compilesClean(base(items3))
    compilesClean(base(items3.slice(0, 3)))
    compilesClean(base(items7))
  })

  it('hygiene, idle motion and exits', () => {
    const c = base(items3)
    const parts = partsOf(c)
    checkHygiene(c, parts)
    expect(hasIdleMotion(parts)).toBe(true)
    for (const p of parts) expect(hasExit(p)).toBe(true)
  })

  it('icons arrive staggered (distinct arrival times), not all at once', () => {
    const c = base(items7)
    const parts = partsOf(c)
    const arrivals = items7.map((_, i) => parts.find((p) => p.id === `${c.id}-icon-${i}`)!.at)
    expect(new Set(arrivals).size).toBe(arrivals.length)
  })

  it('the highlight item is visibly larger and coloured differently, and dims the rest', () => {
    const c = base(items3)
    const parts = partsOf(c)
    const highlightIcon = parts.find((p) => p.id === `${c.id}-icon-1`)!
    const otherIcon = parts.find((p) => p.id === `${c.id}-icon-0`)!
    expect((highlightIcon.w ?? 0)).toBeGreaterThan(otherIcon.w ?? 0)
    expect(highlightIcon.color).not.toBe(otherIcon.color)
    // the highlight's colour and stroke agree (coordinator's icon-color note)
    expect(highlightIcon.stroke).toBe(highlightIcon.color)
    const dimKey = (otherIcon.keys ?? []).find((k) => k.channel === 'opacity' && Math.abs(k.value - 0.6) < 1e-6)
    expect(dimKey).toBeTruthy()
  })

  it('bracket corners draw on around the highlight', () => {
    const c = base(items3)
    const brackets = partsOf(c).filter((p) => p.id.includes('-bracket-'))
    expect(brackets.length).toBe(4)
    for (const b of brackets) expect(b.draw).toBeTruthy()
  })

  it('every item stays inside the safe margin', () => {
    const c = base(items7)
    const parts = partsOf(c)
    const boxes = items7.map((_, i) => boxOf(parts.find((p) => p.id === `${c.id}-surface-${i}`)!, FORMAT))
    checkLayout(boxes, FORMAT)
  })

  it('is deterministic for one seed (no organic randomness in this component)', () => {
    const c = base(items3)
    const a = expandComponents(authored(c), { seed: 9 })
    const b = expandComponents(authored(c), { seed: 9 })
    expect(JSON.stringify(a.spec)).toBe(JSON.stringify(b.spec))
  })
})

// ---------------------------------------------------------------------------
// badge-callouts
// ---------------------------------------------------------------------------

describe('badge-callouts', () => {
  const items2: ComponentItem[] = [
    { icon: 'award', text: 'Certified' },
    { icon: 'shield', text: 'Secure' },
  ]
  const items4: ComponentItem[] = [
    { icon: 'award', text: 'Certified' },
    { icon: 'shield', text: 'Secure' },
    { icon: 'star', text: 'Top rated' },
    { icon: 'compass', text: 'Guided' },
  ]
  const base = (items: ComponentItem[], extra: Partial<SpecComponent> = {}): SpecComponent => ({
    id: 'badges',
    kind: 'component',
    component: 'badge-callouts',
    at: 0,
    duration: 4.5,
    items,
    ...extra,
  })

  it('compiles clean for a typical input and for items min (2) and max (4)', () => {
    compilesClean(base(items2))
    compilesClean(base(items4))
  })

  it('hygiene, idle motion and exits', () => {
    const c = base(items4)
    const parts = partsOf(c)
    checkHygiene(c, parts)
    expect(hasIdleMotion(parts)).toBe(true)
    for (const p of parts) expect(hasExit(p)).toBe(true)
  })

  it('badges pop in one by one, 0.35s apart', () => {
    const c = base(items4)
    const parts = partsOf(c)
    const arrivals = items4.map((_, i) => parts.find((p) => p.id === `${c.id}-badge-${i}`)!.at)
    for (let i = 1; i < arrivals.length; i++) expect(arrivals[i]! - arrivals[i - 1]!).toBeCloseTo(0.35, 1)
  })

  it('the badge icon carries both color and stroke', () => {
    const c = base(items2)
    const icon = partsOf(c).find((p) => p.kind === 'icon')!
    expect(icon.color).toBe('#ffffff')
    expect(icon.stroke).toBe('#ffffff')
  })

  it('badges stay inside the safe margin and never overlap by more than 20%', () => {
    const c = base(items4)
    const parts = partsOf(c)
    const boxes = items4.map((_, i) => boxOf(parts.find((p) => p.id === `${c.id}-badge-${i}`)!, FORMAT))
    checkLayout(boxes, FORMAT)
  })

  it('the arrangement is organic: same seed repeats, a different seed moves it', () => {
    const c = base(items4)
    const a = expandComponents(authored(c), { seed: 3 })
    const b = expandComponents(authored(c), { seed: 3 })
    const d = expandComponents(authored(c), { seed: 4 })
    expect(JSON.stringify(a.spec)).toBe(JSON.stringify(b.spec))
    expect(JSON.stringify(a.spec)).not.toBe(JSON.stringify(d.spec))
  })
})

// ---------------------------------------------------------------------------
// chip-cloud
// ---------------------------------------------------------------------------

describe('chip-cloud', () => {
  const items3: ComponentItem[] = [{ text: 'Fast' }, { text: 'Reliable', style: 'filled' }, { text: 'Secure', style: 'outline' }]
  const items8: ComponentItem[] = ['Fast', 'Reliable', 'Secure', 'Modern', 'Scalable', 'Simple', 'Open', 'Global'].map(
    (text, i) => ({ text, style: i % 2 === 0 ? 'filled' : 'outline' }),
  )
  const base = (items: ComponentItem[], extra: Partial<SpecComponent> = {}): SpecComponent => ({
    id: 'cloud',
    kind: 'component',
    component: 'chip-cloud',
    at: 0,
    duration: 4.5,
    items,
    ...extra,
  })

  it('compiles clean for a typical input and for items min (3) and max (8)', () => {
    compilesClean(base(items3))
    compilesClean(base(items8))
  })

  it('hygiene, idle motion and exits', () => {
    const c = base(items3)
    const parts = partsOf(c)
    checkHygiene(c, parts)
    expect(hasIdleMotion(parts)).toBe(true)
    const chips = parts.filter((p) => p.id.includes('-chip-'))
    for (const p of chips) expect(hasExit(p)).toBe(true)
  })

  it('filled chips are white-on-accent, outline chips are ink-on-transparent', () => {
    const c = base(items3)
    const parts = partsOf(c)
    const filled = parts.find((p) => p.id === `${c.id}-chip-1`)!
    const outline = parts.find((p) => p.id === `${c.id}-chip-2`)!
    expect(filled.color).toBe('#ffffff')
    expect(filled.pill?.fill).toBeTruthy()
    expect(outline.pill?.stroke).toBeTruthy()
  })

  it('chips fly in from alternating sides', () => {
    const c = base(items8)
    const parts = partsOf(c)
    const chip0 = parts.find((p) => p.id === `${c.id}-chip-0`)!
    const chip1 = parts.find((p) => p.id === `${c.id}-chip-1`)!
    const startX0 = chip0.keys!.find((k) => k.channel === 'x')!.value
    const startX1 = chip1.keys!.find((k) => k.channel === 'x')!.value
    expect(startX0).toBeLessThan(0)
    expect(startX1).toBeGreaterThan(1)
  })

  it('chips stay inside the safe margin and never overlap by more than 20%', () => {
    const c = base(items8)
    const parts = partsOf(c)
    const boxes = items8.map((_, i) => boxOf(parts.find((p) => p.id === `${c.id}-chip-${i}`)!, FORMAT))
    checkLayout(boxes, FORMAT)
  })

  it('the cloud is organic: same seed repeats, a different seed moves it', () => {
    const c = base(items8)
    const a = expandComponents(authored(c), { seed: 1 })
    const b = expandComponents(authored(c), { seed: 1 })
    const d = expandComponents(authored(c), { seed: 2 })
    expect(JSON.stringify(a.spec)).toBe(JSON.stringify(b.spec))
    expect(JSON.stringify(a.spec)).not.toBe(JSON.stringify(d.spec))
  })
})

// ---------------------------------------------------------------------------
// checklist
// ---------------------------------------------------------------------------

describe('checklist', () => {
  const items2: ComponentItem[] = [{ text: 'Design' }, { text: 'Ship' }]
  const items6: ComponentItem[] = ['Design', 'Build', 'Test', 'Ship', 'Support', 'Iterate'].map((text) => ({ text }))
  const base = (items: ComponentItem[], extra: Partial<SpecComponent> = {}): SpecComponent => ({
    id: 'list',
    kind: 'component',
    component: 'checklist',
    at: 0,
    duration: 4.5,
    items,
    ...extra,
  })

  it('compiles clean for a typical input and for items min (2) and max (6)', () => {
    compilesClean(base(items2))
    compilesClean(base(items6))
  })

  it('hygiene and exits', () => {
    const c = base(items6)
    const parts = partsOf(c)
    checkHygiene(c, parts)
    for (const p of parts) expect(hasExit(p)).toBe(true)
  })

  it('items arrive top to bottom, strictly staggered in order', () => {
    const c = base(items6)
    const parts = partsOf(c)
    const arrivals = items6.map((_, i) => parts.find((p) => p.id === `${c.id}-circle-${i}`)!.at)
    for (let i = 1; i < arrivals.length; i++) expect(arrivals[i]!).toBeGreaterThan(arrivals[i - 1]!)
    const ys = items6.map((_, i) => parts.find((p) => p.id === `${c.id}-circle-${i}`)!.y!)
    for (let i = 1; i < ys.length; i++) expect(ys[i]!).toBeGreaterThan(ys[i - 1]!)
  })

  it('within a row: circle draws, then the check pops, then the text rises, in that order', () => {
    const c = base(items2)
    const parts = partsOf(c)
    const circle = parts.find((p) => p.id === `${c.id}-circle-0`)!
    const check = parts.find((p) => p.id === `${c.id}-check-0`)!
    const text = parts.find((p) => p.id === `${c.id}-text-0`)!
    expect(check.at).toBeGreaterThan(circle.at)
    expect(text.at).toBeGreaterThan(check.at)
  })

  it('the last item gets the accent emphasis', () => {
    const c = base(items6)
    const parts = partsOf(c)
    const lastText = parts.find((p) => p.id === `${c.id}-text-5`)!
    const otherText = parts.find((p) => p.id === `${c.id}-text-0`)!
    expect(lastText.color).not.toBe(otherText.color)
    expect((lastText.weight as number) ?? 0).toBeGreaterThan((otherText.weight as number) ?? 0)
  })
})

// ---------------------------------------------------------------------------
// testimonial-cards
// ---------------------------------------------------------------------------

describe('testimonial-cards', () => {
  const items2: ComponentItem[] = [
    { text: 'Amazing product, changed our workflow.', sub: 'Jane D.', value: 5 },
    { text: 'Solid support and a great team.', sub: 'Sam R.', value: 4 },
  ]
  const items3: ComponentItem[] = [
    ...items2,
    { text: 'Would recommend to anyone.', sub: 'Lee K.', value: 5 },
  ]
  const base = (items: ComponentItem[], extra: Partial<SpecComponent> = {}): SpecComponent => ({
    id: 'cards',
    kind: 'component',
    component: 'testimonial-cards',
    at: 0,
    duration: 5,
    items,
    ...extra,
  })

  it('compiles clean for a typical input and for items min (2) and max (3)', () => {
    compilesClean(base(items2))
    compilesClean(base(items3))
  })

  it('hygiene, idle motion and exits', () => {
    const c = base(items3)
    const parts = partsOf(c)
    checkHygiene(c, parts)
    expect(hasIdleMotion(parts)).toBe(true)
    const cards = parts.filter((p) => p.id.includes('-card-'))
    for (const p of cards) expect(hasExit(p)).toBe(true)
  })

  it('cards are tilted via the rotation field, not rotation keys (AV-7 not landed)', () => {
    const c = base(items3)
    const parts = partsOf(c)
    const cards = parts.filter((p) => p.id.includes('-card-'))
    expect(cards.some((p) => (p.rotation ?? 0) !== 0)).toBe(true)
    for (const p of parts) expect((p.keys ?? []).some((k) => k.channel === 'rotation')).toBe(false)
  })

  it('one card sits in front via a higher layer', () => {
    const c = base(items3)
    const parts = partsOf(c)
    const layers = [0, 1, 2].map((i) => parts.find((p) => p.id === `${c.id}-card-${i}`)!.layer ?? 0)
    expect(new Set(layers).size).toBeGreaterThan(1)
  })

  it('each card carries 5 stars, filled up to its rating', () => {
    const c = base(items2)
    const parts = partsOf(c)
    const stars0 = parts.filter((p) => p.id.startsWith(`${c.id}-star-0-`))
    expect(stars0.length).toBe(5)
    const filled = stars0.filter((s) => s.fill === parts.find((p) => p.id === `${c.id}-star-0-0`)!.fill)
    expect(filled.length).toBeGreaterThan(0)
  })

  it('the arrangement is organic: same seed repeats, a different seed moves the rotation jitter', () => {
    const c = base(items3)
    const a = expandComponents(authored(c), { seed: 11 })
    const b = expandComponents(authored(c), { seed: 11 })
    const d = expandComponents(authored(c), { seed: 12 })
    expect(JSON.stringify(a.spec)).toBe(JSON.stringify(b.spec))
    expect(JSON.stringify(a.spec)).not.toBe(JSON.stringify(d.spec))
  })
})

// ---------------------------------------------------------------------------
// stat-bars
// ---------------------------------------------------------------------------

describe('stat-bars', () => {
  const items2: ComponentItem[] = [
    { text: 'Q1', value: 40 },
    { text: 'Q2', value: 90, style: 'highlight' },
  ]
  const items6: ComponentItem[] = [40, 65, 90, 30, 55, 72].map((value, i) => ({
    text: `Q${i}`,
    value,
    style: i === 2 ? 'highlight' : undefined,
  }))
  const base = (items: ComponentItem[], extra: Partial<SpecComponent> = {}): SpecComponent => ({
    id: 'bars',
    kind: 'component',
    component: 'stat-bars',
    at: 0,
    duration: 4.5,
    items,
    ...extra,
  })

  it('compiles clean for a typical input and for items min (2) and max (6)', () => {
    compilesClean(base(items2))
    compilesClean(base(items6))
  })

  it('hygiene, idle motion and exits', () => {
    const c = base(items6)
    const parts = partsOf(c)
    checkHygiene(c, parts)
    expect(hasIdleMotion(parts)).toBe(true)
    const bars = parts.filter((p) => p.id.includes('-bar-'))
    for (const p of bars) expect(hasExit(p)).toBe(true)
  })

  it('bars grow via scaleY anchored at the bottom, staggered in order', () => {
    const c = base(items6)
    const parts = partsOf(c)
    const bars = items6.map((_, i) => parts.find((p) => p.id === `${c.id}-bar-${i}`)!)
    for (const b of bars) expect(b.anchor).toEqual({ x: 0.5, y: 1 })
    for (let i = 1; i < bars.length; i++) expect(bars[i]!.at).toBeGreaterThan(bars[i - 1]!.at)
  })

  it('a taller value produces a taller bar (bigger scaleY landing value)', () => {
    const c = base(items6)
    const parts = partsOf(c)
    const shortBar = parts.find((p) => p.id === `${c.id}-bar-3`)! // value 30, smallest
    const tallBar = parts.find((p) => p.id === `${c.id}-bar-2`)! // value 90, highlight
    const landing = (p: SpecElement) => (p.keys ?? []).filter((k) => k.channel === 'scaleY').slice(-1)[0]!.value
    expect(landing(tallBar)).toBeGreaterThan(landing(shortBar))
  })

  it('the highlight bar is coloured differently from the rest', () => {
    const c = base(items6)
    const parts = partsOf(c)
    const highlight = parts.find((p) => p.id === `${c.id}-bar-2`)!
    const other = parts.find((p) => p.id === `${c.id}-bar-0`)!
    expect(highlight.fill).not.toBe(other.fill)
  })

  it('the baseline draws before any bar starts growing', () => {
    const c = base(items2)
    const parts = partsOf(c)
    const baseline = parts.find((p) => p.id === `${c.id}-baseline`)!
    const firstBar = parts.find((p) => p.id === `${c.id}-bar-0`)!
    expect(baseline.draw?.at).toBe(0)
    expect(firstBar.at).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// comparison
// ---------------------------------------------------------------------------

describe('comparison', () => {
  const items2: ComponentItem[] = [
    { text: 'Manual setup', style: 'muted' },
    { text: 'Automated setup', style: 'accent' },
  ]
  const items8: ComponentItem[] = ['Slow', 'Fast', 'Manual', 'Automatic', 'Error-prone', 'Reliable', 'Costly', 'Cheap'].map(
    (text, i) => ({ text, style: i % 2 === 0 ? 'muted' : 'accent' }),
  )
  const base = (items: ComponentItem[], extra: Partial<SpecComponent> = {}): SpecComponent => ({
    id: 'cmp',
    kind: 'component',
    component: 'comparison',
    at: 0,
    duration: 4.5,
    text: 'Before',
    sub: 'After',
    items,
    ...extra,
  })

  it('compiles clean for a typical input and for items min (2) and max (8)', () => {
    compilesClean(base(items2))
    compilesClean(base(items8))
  })

  it('hygiene and exits', () => {
    const c = base(items8)
    const parts = partsOf(c)
    checkHygiene(c, parts)
    for (const p of parts) expect(hasExit(p)).toBe(true)
  })

  it('an x icon marks left (muted) rows and a check marks right (accent) rows', () => {
    const c = base(items2)
    const parts = partsOf(c)
    const leftIcon = parts.find((p) => p.id === `${c.id}-icon-l-0`)!
    const rightIcon = parts.find((p) => p.id === `${c.id}-icon-r-0`)!
    expect(leftIcon.icon).toBe('x')
    expect(rightIcon.icon).toBe('check')
  })

  it('rows rise in alternating left/right', () => {
    const c = base(items8)
    const parts = partsOf(c)
    const rowParts = parts.filter((p) => p.id.includes('-icon-'))
    const bySide = rowParts
      .map((p) => ({ at: p.at, side: p.id.includes('-icon-l-') ? 'l' : 'r' }))
      .sort((a, b) => a.at - b.at)
    for (let i = 1; i < bySide.length; i++) expect(bySide[i]!.side).not.toBe(bySide[i - 1]!.side)
  })

  it('the divider draws before the headers pop, which land before any row', () => {
    const c = base(items2)
    const parts = partsOf(c)
    const divider = parts.find((p) => p.id === `${c.id}-divider`)!
    const headerLeft = parts.find((p) => p.id === `${c.id}-header-left`)!
    const firstRow = parts.find((p) => p.id === `${c.id}-icon-l-0`)!
    expect(divider.at).toBe(0)
    expect(headerLeft.at).toBeGreaterThan(0)
    expect(firstRow.at).toBeGreaterThan(headerLeft.at)
  })

  it('rows stay inside the safe margin', () => {
    const c = base(items8)
    const parts = partsOf(c)
    const texts = parts.filter((p) => p.id.includes('-text-l-') || p.id.includes('-text-r-'))
    const boxes = texts.map((p) => boxOf(p, FORMAT))
    checkLayout(boxes, FORMAT)
  })
})
