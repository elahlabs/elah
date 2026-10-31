import type { Metadata } from 'next'
import Link from 'next/link'
import { DocsToc } from '@/components/docs/DocsToc'
import { Code } from '@/components/docs/Code'
import { C, Callout, DocsPager, H2, P, PropTable } from '@/components/docs/DocsKit'
import { LazyDemo } from '@/components/home/LazyDemo'
import { PageHeader } from '@/components/site/PageHeader'
import { label } from '@/components/eb'
import type { DemoName } from '@/lib/demos/load'

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

const link = 'text-on-surface underline decoration-[#FF003C] underline-offset-4 hover:decoration-2'

/** A small live engine demo with a caption, as on the homepage's capability cards. */
function Demo({ name, caption, timeline = false }: { name: DemoName; caption: string; timeline?: boolean }) {
  return (
    <figure className="my-6 border border-outline-variant">
      {/* The small demos sit at monitor size on a dark band, so seven of them do not swamp the page. */}
      <div className={timeline ? '' : 'bg-[var(--lp-stage)] px-6 py-5'}>
        <div className={timeline ? '' : 'mx-auto max-w-[440px]'}>
          <LazyDemo name={name} timeline={timeline} showKeys={timeline} timelineHeight={130} minHeight={timeline ? 380 : 248} label={caption} />
        </div>
      </div>
      <figcaption className={`border-t border-outline-variant px-4 py-2.5 text-on-surface-variant ${label}`}>{caption}</figcaption>
    </figure>
  )
}

