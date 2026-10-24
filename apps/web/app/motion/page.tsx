import type { Metadata } from 'next'
import Link from 'next/link'
import { Navbar } from '@/components/marketing/Navbar'
import { Footer } from '@/components/marketing/Footer'
import { PageHeader } from '@/components/site/PageHeader'
import { CodeBlock } from '@/components/docs/CodeBlock'
import { MotionBindingDemo } from '@/components/motion/MotionBindingDemo'

export const metadata: Metadata = {
  title: 'Motion',
  description:
    'Write motion as code and it lands on the timeline as ordinary clips and keyframes. Open it, change any key, and export an MP4 in the browser.',
  alternates: { canonical: '/motion' },
}

const capabilities: { title: string; text: string; code: string; note?: string }[] = [
  {
    title: 'Easing and springs',
    text: 'Named eases including back, elastic and bounce, any cubic-bezier, closed-form springs, steps(n) and hold keys.',
    code: `{ id: 'k1', frame: 30, value: 0.8, easing: 'back-out' }`,
  },
  {
    title: 'Stagger',
    text: 'Stagger from the start, centre, end or edges, at random, or across a grid, with repeat and yoyo, labels and relative positions.',
    code: `stagger: children 4f`,
    note: 'In HTML scenes and motion presets.',
  },
  {
    title: 'Text animators',
    text: 'Animate text by character, word or line, or scramble it into place.',
    code: `split: word 3f; each: y: 0.5 -> 0 0.5s quad-out`,
  },
  {
    title: 'Motion paths',
    text: 'A clip travels an SVG path. Path morph and draw-on strokes are keys too.',
    code: `path: (M 100 900 C 300 200 700 200 900 900) orient`,
  },
  {
    title: 'Expressions',
    text: 'Drive a channel with wiggle, loop, sin and friends.',
    code: `wiggle(freq, amp)  // value + noise`,
    note: 'An expression on a channel, set with setChannelExpression.',
  },
  {
    title: '3D tilt for media and groups',
    text: 'rotateX and rotateY with perspective on video, image, sequence and compound clips.',
    code: `channels: { rotateY: { source: { kind: 'keyframes' }, keys: [ /* … */ ] } }`,
  },
  {
    title: 'Motion presets',
    text: 'Presets expand into real keyframes, so you can change them after.',
    code: `in: pop-in 0.4s @0.2`,
  },
  {
    title: 'Effects and transitions',
    text: 'GPU effects, nine transitions, compound and sequence clips, Lottie and SVG import.',
    code: `channels: { 'fx.<effect>.<param>': { source: { kind: 'keyframes' }, keys: [ /* … */ ] } }`,
    note: 'Effect parameters are keyable channels.',
  },
]

export default function MotionPage() {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <Navbar />
      <main id="main" className="flex-1">
        <PageHeader
          eyebrow="Motion"
          title="Write it like a web page, edit it like a timeline, render it in the browser."
          lede={
            <>
              Code, or a model, describes the motion. Elah converts it into native clips and keyframes: not a video, not a black-box layer. Every animated property is a channel on a clip, with keys that have ids, frames, values and an easing. Coming in 1.0.
            </>
          }
        >
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/playground/motion" className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-on-primary">
              Try the motion playground
            </Link>
            <Link href="/docs/motion" className="rounded-full border border-outline-variant px-5 py-2.5 text-sm font-medium text-on-surface hover:bg-surface-container">
              Read the docs
            </Link>
          </div>
        </PageHeader>

        <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6" aria-labelledby="binding">
          <h2 id="binding" className="mb-2 text-2xl font-semibold tracking-tight text-on-surface">
            The motion is bound to the timeline
          </h2>
          <p className="mb-6 max-w-2xl text-sm leading-relaxed text-on-surface-variant">
            The same animation, three ways: the source you write, the keys it lands as, and the clip on a track. Hover a row in Keys to jump to that key. The same project plays in the preview and exports to MP4 in the browser.
          </p>
          <MotionBindingDemo />
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-12 sm:px-6" aria-labelledby="capabilities">
          <h2 id="capabilities" className="mb-6 text-2xl font-semibold tracking-tight text-on-surface">
            Capabilities
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {capabilities.map((c) => (
              <article key={c.title} className="flex min-w-0 flex-col gap-3 rounded-md border border-outline-variant bg-surface-low p-5">
                <h3 className="text-base font-semibold text-on-surface">{c.title}</h3>
                <p className="text-sm leading-relaxed text-on-surface-variant">
                  {c.text} {c.note}
                </p>
                <div className="min-w-0 overflow-x-auto">
                  <CodeBlock language="typescript" code={c.code} />
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-12 sm:px-6" aria-labelledby="model">
          <h2 id="model" className="mb-2 text-2xl font-semibold tracking-tight text-on-surface">
            From a model
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-on-surface-variant">
            A model writes a VideoSpec or an HTML scene. Because Elah converts it into ordinary clips and keyframes, the output stays editable: you can inspect, retime, split and diff it like any other data. Both layers are experimental. See{' '}
            <Link href="/docs/agents" className="text-primary hover:underline">For AI agents</Link> and{' '}
            <Link href="/docs/scenes" className="text-primary hover:underline">HTML scenes and VideoSpec</Link>.
          </p>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-12 sm:px-6" aria-labelledby="export">
          <h2 id="export" className="mb-2 text-2xl font-semibold tracking-tight text-on-surface">
            Export
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-on-surface-variant">
            Export to MP4 runs in the browser, in Chrome or Edge. There is no render server, so no render bill, and your footage is never uploaded.
          </p>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6" aria-labelledby="limits">
          <h2 id="limits" className="mb-2 text-2xl font-semibold tracking-tight text-on-surface">
            Limits
          </h2>
          <ul className="max-w-2xl list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-on-surface-variant">
            <li>Export needs a Chromium browser (Chrome or Edge). Effects and the six newer transitions need WebGL2.</li>
            <li>Keyframes are plain data: every key has an id you can read, write and diff. The open-source editor has no visual keyframe editor yet.</li>
            <li>HTML scenes, VideoSpec and edit operations are experimental and may change in minor releases.</li>
            <li>3D tilt works on media and groups, not on text or shapes.</li>
          </ul>
        </section>
      </main>
      <Footer />
    </div>
  )
}
