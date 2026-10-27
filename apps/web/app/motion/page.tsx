import type { Metadata } from 'next'
import Link from 'next/link'
import { Navbar } from '@/components/marketing/Navbar'
import { Footer } from '@/components/marketing/Footer'
import { PageHeader } from '@/components/site/PageHeader'
import { CodeBlock } from '@/components/docs/CodeBlock'
import { MotionBindingDemo } from '@/components/motion/MotionBindingDemo'
import {
  ButtonLink, Slate, cardBody, cardLight, cardTitle, container, h2, lead, sectionY,
} from '@/components/eb'

const textLink = 'text-on-surface underline decoration-primary underline-offset-4 hover:bg-surface-container'

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

function SectionHead({ id, title, children }: { id: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex max-w-[900px] flex-col gap-5">
      <h2 id={id} className={h2}>
        {title}
      </h2>
      {children ? <div className={`${lead} max-w-[640px]`}>{children}</div> : null}
    </div>
  )
}

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
            <ButtonLink href="/playground/motion" size="sm">
              Try the motion playground
            </ButtonLink>
            <ButtonLink href="/docs/motion" variant="secondary" size="sm">
              Read the docs
            </ButtonLink>
          </div>
        </PageHeader>

        <section className={`${container} pt-12 ${sectionY}`} aria-labelledby="binding">
          <Slate n={1} label="Binding" kicker="Source · Keys · Clip" />
          <div className="flex flex-col gap-10 pt-10">
            <SectionHead id="binding" title="The motion is bound to the timeline">
              The same animation, three ways: the source you write, the keys it lands as, and the clip on a track. Hover a row in Keys to jump to that key. The same project plays in the preview and exports to MP4 in the browser.
            </SectionHead>
            <MotionBindingDemo />
          </div>
        </section>

        <section className={`${container} ${sectionY}`} aria-labelledby="capabilities">
          <Slate n={2} label="Capabilities" />
          <div className="flex flex-col gap-10 pt-10">
            <SectionHead id="capabilities" title="Capabilities" />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {capabilities.map((c) => (
                <article key={c.title} className={`${cardLight} min-w-0`}>
                  <h3 className={cardTitle}>{c.title}</h3>
                  <p className={cardBody}>
                    {c.text} {c.note}
                  </p>
                  <div className="min-w-0 overflow-x-auto">
                    <CodeBlock language="typescript" code={c.code} />
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={`${container} ${sectionY}`} aria-labelledby="model">
          <Slate n={3} label="Model" kicker="Experimental" />
          <div className="pt-10">
            <SectionHead id="model" title="From a model">
              A model writes a VideoSpec or an HTML scene. Because Elah converts it into ordinary clips and keyframes, the output stays editable: you can inspect, retime, split and diff it like any other data. Both layers are experimental. See{' '}
              <Link href="/docs/agents" className={textLink}>For AI agents</Link> and{' '}
              <Link href="/docs/scenes" className={textLink}>HTML scenes and VideoSpec</Link>.
            </SectionHead>
          </div>
        </section>

        <section className={`${container} ${sectionY}`} aria-labelledby="export">
          <Slate n={4} label="Export" kicker="Chrome · Edge" />
          <div className="pt-10">
            <SectionHead id="export" title="Export">
              Export to MP4 runs in the browser, in Chrome or Edge. There is no render server, so no render bill, and your footage is never uploaded.
            </SectionHead>
          </div>
        </section>

        <section className={`${container} ${sectionY}`} aria-labelledby="limits">
          <Slate n={5} label="Limits" />
          <div className="flex flex-col gap-8 pt-10">
            <SectionHead id="limits" title="Limits" />
            <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-2">
              {[
                'Export needs a Chromium browser (Chrome or Edge). Effects and the six newer transitions need WebGL2.',
                'Keyframes are plain data: every key has an id you can read, write and diff. The open-source editor has no visual keyframe editor yet.',
                'HTML scenes, VideoSpec and edit operations are experimental and may change in minor releases.',
                '3D tilt works on media and groups, not on text or shapes.',
              ].map((t) => (
                <li key={t} className={cardLight}>
                  <p className={cardBody}>{t}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
