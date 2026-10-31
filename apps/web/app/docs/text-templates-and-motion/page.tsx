import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { DocsToc } from '@/components/docs/DocsToc'
import { Code } from '@/components/docs/Code'
import { C, Callout, DocsPager, H2, H3, P, PropTable } from '@/components/docs/DocsKit'
import { EasingCurves } from '@/components/docs/EasingCurves'
import { PageHeader } from '@/components/site/PageHeader'

export const metadata: Metadata = {
  title: 'Text Templates & Motion',
  description:
    'Layered entry and exit motion with MotionSpec, the easing curves, the pure sampling helpers, the 14 built-in text templates, applyTextTemplate, and text style presets.',
  alternates: { canonical: '/docs/text-templates-and-motion' },
}

const toc = [
  { id: 'motion-spec', title: 'MotionSpec', level: 2 },
  { id: 'easings', title: 'Easings', level: 2 },
  { id: 'sampling', title: 'Sampling', level: 2 },
  { id: 'built-in-templates', title: 'Built-in templates', level: 2 },
  { id: 'apply-template', title: 'Applying a template', level: 2 },
  { id: 'style-presets', title: 'Style presets', level: 2 },
]

const link = 'text-on-surface underline decoration-[#FF003C] underline-offset-4 hover:decoration-2'

const TEMPLATES: Array<[string, string, string]> = [
  ['Title Card', 'template-title-card', 'Display title that punches up into place and drifts away. Opens a section.'],
  ['Elegant Reveal', 'template-elegant-reveal', 'Serif line that settles in slowly and widens away. Editorial.'],
  ['Kinetic Pop', 'template-kinetic-pop', 'Display type that springs in off-axis and snaps flat. Social cuts.'],
  ['Quote', 'template-quote', 'Roomy serif pull-quote on a soft panel. Breathes in and out.'],
  ['Lower Third', 'template-lower-third', 'Name bar that slides in from the left and snaps to a stop. Interviews.'],
  ['Subtitle', 'template-subtitle', 'Legible caption line pinned near the bottom. Deliberately still.'],
  ['Callout', 'template-callout', 'Outlined chip that drops in with a bounce and lifts away. Facts, stats.'],
  ['Ticker', 'template-ticker', 'Small line that drifts steadily leftward the whole time. Credits.'],
  ['Editorial Stamp', 'template-editorial-stamp', 'Fine tracked caps at the top of frame, settling line by line. Magazine masthead.'],
  ['Brand Drop', 'template-brand-drop', 'Heavy display words stacking in one at a time with a snap. Hooks and drops.'],
  ['Runway Ticker', 'template-runway-ticker', 'Small caps crawling steadily along the bottom. Credits, seasons, drop dates.'],
  ['Price Chip', 'template-price-chip', 'Outlined pill that drops in high in frame. Prices, sizes, one-word facts.'],
  ['Split Title', 'template-split-title', 'Two lines closing in from opposite sides to meet mid-frame. Statement titles.'],
  ['Period Title', 'template-period-title', 'Warm serif easing down out of nothing over a long dissolve. Film-title feel.'],
]

