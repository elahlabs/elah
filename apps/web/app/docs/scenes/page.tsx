import type { Metadata } from 'next'
import Link from 'next/link'
import { DocsToc } from '@/components/docs/DocsToc'
import { Code } from '@/components/docs/Code'
import { C, Callout, DocsPager, H2, H3, P, PropTable } from '@/components/docs/DocsKit'
import { LazyDemo } from '@/components/home/LazyDemo'
import { PageHeader } from '@/components/site/PageHeader'
import { label } from '@/components/eb'

export const metadata: Metadata = {
  title: 'HTML scenes and VideoSpec',
  description:
    'Live in 1.0: write a scene as HTML and CSS or as VideoSpec JSON, and convert it to native clips and keyframes with @elah/core/html and @elah/core/spec.',
  alternates: { canonical: '/docs/scenes' },
}

const toc = [
  { id: 'which', title: 'Which one?', level: 2 },
  { id: 'html', title: 'HTML scenes', level: 2 },
  { id: 'videospec', title: 'VideoSpec', level: 2 },
  { id: 'ops', title: 'Edit operations', level: 2 },
]

const link = 'text-on-surface underline decoration-[#FF003C] underline-offset-4 hover:decoration-2'

export default function ScenesDocsPage() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
      <article className="min-w-0 max-w-3xl flex-1">
        <PageHeader
          variant="doc"
          eyebrow="Motion"
          title="HTML scenes and VideoSpec"
          lede="Two ways for you, or a model, to write a video as code. Either way it lands on the timeline as ordinary clips and keyframes that stay editable."
        />

        <H2 id="which">Which one?</H2>
        <PropTable
          nameLabel="Format"
          rows={[
            {
              name: 'HTML scene',
              type: "import from '@elah/core/html'",
              desc: 'HTML and CSS, with motion in a one-line data-motion attribute. Best when you think in layout and CSS, or when a model already writes good HTML.',
            },
            {
              name: 'VideoSpec',
              type: "import from '@elah/core/spec'",
              desc: 'A JSON document timed in seconds, with no browser step. Best for generating whole videos, from templates or from a model.',
            },
          ]}
        />
        <P>
          Both are separate entry points, so an app that does not import them does not ship them.
        </P>

        <H2 id="html">HTML scenes</H2>
        <P>
          Write a scene in a supported subset of HTML and CSS, and describe the motion of each element in its <C>data-motion</C> attribute. This
          is the title card from the{' '}
          <Link href="/playground/motion" className={link}>
            motion playground
          </Link>
          :
        </P>
        <Code
          lang="html"
          title="scene.html"
          highlight={[3]}
          code={`
<section id="tc" data-scene="title-card" data-at="0" data-duration="4">
  <div id="bar" data-motion="in: slide-in-left 0.5s @0.1"></div>
  <h1 id="title" data-motion="split: word 3f; each: y: 0.5 -> 0 0.5s quad-out; each: opacity: 0 -> 1 0.5s quad-out">Quarterly results</h1>
  <p id="sub" data-motion="in: fade-in 0.6s @0.9">Revenue up 24 percent on the year</p>
</section>`}
        />
        <Code
          lang="css"
          title="scene.css"
          code={`
#tc { position: relative; width: 1920px; height: 1080px; background-color: #0d1117; }
#bar { position: absolute; left: 160px; top: 380px; width: 24px; height: 300px; background-color: #00c2ff; border-radius: 12px; }
#title { position: absolute; left: 230px; top: 360px; width: 1500px; margin: 0; font-family: bebas-neue; font-size: 200px; color: #ffffff; }
#sub { position: absolute; left: 234px; top: 590px; width: 1400px; margin: 0; font-family: inter; font-size: 52px; color: #9ca3af; }`}
        />

        <H3>The data-motion grammar</H3>
        <P>One line per element, clauses separated by semicolons. Times are in seconds, and <C>@</C> says when a clause starts.</P>
        <PropTable
          nameLabel="Clause"
          rows={[
            { name: 'in: fade-in 0.6s @0.9', desc: 'An entry preset, its length, and when it starts.' },
            { name: 'out: fade-out 0.3s @-0.3', desc: 'An exit preset. A negative time counts back from the end of the scene.' },
            { name: 'y: 0.5 -> 0 0.5s quad-out', desc: 'Animate one channel from a value to a value, with an easing curve.' },
            { name: 'split: word 3f; each: …', desc: 'Split the text into words (or char, or line), each piece starting 3 frames after the last, and give every piece the each: clauses.' },
            { name: 'scramble: 0 -> 1 1.2s quad-out', desc: 'Resolve random characters into the real text.' },
          ]}
        />

        <H3>Convert it</H3>
        <Code
          highlight={[3, 8]}
          code={`
import { validateScene, sceneToClip } from '@elah/core/html'

const { ok, violations } = validateScene({ html, css })
if (!ok) return violations // each one names the supported alternative

// Lay the scene out in a browser and measure it (your step), then:
const measured = measureInBrowser(html, css)
const { clip, report } = sceneToClip(measured, { fps: 30 })`}
        />
        <P>
          The result is one compound clip containing native shape, text and image clips with their keys. <C>report</C> lists what was converted,
          skipped or substituted.
        </P>
        <Callout kind="warning" title="You measure the scene">
          The package does not include a DOM measurer. Render the HTML and CSS in a browser, measure each element, and pass the result to{' '}
          <C>sceneToClip</C>. The motion playground does exactly this.
        </Callout>
        <Callout title="Unsupported CSS is refused, not guessed">
          <C>validateScene</C> rejects anything outside the subset, and every violation names what to use instead. That is deliberate: a scene
          never silently renders differently from what you wrote.
        </Callout>

        <H2 id="videospec">VideoSpec</H2>
        <P>
          A VideoSpec describes a whole video as JSON: format, colours and fonts, then elements with a start time and duration in seconds. This is
          part of the spec behind the demo below, the same one on the homepage:
        </P>
        <Code
          title="heroSpec (excerpt)"
          highlight={[9, 10, 11, 12]}
          code={`
{
  version: 1,
  title: 'Motion as code',
  format: { width: 1280, height: 720, fps: 30 },
  duration: 8,
  background: '$bg',
  design: { colors: [/* bg, ink, accent… */], fonts: [/* sans, display… */] },
  elements: [
    { id: 'bar', kind: 'shape', shape: 'rect', at: 0, duration: 8, w: 14, h: 230,
      fill: '$accent', x: 0.1, y: 0.4, enter: 'slide-in-left' },
    { id: 'title', kind: 'text', at: 0.2, duration: 7.6, text: 'Motion as code',
      font: '$display', size: 120, reveal: { preset: 'word-rise', stagger: 0.12 } },
  ],
}`}
        />
        <figure className="my-6 border border-outline-variant">
          <LazyDemo name="hero" timelineHeight={140} minHeight={460} label="The hero VideoSpec, built and playing" />
          <figcaption className={`border-t border-outline-variant px-4 py-2.5 text-on-surface-variant ${label}`}>
            The spec above, built into clips and keys
          </figcaption>
        </figure>
        <Code
          highlight={[3, 5]}
          code={`
import { buildVideo, layProject } from '@elah/core/spec'

const { project, issues } = buildVideo(spec)
// issues lists anything that was wrong or adjusted; it never throws.
layProject(engine, project) // onto a live editor, as one undo step`}
        />
        <PropTable
          nameLabel="Export"
          rows={[
            { name: 'buildVideo(spec)', desc: <>Expands components and polish, then compiles. Returns <C>{'{ project, issues }'}</C> and more.</> },
            { name: 'compileVideoSpec(spec)', desc: <>Compiles a spec as written, without expansion. Returns <C>{'{ project, issues }'}</C>; never throws.</> },
            { name: 'layProject(engine, project)', desc: 'Puts a built project onto a live engine as one undo step.' },
            { name: 'specVocabulary()', desc: 'The whole vocabulary (elements, fonts, presets) as text, ready to put in a model’s prompt.' },
          ]}
        />

        <H2 id="ops">Edit operations</H2>
        <P>
          To let a model edit an existing project, use the typed operations in <C>@elah/core/ops</C>. <C>sanitizeOps</C> repairs whatever list the
          model returns and drops what it cannot fix, and <C>applyOps</C> applies it as one undo step.
        </P>
        <Code
          code={`
import { sanitizeOps, applyOps } from '@elah/core/ops'

const { ops, dropped } = sanitizeOps(modelOutput, engine.getProject())
// dropped lists each op that could not be repaired, and why.
applyOps(engine, ops)`}
        />
        <P>
          More in{' '}
          <Link href="/docs/agents" className={link}>
            For AI agents
          </Link>
          .
        </P>

        <DocsPager href="/docs/scenes" />
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