export default function MotionDocsPage() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
      <article className="min-w-0 max-w-3xl flex-1">
        <PageHeader
          variant="doc"
          eyebrow="Motion"
          title="Motion"
          lede="Animation is plain data on the clip. Every animated property is a channel of keys, and every key has an id, a frame, a value and an easing."
        />

        <H2 id="keyframes">Keyframes</H2>
        <P>
          Add keys to a channel, and the engine fills in every frame between them. This moves a title from the left to the right over one second,
          overshooting a little at the end:
        </P>
        <Code
          highlight={[7, 8]}
          code={`
engine.updateClip(title.id, trackId, {
  keyframes: {
    channels: {
      x: {
        source: { kind: 'keyframes' },
        keys: [
          { id: 'k0', frame: 0, value: 0.2, easing: 'linear' },
          { id: 'k1', frame: 30, value: 0.8, easing: 'back-out' },
        ],
      },
    },
  },
})`}
        />
        <Callout title="A key's easing is the curve into that key">
          In the example, <C>back-out</C> on <C>k1</C> shapes the move from <C>k0</C> to <C>k1</C>.
        </Callout>
        <Demo name="hero" timeline caption="Each diamond on the timeline is a key" />
        <PropTable
          nameLabel="Channels"
          rows={[
            { name: 'x · y', desc: 'Position, as a fraction of the stage.' },
            { name: 'scale · scaleX · scaleY', desc: 'Size.' },
            { name: 'rotation · skewX · skewY', desc: 'Turn and slant.' },
            { name: 'rotateX · rotateY', desc: '3D tilt, for media clips. See 3D tilt below.' },
            { name: 'opacity · volume · cornerRadius', desc: 'Fade, loudness and rounded corners.' },
            { name: 'fx.*', desc: 'Effect parameters, plus generator parameters, masks and draw-on.' },
          ]}
        />
        <Callout title="Keys move with the clip">
          Frames are whole numbers counted from the clip&apos;s start. Moving a clip moves its keys, and trimming, changing speed or splitting
          remaps them.
        </Callout>

        <H2 id="easing">Easing and springs</H2>
        <P>
          A key&apos;s <C>easing</C> is one of the named curves (all 31 are drawn on{' '}
          <Link href="/docs/text-templates-and-motion#easings" className={link}>
            Text Templates &amp; Motion
          </Link>
          ). For anything else, a key can carry one of these instead:
        </P>
        <PropTable
          nameLabel="Key field"
          rows={[
            { name: 'spring', type: 'KeyframeSpring', desc: <>A physical spring. Wins over everything else. <C>SPRING_PRESETS</C> has five: gentle, snappy, bouncy, stiff and wobbly.</> },
            { name: 'easingBezier', type: '[x1, y1, x2, y2]', desc: 'Any cubic-bezier curve, as in CSS. Wins over steps and easing.' },
            { name: 'steps', type: 'number', desc: 'A staircase of 1 to 64 jumps. Wins over easing.' },
            { name: 'hold', type: 'true', desc: 'Stay on the previous value, then jump.' },
          ]}
        />
        <Demo name="easing" caption="Easing curves, rendered by the engine" />

        <H2 id="expressions">Expressions</H2>
        <P>
          An expression computes a channel from a small formula instead of keys. This makes a clip wobble gently, forever:
        </P>
        <Code
          highlight={[4]}
          code={`
import { setChannelExpression } from '@elah/editor'

const ctx = { stage: engine.getProject().stage }
const patch = setChannelExpression(clip, 'rotation', 'wiggle(2, 0.05)', ctx)
engine.updateClip(clip.id, trackId, patch)`}
        />
        <Demo name="expressions" caption="Channels driven by expressions" />
        <P>Expressions can read these values:</P>
        <PropTable
          nameLabel="Name"
          rows={[
            { name: 't · frame · fps', desc: 'Seconds and frames since the clip started, and the frame rate.' },
            { name: 'duration · progress', desc: 'Clip length in seconds, and 0 to 1 across the clip.' },
            { name: 'value', desc: 'What the keys say at this frame, so value + wiggle(2, 0.02) adds wobble on top.' },
            { name: 'stage.width · stage.height', desc: 'The stage size.' },
            { name: 'clip("id or name").x', desc: 'Another clip’s x, y, scale, rotation, opacity, start or duration.' },
            { name: 'PI', desc: 'π.' },
          ]}
        />
        <P>
          And call these functions: <C>sin</C> <C>cos</C> <C>abs</C> <C>floor</C> <C>ceil</C> <C>round</C> <C>sqrt</C> <C>exp</C> <C>log</C>{' '}
          <C>pow</C> <C>min</C> <C>max</C> <C>clamp</C> <C>lerp</C> <C>smoothstep</C> <C>wiggle</C> <C>spring</C> <C>ease</C> <C>loop</C>{' '}
          <C>pingpong</C> <C>pulse</C> <C>clip</C> <C>prop</C> <C>audio</C>.
        </P>
        <Callout title="Same result everywhere">
          Expressions are not JavaScript. There is no random number or clock, and <C>wiggle</C> is seeded per clip and channel, so a project
          renders the same frames on every machine. Pass <C>null</C> to remove an expression and go back to the keys.
        </Callout>

        <H2 id="stagger">Stagger, repeat and yoyo</H2>
        <P>
          <C>staggerOffsets</C> spreads a start delay across a set of items: one after another, from the centre out, from the edges in, at
          random, or across a grid.
        </P>
        <Code
          code={`
import { staggerOffsets } from '@elah/editor'

staggerOffsets(5, { each: 3, from: 'start' })  // delays in frames: [0, 3, 6, 9, 12]
staggerOffsets(5, { each: 3, from: 'center' }) // the middle item goes first`}
        />
        <Demo name="stagger" caption="Staggered entries" />
        <P>
          <C>repeatKeysPatch</C> repeats a span of keys, optionally reversing every other pass (yoyo), and returns the change to apply:
        </P>
        <Code
          highlight={[2]}
          code={`
import { repeatKeysPatch } from '@elah/editor'

const { patch } = repeatKeysPatch(clip, 'y', { from: 0, to: 30, count: 3, yoyo: true })
engine.updateClip(clip.id, trackId, patch)`}
        />
        <P>
          <C>count</C> is the extra plays after the first; <C>Infinity</C> fills to the end of the clip. <C>gapFrames</C> adds a rest between
          passes. In{' '}
          <Link href="/docs/scenes" className={link}>
            HTML scenes
          </Link>{' '}
          and motion presets, stagger and repeat are available directly.
        </P>

        <H2 id="text">Text animators</H2>
        <P>
          Text can animate by character, word or line, each piece with its own movement, and <C>scrambleText</C> resolves random characters into
          the real words.
        </P>
        <Demo name="text" caption="Text animated character by character" />

        <H2 id="paths">Motion paths</H2>
        <P>
          A clip can travel along an SVG path and turn to face its direction. Its position on the path is the <C>motion.progress</C> channel, so
          you key it like anything else. Path shapes (morph) and drawn-on strokes are keyable too.
        </P>
        <Demo name="path" caption="A clip following a path" />

        <H2 id="tilt">3D tilt</H2>
        <P>
          <C>rotateX</C> and <C>rotateY</C> tilt a clip in 3D. They work on video, image, sequence and compound clips.
        </P>
        <Demo name="tilt" caption="Media tilted in 3D" />
        <Callout kind="warning" title="Text, shapes and drawings cannot tilt">
          Text, shape and freehand clips refuse <C>rotateX</C> and <C>rotateY</C>.
        </Callout>

        <H2 id="editing">Editing keys</H2>
        <P>
          Every key has an id you can read, write and compare. <C>setKeyframe</C> adds a key, or replaces the one already on that frame, and
          returns the change to apply:
        </P>
        <Code
          highlight={[4]}
          code={`
import { setKeyframe } from '@elah/editor'

const ctx = { stage: engine.getProject().stage }
const patch = setKeyframe(clip, 'x', 30, ctx, 0.8, { easing: 'back-out' })
engine.updateClip(clip.id, trackId, patch)`}
        />
        <P>
          Leave out the value and the key records what the clip shows right now, like clicking the diamond in an editor. To try it by hand, the{' '}
          <Link href="/playground/motion" className={link}>
            motion playground
          </Link>{' '}
          has a table of every key. To write motion as code, see{' '}
          <Link href="/docs/scenes" className={link}>
            HTML scenes and VideoSpec
          </Link>
          .
        </P>

        <DocsPager href="/docs/motion" />
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