function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="my-4 list-none space-y-3 p-0 text-[15px] leading-[1.75] text-on-surface/85">
      {items.map((t, i) => (
        <li key={i} className="flex gap-3">
          <span aria-hidden className="mt-[11px] h-[5px] w-[5px] shrink-0 bg-on-surface" />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  )
}

export default function TextTemplatesAndMotionPage() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
      <article className="min-w-0 max-w-3xl flex-1">
        <PageHeader
          variant="doc"
          eyebrow="Build the editor"
          title="Text Templates &amp; Motion"
          lede="Animate how text and shapes enter and leave. Describe each end once with a MotionSpec, pick an easing curve, or apply one of 14 built-in templates."
        />

        <H2 id="motion-spec">MotionSpec</H2>
        <P>
          A clip&apos;s <C>textAnimation</C> has two ends: how it comes in and how it goes out. Describe each end with a <C>MotionSpec</C>: where
          the clip is at the far end of the move. This one rises, grows and fades in with a little overshoot, then keeps rising as it leaves:
        </P>
        <Code
          highlight={[4, 5]}
          code={`
engine.updateClip(clip.id, trackId, {
  textAnimation: {
    durationFrames: 12,
    inMotion: { opacity: 0, offsetY: 0.05, scale: 0.86, ease: 'back-out' },
    outMotion: { opacity: 0, offsetY: -0.04, scale: 0.96, ease: 'quad-in' },
  },
})`}
        />
        <Callout title="A spec only stores the far end">
          The near end is always the clip&apos;s own resting state. An entry starts at the spec and arrives at rest; an exit starts at rest and
          leaves for the spec. Any channel you leave out stays at rest.
        </Callout>

        <H3>MotionSpec</H3>
        <PropTable
          rows={[
            { name: 'opacity', type: 'number', optional: true, desc: 'Opacity at the far end, 0 to 1. Leave it out for no fade.' },
            { name: 'offsetX · offsetY', type: 'number', optional: true, desc: 'Distance from rest, as a fraction of the stage width or height.' },
            { name: 'scale', type: 'number', optional: true, desc: 'A multiplier on the clip’s own scale. 0.8 is 80% of whatever size it was given.' },
            { name: 'rotation', type: 'number', optional: true, desc: 'Turn from rest, in radians. Positive is clockwise.' },
            { name: 'ease', type: 'TextAnimationEasing', optional: true, desc: <>Curve for movement, scale and rotation. Default <C>quad-out</C> on entry, <C>quad-in</C> on exit.</> },
            { name: 'opacityEase', type: 'TextAnimationEasing', optional: true, desc: <>Curve for opacity. Default <C>linear</C>.</> },
          ]}
        />

        <H3>TextAnimation</H3>
        <PropTable
          rows={[
            { name: 'durationFrames', type: 'number', desc: 'Length of each ramp in frames, shared by both ends.' },
            { name: 'inMotion · outMotion', type: 'MotionSpec', optional: true, desc: 'The entry and exit. When set, each replaces in or out.' },
            { name: 'in · out', type: 'TextAnimationKind', optional: true, desc: <>A one-word shortcut, as written by the properties panel: <C>fade</C>, <C>spin</C>, <C>slide-up</C>, <C>slide-down</C>, <C>slide-left</C> or <C>slide-right</C>.</> },
          ]}
        />
        <P>The one-word kinds are turned into a <C>MotionSpec</C> internally, so both forms play through the same code.</P>
        <Callout title="Shapes animate the same way">
          Shape clips take the same structure on <C>shapeAnimation</C>. The <C>spin</C> kind is offered for text only, but a <C>rotation</C>{' '}
          channel in a MotionSpec does turn a shape.
        </Callout>

        <H2 id="easings">Easings</H2>
        <P>
          An easing curve shapes how a move speeds up and slows down. There is <C>linear</C>, plus ten families that each come as <C>-in</C>,{' '}
          <C>-out</C> and <C>-in-out</C>. <C>TEXT_ANIMATION_EASINGS</C> lists every name, for building a picker. These are drawn by the engine
          itself:
        </P>
        <EasingCurves />
        <Callout title="back and elastic overshoot on purpose">
          They pass the target and come back, which is a lot of what makes motion look designed. Opacity is clamped so it never goes past 0 or 1,
          and <C>opacityEase</C> lets the fade stay linear while the movement overshoots.
        </Callout>

        <H2 id="sampling">Sampling</H2>
        <P>
          The engine turns an animation into an opacity and a position for each frame, before anything is drawn. That is why the preview and the
          export always match. The same helper is public, for your own previews or pickers:
        </P>
        <Code
          highlight={[3, 10, 11]}
          code={`
import { sampleTextAnimation, DEFAULT_TEXT_TRANSFORM } from '@elah/editor'

const sample = sampleTextAnimation({
  animation: clip.textAnimation,
  localFrame: currentFrame - clip.startFrame,
  clipDurationFrames: clip.durationFrames,
  transform: clip.transform,
  defaultTransform: DEFAULT_TEXT_TRANSFORM,
})
const opacity = Math.min(clip.opacity ?? 1, sample.opacity)
const placed = sample.transform ?? clip.transform`}
        />
        <Callout kind="warning" title="Pass the right default transform">
          <C>defaultTransform</C> is required. Use <C>DEFAULT_TEXT_TRANSFORM</C> for text (scale 1) and <C>DEFAULT_SHAPE_TRANSFORM</C> for shapes
          (scale 0.5). If <C>sample.transform</C> is missing, the animation does not move the clip: keep the clip&apos;s own transform.
        </Callout>
        <PropTable
          nameLabel="Export"
          rows={[
            { name: 'sampleTextAnimation(args)', desc: <>Returns <C>{'{ opacity, transform? }'}</C> for one frame.</> },
            { name: 'resolveRampFrames(n)', desc: 'Turns a stored ramp length into a whole number of frames, at least 1. Zero, negatives, fractions, NaN and Infinity are all handled.' },
            { name: "motionForKind(kind, 'in' | 'out')", desc: 'The MotionSpec that a one-word kind stands for.' },
            { name: 'TEXT_ANIMATION_KINDS', desc: <>Every kind, with a <C>label</C> and <C>appliesTo</C> (<C>&apos;both&apos;</C> or <C>&apos;text-only&apos;</C>).</> },
            { name: 'SLIDE_TRAVEL_NORMALIZED', desc: 'How far the slide kinds travel: 0.15 of the stage.' },
            { name: 'SPIN_TRAVEL_RADIANS', desc: 'How far spin turns: a quarter turn.' },
          ]}
        />
        <P>
          The entry covers the first <C>durationFrames</C> of the clip and the exit the last. On a short clip where they overlap, opacity takes the
          lower of the two and the movements add up, so the clip passes smoothly through rest instead of jumping.
        </P>

        <H2 id="built-in-templates">Built-in templates</H2>
        <P>
          A template is a ready-made look: a text style, its motion, and sometimes a position. <C>BUILT_IN_TEXT_TEMPLATES</C> has 14, in the order
          a picker should show them. Find one with <C>findTextTemplate(id)</C>; it returns <C>undefined</C> for an unknown id.
        </P>
        <PropTable nameLabel="Template" rows={TEMPLATES.map(([name, id, desc]) => ({ name, type: id, desc }))} />
        <P>
          Each template has an <C>id</C>, <C>name</C>, <C>description</C>, <C>style</C> and <C>animation</C>, and may have <C>stagger</C>,{' '}
          <C>tracking</C> and <C>placement</C>. Its ramp is a fraction of the clip (<C>rampFraction</C>). A template never changes the words
          (<C>content</C>), only how they look and move.
        </P>
        <Callout kind="warning" title="stagger and tracking are not applied for you">
          <C>stagger</C> (split a line into several clips that enter in turn) and <C>tracking: &apos;wide&apos;</C> (extra letter spacing) are
          part of some looks, but one clip cannot express them. <C>applyTextTemplate</C> ignores both, and nothing in the packages runs them. If
          you build a timeline from a template, implement them yourself.
        </Callout>

        <H2 id="apply-template">Applying a template</H2>
        <P>
          <C>applyTextTemplate(template, clip)</C> returns the changes to make; it does not change anything itself. Pass them to{' '}
          <C>engine.updateClip</C> and the edit is undoable and saved like any other.
        </P>
        <Code
          highlight={[5]}
          code={`
import { applyTextTemplate, findTextTemplate } from '@elah/editor'

const template = findTextTemplate('template-lower-third')
if (template) {
  engine.updateClip(clip.id, trackId, applyTextTemplate(template, clip))
}`}
        />
        <Bullets
          items={[
            <>
              <strong className="font-semibold text-on-surface">Switching templates starts clean.</strong> Box fields the new template does not use
              (background, padding, border) are cleared, so going from Quote (with a panel) to Title Card (without) leaves no panel behind. Hand edits to
              those fields are replaced too.
            </>,
            <>
              <strong className="font-semibold text-on-surface">Position is merged.</strong> A template with a <C>placement</C> sets only x and y;
              scale, rotation and anchor stay. A clip with no transform starts from <C>DEFAULT_TEXT_TRANSFORM</C>, so it does not jump. Use it on
              text clips only.
            </>,
            <>
              <strong className="font-semibold text-on-surface">The ramp fits the clip.</strong> The changes include a <C>textAnimation</C> whose
              length is worked out from this clip&apos;s duration.
            </>,
          ]}
        />
        <H3>Building a timeline from a template</H3>
        <P>
          <C>resolveTemplateRamp(rampFraction, clipDurationFrames)</C> is that ramp calculation on its own. It returns whole frames: at most half
          the clip, at most <C>MAX_TEMPLATE_RAMP_FRAMES</C> (30), and at least <C>MIN_TEMPLATE_RAMP_FRAMES</C> (1). Past half the clip the entry
          and exit would overlap and the text would never be fully visible.
        </P>

        <H2 id="style-presets">Style presets</H2>
        <P>
          A <C>TextStylePreset</C> is smaller than a template: just six style fields (<C>fontFamily</C>, <C>fontWeight</C>, <C>fontSize</C>,{' '}
          <C>textAlign</C>, <C>color</C>, <C>opacity</C>) plus an <C>id</C> and <C>name</C>. No motion, position or background. Use presets to
          quickly restyle text; use templates for a finished look.
        </P>
        <PropTable
          nameLabel="Export"
          rows={[
            { name: 'BUILT_IN_TEXT_STYLE_PRESETS', desc: 'Five fixed looks: Subtitle, Title, Caption, Elegant and Highlight.' },
            { name: 'textStylePresetsStore', desc: <>The user&apos;s saved presets. Starts empty. <C>addPreset(preset)</C> assigns the id; <C>removePreset(id)</C> deletes one. It does not save anything to disk itself.</> },
            {
              name: 'useTextStylePresetsStore',
              desc: (
                <>
                  The React hook for it, from{' '}
                  <Link href="/docs/react#load-and-presets" className={link}>
                    @elah/react
                  </Link>
                  .
                </>
              ),
            },
          ]}
        />
        <Code
          highlight={[15, 16]}
          code={`
import { BUILT_IN_TEXT_STYLE_PRESETS, textStylePresetsStore } from '@elah/editor'

// Save a look.
textStylePresetsStore.getState().addPreset({
  name: 'My title',
  fontFamily: 'Impact',
  fontWeight: 'bold',
  fontSize: 72,
  textAlign: 'center',
  color: '#ffffff',
  opacity: 1,
})

// Apply one: copy its style fields onto the clip.
const { id, name, ...style } = BUILT_IN_TEXT_STYLE_PRESETS[0]
engine.updateClip(clip.id, trackId, style)`}
        />

        <DocsPager href="/docs/text-templates-and-motion" />
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
