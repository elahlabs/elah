/**
 * Sample content for every motion component (EG-P5).
 *
 * A gallery insert makes NO model call, so each component needs content that
 * looks intentional on its own: a headline, a few chips, a believable stat.
 * Kept beside the registry rather than as a `ComponentDef` field so the 17
 * library files stay untouched; a test walks `COMPONENT_NAMES` and expands
 * every sample, so adding a component without a sample fails loudly.
 *
 * A sample is the component's authored BODY: everything except the document
 * fields (`id`, `kind`, `at`). `duration` is each def's own default.
 */

import { COMPONENT_NAMES, type ComponentName, type SpecComponent } from './types'
import { COMPONENT_DEFS } from './library'

export type ComponentSampleBody = Omit<SpecComponent, 'id' | 'kind' | 'at'>

const BODIES: Record<ComponentName, Omit<ComponentSampleBody, 'duration' | 'component'>> = {
  'kinetic-title': { text: 'Make something people remember', emphasis: ['remember'], sub: 'New this season' },
  'word-hits': {
    items: [{ text: 'Plan' }, { text: 'Build' }, { text: 'Launch', style: 'accent' }],
  },
  'typewriter-line': { text: 'Good ideas ship early.', sub: 'Draft' },
  'circled-phrase': { text: 'worth the wait', variant: 'circle' },
  'quote-card': { text: 'The best tool is the one you actually enjoy using.', sub: 'A happy customer' },
  'stat-ring': { items: [{ value: 82, text: 'Finished on time' }], variant: 'percent' },
  'stat-bars': {
    items: [
      { text: 'Mon', value: 40 },
      { text: 'Tue', value: 65 },
      { text: 'Wed', value: 92, style: 'highlight' },
      { text: 'Thu', value: 55 },
    ],
  },
  'big-number': { items: [{ value: 2400, text: 'Projects shipped' }], variant: 'below' },
  'icon-row': {
    items: [{ icon: 'lightbulb' }, { icon: 'rocket' }, { icon: 'heart', style: 'highlight' }, { icon: 'star' }, { icon: 'shield-check' }],
  },
  'badge-callouts': {
    variant: 'hexagon',
    items: [
      { icon: 'zap', text: 'Fast' },
      { icon: 'lock', text: 'Private' },
      { icon: 'award', text: 'Trusted' },
    ],
  },
  'chip-cloud': {
    items: [
      { text: 'Design', style: 'filled' },
      { text: 'Motion', style: 'outline' },
      { text: 'Video', style: 'filled' },
      { text: 'Brand', style: 'outline' },
      { text: 'Social', style: 'outline' },
    ],
  },
  checklist: { items: [{ text: 'Write the brief' }, { text: 'Pick a look' }, { text: 'Export and share' }] },
  'testimonial-cards': {
    items: [
      { text: 'Saved us a week of editing.', sub: 'Asha', value: 5 },
      { text: 'Looks like a studio made it.', sub: 'Marcus', value: 5 },
    ],
  },
  comparison: {
    items: [
      { text: 'Hours of keyframing', style: 'muted' },
      { text: 'Ready in minutes', style: 'accent' },
      { text: 'Hard to change', style: 'muted' },
      { text: 'Edit any part', style: 'accent' },
    ],
  },
  'clock-sweep': { text: 'Done in 60 seconds' },
  'logo-outro': { text: 'Elah', sub: 'Create anything' },
  'section-break': { text: 'Next' },
}

/** A sample for every name in `COMPONENT_NAMES`, with that def's default duration. */
export const COMPONENT_SAMPLES: Readonly<Record<ComponentName, ComponentSampleBody>> = Object.fromEntries(
  COMPONENT_NAMES.map((name) => {
    const def = COMPONENT_DEFS.find((d) => d.name === name)
    const body: ComponentSampleBody = { component: name, duration: def?.duration.default ?? 3, ...BODIES[name] }
    return [name, body]
  }),
) as Record<ComponentName, ComponentSampleBody>

/**
 * A fresh, mutable authored component from a sample. `id` is the caller's
 * (it must be unique among the document's elements); `at` is seconds.
 */
export function componentSample(name: ComponentName, id: string, at = 0): SpecComponent {
  const body = COMPONENT_SAMPLES[name]
  return structuredClone({ ...body, id, kind: 'component', at }) as SpecComponent
}
