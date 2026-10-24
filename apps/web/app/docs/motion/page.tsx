import type { Metadata } from 'next'
import Link from 'next/link'
import { CodeBlock } from '@/components/docs/CodeBlock'
import { DocsToc } from '@/components/docs/DocsToc'
import { PageHeader } from '@/components/site/PageHeader'

export const metadata: Metadata = {
  title: 'Motion',
  description:
    'Keyframes on every transform channel, easing and springs, expressions, text animators, stagger, motion paths and 3D tilt for media. Every key is plain data with an id.',
  alternates: { canonical: '/docs/motion' },
}

const toc = [
  { id: 'keyframes', title: 'Keyframes', level: 2 },
  { id: 'easing', title: 'Easing and springs', level: 2 },
  { id: 'expressions', title: 'Expressions', level: 2 },
  { id: 'stagger', title: 'Stagger, repeat and yoyo', level: 2 },
  { id: 'text', title: 'Text animators', level: 2 },
  { id: 'paths', title: 'Motion paths', level: 2 },
  { id: 'tilt', title: '3D tilt', level: 2 },
  { id: 'editing', title: 'Editing keys', level: 2 },
]

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20">
      {children}
    </h2>
  )
}

function C({ children }: { children: React.ReactNode }) {
  return <code className="bg-surface-container px-1.5 py-0.5 text-xs font-mono">{children}</code>
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">{children}</p>
}

export default function MotionDocsPage() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
      <article className="min-w-0 max-w-3xl flex-1">
        <PageHeader
          variant="doc"
          eyebrow="Motion"
          title="Motion"
          lede={
            <>
              Animation is data on the clip. Every animated property is a channel with keys, and every key has an id, a frame, a value and an easing. Coming in 1.0.
            </>
          }
        />

        <section className="mb-10">
          <H2 id="keyframes">Keyframes</H2>
          <P>
            Keyframes can be set on x, y, scale, scaleX, scaleY, rotation, skewX, skewY, rotateX, rotateY, opacity, volume and cornerRadius, and on effect parameters (<C>fx.*</C>), generator parameters, masks and draw-on. Frames are integers relative to the clip&apos;s start, so moving a clip moves its keys, and trim, speed and split remap them.
          </P>
          <CodeBlock
            language="typescript"
            code={`engine.updateClip(title.id, trackId, {
  keyframes: {
    channels: {
      x: {
        source: { kind: 'keyframes' },
        keys: [
          { id: 'k0', frame: 0, value: 0.2, easing: 'linear' },
          { id: 'k1', frame: 30, value: 0.8, easing: 'back-out' }, // the curve INTO this key
        ],
      },
    },
  },
})`}
          />
        </section>

        <section className="mb-10">
          <H2 id="easing">Easing and springs</H2>
          <P>
            A key&apos;s <C>easing</C> is one of <C>TEXT_ANIMATION_EASINGS</C>: sine, quad, cubic, quart, quint, expo, circ, back, elastic and bounce, each in, out and in-out, plus <C>linear</C>. A key can instead carry a raw <C>easingBezier</C> (any cubic-bezier), <C>steps</C>, <C>hold</C>, or a closed-form <C>spring</C> from <C>SPRING_PRESETS</C> (gentle, snappy, bouncy, stiff, wobbly).
          </P>
        </section>

        <section className="mb-10">
          <H2 id="expressions">Expressions</H2>
          <P>
            <C>setChannelExpression</C> drives a channel from an expression such as <C>wiggle</C>, <C>loop</C> or <C>sin</C>.
          </P>
        </section>

        <section className="mb-10">
          <H2 id="stagger">Stagger, repeat and yoyo</H2>
          <P>
            <C>staggerOffsets</C> offsets keys from the start, end, centre or edges, at random, or across a grid. <C>repeatKeysPatch</C> writes repeat and yoyo. In HTML scenes and motion presets these are available directly.
          </P>
        </section>

        <section className="mb-10">
          <H2 id="text">Text animators</H2>
          <P>
            Text can be animated by character, word or line, each with its own tweens, and <C>scrambleText</C> scrambles text into place.
          </P>
        </section>

        <section className="mb-10">
          <H2 id="paths">Motion paths</H2>
          <P>
            A clip can travel an SVG path (the <C>motion.progress</C> channel) and orient to it. Path morph and draw-on strokes are keyable too.
          </P>
        </section>

        <section className="mb-10">
          <H2 id="tilt">3D tilt</H2>
          <P>
            <C>rotateX</C> and <C>rotateY</C> give 3D tilt for media and groups: video, image, sequence and compound clips. Text, shapes and freehand clips refuse them.
          </P>
        </section>

        <section className="mb-10">
          <H2 id="editing">Editing keys</H2>
          <P>
            Keyframes are plain data: every key has an id you can read, write and diff. In the open-source editor you edit them through the API (<C>setKeyframe</C>) or the project JSON. See the{' '}
            <Link href="/playground/motion" className="text-primary hover:underline">motion playground</Link> for a keys table and{' '}
            <Link href="/docs/scenes" className="text-primary hover:underline">HTML scenes and VideoSpec</Link> for writing motion as code.
          </P>
        </section>
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
