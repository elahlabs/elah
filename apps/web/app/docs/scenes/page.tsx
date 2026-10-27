import type { Metadata } from 'next'
import Link from 'next/link'
import { CodeBlock } from '@/components/docs/CodeBlock'
import { DocsToc } from '@/components/docs/DocsToc'
import { PageHeader } from '@/components/site/PageHeader'

export const metadata: Metadata = {
  title: 'HTML scenes and VideoSpec',
  description:
    'Experimental: write a scene as HTML and CSS or as VideoSpec JSON, and convert it to native clips and keyframes with @elah/core/html and @elah/core/spec.',
  alternates: { canonical: '/docs/scenes' },
}

const toc = [
  { id: 'html', title: 'HTML scenes', level: 2 },
  { id: 'videospec', title: 'VideoSpec', level: 2 },
  { id: 'ops', title: 'Edit operations', level: 2 },
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

function Experimental() {
  return (
    <span className="ml-2 border border-outline-variant px-1.5 py-0.5 align-middle text-2xs font-mono uppercase tracking-wider text-on-surface-variant">
      Experimental
    </span>
  )
}

export default function ScenesDocsPage() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
      <article className="min-w-0 max-w-3xl flex-1">
        <PageHeader
          variant="doc"
          eyebrow="Motion"
          title={
            <>
              HTML scenes and VideoSpec
              <Experimental />
            </>
          }
          lede={
            <>
              Two ways for you or a model to write a video that lands as ordinary, editable clips and keyframes. Both shipped in 1.0 as experimental entries and may change in a minor release.
            </>
          }
        />

        <section className="mb-10">
          <H2 id="html">HTML scenes<Experimental /></H2>
          <P>
            Write an HTML fragment and a stylesheet in a whitelisted subset. <C>validateScene(&#123; html, css &#125;)</C> returns violations that name the supported substitute for everything it refuses. <C>sceneToClip(measuredScene, &#123; fps &#125;)</C> turns a browser-measured scene into one compound clip of native shape, text and image clips with keys, from a one-line <C>data-motion</C> grammar.
          </P>
          <P>
            Measuring the scene in a browser is the host&apos;s step: the package ships no DOM measurer. The subset refuses loudly, which is a feature.
          </P>
          <CodeBlock
            language="typescript"
            code={`import { validateScene, sceneToClip } from '@elah/core/html'`}
          />
        </section>

        <section className="mb-10">
          <H2 id="videospec">VideoSpec<Experimental /></H2>
          <P>
            A seconds-based JSON document. <C>compileVideoSpec(spec)</C> returns <C>&#123; project, issues &#125;</C> and never throws. <C>buildVideo(authoredSpec)</C> also expands components and polishes, and <C>layProject(engine, project)</C> lays the result onto a live engine as one undo step. <C>specVocabulary()</C> renders the vocabulary for a prompt.
          </P>
          <CodeBlock
            language="typescript"
            code={`import { compileVideoSpec, buildVideo, layProject, specVocabulary } from '@elah/core/spec'`}
          />
        </section>

        <section className="mb-10">
          <H2 id="ops">Edit operations<Experimental /></H2>
          <P>
            Edits an AI can call go through typed ops from <C>@elah/core/ops</C>: <C>sanitizeOps(raw, project)</C> repairs a model&apos;s op list and <C>applyOps(engine, ops)</C> applies it as one undo step. See <Link href="/docs/agents" className="text-primary hover:underline">For AI agents</Link>.
          </P>
        </section>
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
