import type { Metadata } from 'next'
import Link from 'next/link'
import { CodeBlock } from '@/components/docs/CodeBlock'
import { DocsToc } from '@/components/docs/DocsToc'
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
  { id: 'built-in-templates', title: 'Built-in Templates', level: 2 },
  { id: 'apply-template', title: 'Applying a Template', level: 2 },
  { id: 'style-presets', title: 'Style Presets', level: 2 },
]

const EASINGS = [
  'linear',
  'quad-in',
  'quad-out',
  'quad-in-out',
  'cubic-out',
  'expo-out',
  'back-in',
  'back-out',
  'elastic-out',
  'bounce-out',
]

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

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20"
    >
      {children}
    </h2>
  )
}

function C({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">{children}</code>
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">{children}</p>
}

export default function TextTemplatesAndMotionPage() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
      <article className="min-w-0 flex-1 max-w-3xl">
        <PageHeader
          variant="doc"
          eyebrow="Build the editor"
          title="Text Templates &amp; Motion"
          lede={
            <>
              One end of an animation can now drive several channels at once. 0.6.0 adds layered text and shape motion, the pure helpers that sample it, and 14 built-in text templates that bundle a look with its motion.
            </>
          }
        />

        {/* MotionSpec */}
        <section className="mb-10">
          <H2 id="motion-spec">MotionSpec</H2>
          <P>
            <C>TextAnimation</C> still has <C>in</C> and <C>out</C>, the one-kind-per-end enum that the properties panel writes (<C>fade</C>, <C>spin</C>, <C>slide-up</C>, <C>slide-down</C>, <C>slide-left</C>, <C>slide-right</C>). It now also has <C>inMotion</C> and <C>outMotion</C>. Each is a <C>MotionSpec</C> and, when present, replaces the enum for that end. The enum is resolved into a <C>MotionSpec</C> internally, so there is one sampling path, not two.
          </P>
          <CodeBlock
            language="typescript"
            filename="@elah/core (types)"
            code={`interface MotionSpec {
  /** Opacity at the extreme, 0..1. Rest is 1. Omitted = no opacity ramp. */
  opacity?: number
  /** Horizontal offset from rest at the extreme, normalized 0..1 of stage width. */
  offsetX?: number
  /** Vertical offset from rest at the extreme, normalized 0..1 of stage height. */
  offsetY?: number
  /** Scale MULTIPLIER on the authored scale. 0.8 = 80% of whatever size the author chose. */
  scale?: number
  /** Rotation delta from rest at the extreme, in radians. Positive = clockwise. */
  rotation?: number
  /** Curve for the geometric channels. Defaults: 'quad-out' on an entry, 'quad-in' on an exit. */
  ease?: TextAnimationEasing
  /** Curve for opacity. Defaults to 'linear'. */
  opacityEase?: TextAnimationEasing
}

interface TextAnimation {
  in?: TextAnimationKind
  out?: TextAnimationKind
  durationFrames: number       // ramp length in frames, shared by both ends
  inMotion?: MotionSpec        // replaces \`in\` when present
  outMotion?: MotionSpec       // replaces \`out\` when present
}`}
          />
          <P>
            A spec stores only the far end of the ramp, because the near end is always the clip&apos;s authored resting state. On an entry the clip starts at the extreme and arrives at rest as the ramp closes. On an exit it starts at rest and departs to the extreme. Any channel you omit stays at rest.
          </P>
          <CodeBlock
            language="typescript"
            code={`// Rise 5% of stage height, grow from 86%, fade in, with a springy overshoot.
// Leave by continuing upward and shrinking a touch.
engine.updateClip(clip.id, trackId, {
  textAnimation: {
    durationFrames: 12,
    inMotion: { opacity: 0, offsetY: 0.05, scale: 0.86, ease: 'back-out' },
    outMotion: { opacity: 0, offsetY: -0.04, scale: 0.96, ease: 'quad-in' },
  },
})`}
          />
          <P>
            Motion applies to shape clips too. They carry the same structure on <C>Clip.shapeAnimation</C>. One caveat: <C>spin</C> is still offered for text only (see <C>appliesTo</C> in <C>TEXT_ANIMATION_KINDS</C>). Since 1.0.0 the shape painter does apply <C>transform.rotation</C>, so a rotation channel in a <C>MotionSpec</C> turns a shape.
          </P>
        </section>

        {/* Easings */}
        <section className="mb-10">
          <H2 id="easings">Easings</H2>
          <P>
            <C>TextAnimationEasing</C> is one of ten curves, and <C>TEXT_ANIMATION_EASINGS</C> lists them in declaration order, so a picker can render the list without drifting from the type.
          </P>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {EASINGS.map((name) => (
              <span
                key={name}
                className="rounded border border-outline-variant bg-surface-container px-2 py-0.5 font-mono text-xs text-on-surface"
              >
                {name}
              </span>
            ))}
          </div>
          <P>
            <C>back-in</C>, <C>back-out</C> and <C>elastic-out</C> overshoot, returning values outside 0 to 1 partway through. That is most of what makes motion look designed rather than a linear slide. <C>bounce-out</C> settles with a series of decaying bounces. Because geometry can pass its target and come back, opacity is clamped where it is used, and <C>opacityEase</C> exists so opacity can stay linear while the geometry overshoots.
          </P>
        </section>

        {/* Sampling */}
        <section className="mb-10">
          <H2 id="sampling">Sampling</H2>
          <P>
            The resolver turns an animation into an opacity and, for kinds that move or rotate the clip, a concrete <C>Transform</C>. Renderers stay animation-unaware, so GPU preview and export agree. The same pure helpers are public, for custom previews and pickers:
          </P>
          <ul className="mb-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-on-surface-variant">
            <li>
              <C>sampleTextAnimation(args)</C> returns <C>{'{ opacity, transform? }'}</C> for one frame. <C>transform</C> is present only when the animation moves or rotates the clip. When it is absent, leave the clip&apos;s own transform alone.
            </li>
            <li>
              <C>resolveRampFrames(durationFrames)</C> clamps a stored ramp length to a whole number of frames of at least 1. Zero, negatives, fractions, <C>NaN</C> and <C>Infinity</C> all collapse safely.
            </li>
            <li>
              <C>motionForKind(kind, &apos;in&apos; | &apos;out&apos;)</C> returns the <C>MotionSpec</C> that one of the enum kinds is shorthand for.
            </li>
            <li>
              <C>TEXT_ANIMATION_KINDS</C> is the list of kinds with a <C>label</C> and an <C>appliesTo</C> of <C>&apos;both&apos;</C> or <C>&apos;text-only&apos;</C>.
            </li>
            <li>
              <C>DEFAULT_TEXT_TRANSFORM</C> and <C>DEFAULT_SHAPE_TRANSFORM</C> are the transforms the renderer applies to a clip that has none. Pass the right one as <C>defaultTransform</C>. They differ: a text clip defaults to <C>scale: 1</C>, a shape to <C>scale: 0.5</C>. <C>SLIDE_TRAVEL_NORMALIZED</C> (0.15) and <C>SPIN_TRAVEL_RADIANS</C> (a quarter turn) are the travel distances the enum kinds use.
            </li>
          </ul>
          <CodeBlock
            language="typescript"
            code={`import { sampleTextAnimation, DEFAULT_TEXT_TRANSFORM } from '@elah/editor'

const sample = sampleTextAnimation({
  animation: clip.textAnimation,
  localFrame: currentFrame - clip.startFrame, // frames since the clip started
  clipDurationFrames: clip.durationFrames,
  transform: clip.transform,
  defaultTransform: DEFAULT_TEXT_TRANSFORM,   // required, so it cannot be forgotten
})

const opacity = Math.min(clip.opacity ?? 1, sample.opacity)
const placed = sample.transform ?? clip.transform`}
          />
          <p className="mt-4 text-sm leading-relaxed text-on-surface-variant">
            The entry ramp covers the first <C>durationFrames</C> of the clip and the exit ramp the last. When the two overlap on a short clip, the opacity ramps take the minimum and the travel vectors add, so the clip passes smoothly through rest instead of popping at the crossover.
          </p>
        </section>

        {/* Built-in templates */}
        <section className="mb-10">
          <H2 id="built-in-templates">Built-in Templates</H2>
          <P>
            A text template is a named, applyable look: a style, a motion and sometimes a placement. <C>BUILT_IN_TEXT_TEMPLATES</C> holds 14, ordered as a picker should show them (general looks first, positional and decorative after). Look one up by id with <C>findTextTemplate(id)</C>, which returns <C>undefined</C> for an id the package does not ship.
          </P>
          <div className="mb-4 overflow-hidden rounded-md border border-outline-variant">
            {TEMPLATES.map(([name, id, description], i) => (
              <div
                key={id}
                className={`flex flex-col gap-1 border-b border-outline-variant p-3 last:border-0 sm:flex-row sm:items-start sm:gap-4 ${i % 2 === 0 ? 'bg-surface-low' : 'bg-surface-lowest'}`}
              >
                <div className="sm:w-40 sm:shrink-0">
                  <div className="text-xs font-medium text-on-surface">{name}</div>
                  <code className="font-mono text-2xs text-on-surface-variant">{id}</code>
                </div>
                <div className="text-xs leading-relaxed text-on-surface-variant">{description}</div>
              </div>
            ))}
          </div>
          <P>
            Each <C>TextTemplate</C> has an <C>id</C>, <C>name</C>, <C>description</C>, a <C>style</C> (<C>TextTemplateStyle</C>), an <C>animation</C> (<C>TextTemplateAnimation</C>) and optional <C>stagger</C>, <C>tracking</C> and <C>placement</C>. Templates describe their ramp as a fraction of the clip, <C>rampFraction</C>, and never touch <C>content</C>: applying one restyles the words, it does not rewrite them.
          </P>
          <div className="rounded-md border border-outline-variant bg-surface-low p-4">
            <div className="label-mono mb-1 text-2xs text-on-surface-variant opacity-90">Stagger and tracking are descriptive</div>
            <p className="text-xs leading-relaxed text-on-surface-variant">
              <C>stagger</C> (break one line into several clips that enter in turn) and <C>tracking: &apos;wide&apos;</C> (fake letterspacing by respacing the characters) are part of what makes some looks what they are, but a single clip cannot express either. <C>applyTextTemplate</C> ignores both, and nothing in the packages executes them. A host that builds a timeline from a template has to implement them itself.
            </p>
          </div>
        </section>

        {/* Apply template */}
        <section className="mb-10">
          <H2 id="apply-template">Applying a Template</H2>
          <P>
            <C>applyTextTemplate(template, clip)</C> is pure. It reads the clip and returns a <C>Partial&lt;Clip&gt;</C> patch. Hand the patch to <C>engine.updateClip</C> and the change lands on the undo stack and in the saved document like any other edit. Playback and export need nothing extra, because the patch is ordinary clip fields.
          </P>
          <CodeBlock
            language="typescript"
            code={`import { applyTextTemplate, findTextTemplate } from '@elah/editor'

const template = findTextTemplate('template-lower-third')
if (template) {
  engine.updateClip(clip.id, trackId, applyTextTemplate(template, clip))
}`}
          />
          <ul className="mt-4 mb-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-on-surface-variant">
            <li>
              <strong className="text-on-surface font-medium">Switching is clean, not cumulative.</strong> Every optional box field (<C>backgroundColor</C>, <C>backgroundOpacity</C>, <C>padding</C>, <C>borderRadius</C>, <C>borderWidth</C>, <C>borderColor</C>) is present in the patch, set to <C>undefined</C> when the template does not use it. Quote (a panel) followed by Title Card (no panel) does not leave the panel behind. The author&apos;s own edits to those fields are replaced, which is what applying a template means.
            </li>
            <li>
              <strong className="text-on-surface font-medium">Placement merges.</strong> A template that sets <C>placement</C> overrides only x and y, keeping the clip&apos;s scale, rotation and anchor. A clip with no transform starts from <C>DEFAULT_TEXT_TRANSFORM</C>, so it does not jump. This is correct for text clips only, because shapes default to a different scale.
            </li>
            <li>
              <strong className="text-on-surface font-medium">The ramp is resolved per clip.</strong> The patch carries <C>textAnimation</C> with <C>inMotion</C>, <C>outMotion</C> and a <C>durationFrames</C> computed for this clip&apos;s length.
            </li>
          </ul>
          <P>
            <C>resolveTemplateRamp(rampFraction, clipDurationFrames)</C> is that computation, public for hosts that build a timeline from a template instead of applying one to a selected clip. It returns a whole number of frames that is at most half the clip, at most <C>MAX_TEMPLATE_RAMP_FRAMES</C> (30) and at least <C>MIN_TEMPLATE_RAMP_FRAMES</C> (1). Half the clip is the cap because beyond it the entry and exit overlap and the text never reaches full opacity.
          </P>
        </section>

        {/* Style presets */}
        <section className="mb-10">
          <H2 id="style-presets">Style Presets</H2>
          <P>
            A <C>TextStylePreset</C> is smaller than a template: six style fields (<C>fontFamily</C>, <C>fontWeight</C>, <C>fontSize</C>, <C>textAlign</C>, <C>color</C>, <C>opacity</C>) plus an <C>id</C> and <C>name</C>. It cannot express motion, placement or a background chip. The two coexist: presets are the quick &ldquo;restyle these glyphs&rdquo; affordance, and templates are the production-ready unit.
          </P>
          <ul className="mb-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-on-surface-variant">
            <li>
              <C>BUILT_IN_TEXT_STYLE_PRESETS</C> is a plain array of five looks (Subtitle, Title, Caption, Elegant, Highlight). It is not stored and not removable.
            </li>
            <li>
              <C>textStylePresetsStore</C> holds the user-saved ones. It starts empty and has <C>addPreset(preset)</C>, which assigns the <C>id</C>, and <C>removePreset(id)</C>. It does no persistence of its own.
            </li>
            <li>
              In React, use <C>useTextStylePresetsStore</C> from <Link href="/docs/react#load-and-presets" className="text-primary hover:underline">@elah/react</Link>.
            </li>
          </ul>
          <CodeBlock
            language="typescript"
            code={`import {
  BUILT_IN_TEXT_STYLE_PRESETS,
  textStylePresetsStore,
} from '@elah/editor'

// Save the clip's current look as a preset.
textStylePresetsStore.getState().addPreset({
  name: 'My title',
  fontFamily: 'Impact',
  fontWeight: 'bold',
  fontSize: 72,
  textAlign: 'center',
  color: '#ffffff',
  opacity: 1,
})

// Apply a preset: copy its style fields onto the clip.
const { id, name, ...style } = BUILT_IN_TEXT_STYLE_PRESETS[0]
engine.updateClip(clip.id, trackId, style)`}
          />
        </section>
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
