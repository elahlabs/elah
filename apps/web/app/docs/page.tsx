import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { DocsToc } from '@/components/docs/DocsToc'
import { Code } from '@/components/docs/Code'
import { C, Callout, H2, P, PropTable } from '@/components/docs/DocsKit'
import { LazyDemo } from '@/components/home/LazyDemo'
import { docsHome } from '@/config/docs'
import { PageHeader } from '@/components/site/PageHeader'
import { label } from '@/components/eb'

export const metadata: Metadata = {
  title: 'Documentation',
  description:
    'Documentation for elah, the browser-native video editing engine: installation, quick start, timeline and editor components, clips and text motion, project documents, MP4 export, the headless CLI, architecture, API reference, and guides for AI agents.',
  alternates: { canonical: '/docs' },
}

// "Engine & data" -> "engine-and-data". The group headings come from
// `docsHome` (config/docs.ts), so the TOC and the headings cannot drift.
const groupId = (title: string) =>
  title
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

const toc = [
  { id: 'introduction', title: 'Introduction', level: 2 },
  { id: 'start', title: 'Where to start', level: 2 },
  { id: 'how-it-works', title: 'How it works', level: 2 },
  { id: 'packages', title: 'Packages', level: 2 },
  { id: 'all-docs', title: 'All docs', level: 2 },
]

const link = 'text-on-surface underline decoration-[#FF003C] underline-offset-4 hover:decoration-2'

const PATHS = [
  { title: 'Drop in a video editor', desc: 'Preview, timeline and media panel, ready to style.', href: '/docs/getting-started' },
  { title: 'Build your own editor UI', desc: 'Use the engine and hooks under your own components.', href: '/docs/react' },
  { title: 'Generate video from code or a model', desc: 'Write scenes as JSON or HTML, render in the browser or on a server.', href: '/docs/scenes' },
]

export default function DocsPage() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
      <article className="min-w-0 max-w-3xl flex-1">
        <PageHeader
          variant="doc"
          id="introduction"
          eyebrow="elah"
          title="Documentation"
          lede="elah is an open-source engine for building video editors in the browser. It gives you the timeline, the preview, the editing logic and MP4 export as React components, on top of an engine that also runs without React."
        />

        <figure className="my-8 border border-outline-variant">
          <LazyDemo name="hero" timelineHeight={130} minHeight={440} label="An elah project playing in Preview and Timeline" />
          <figcaption className={`border-t border-outline-variant px-4 py-2.5 text-on-surface-variant ${label}`}>
            Preview and Timeline, running on this page
          </figcaption>
        </figure>

        <Code lang="bash" code={`npm install @elah/editor lucide-react`} />
        <P>
          elah is not an editing app you open; it is what an editing app is built from. It works with React 18 and 19, in Next.js or Vite.
          Everything runs in the user&apos;s browser: media is never uploaded.
        </P>

        <H2 id="start">Where to start</H2>
        <div className="my-5 grid gap-px border border-outline-variant bg-outline-variant sm:grid-cols-3">
          {PATHS.map((p) => (
            <Link key={p.href} href={p.href} className="group flex flex-col gap-2 bg-surface px-4 py-4 no-underline transition-colors hover:bg-surface-low">
              <span className="flex items-start justify-between gap-2 text-[15px] font-semibold text-on-surface">
                {p.title}
                <ArrowRight size={15} aria-hidden className="mt-[3px] shrink-0 text-on-surface-variant transition-transform group-hover:translate-x-0.5" />
              </span>
              <span className="text-[13px] leading-[1.55] text-on-surface-variant">{p.desc}</span>
            </Link>
          ))}
        </div>
        <P>
          New here? Start with{' '}
          <Link href="/docs/installation" className={link}>
            Installation
          </Link>
          , then{' '}
          <Link href="/docs/getting-started" className={link}>
            Quick Start
          </Link>
          . Using an AI assistant? The <strong className="font-semibold text-on-surface">Ask AI</strong> button at the top of every page hands it
          the page you are reading.
        </P>

        <H2 id="how-it-works">How it works</H2>
        <P>
          A project is plain data. Every edit goes through one engine. A pure function turns the project and a frame number into a{' '}
          <C>Scene</C>, and the renderer draws that Scene. Preview, export and the server renderer all draw from the same function, which is why
          they agree frame for frame.
        </P>
        <Code
          lang="text"
          code={`
edit ──▶ TimelineEngine ──▶ Project (immutable, undoable)

Project + frame ──▶ resolveTimeline ──▶ Scene ──┬──▶ GpuRenderer   (preview)
                                                └──▶ export worker (MP4)`}
        />
        <PropTable
          nameLabel="Rule"
          rows={[
            { name: 'Time is whole frames', desc: 'Positions and lengths are integer frame counts, never seconds.' },
            { name: 'One way to change a project', desc: <>Every edit goes through <C>TimelineEngine</C>, so every edit is undoable.</> },
            { name: 'The resolver is pure', desc: <><C>resolveTimeline</C> has no side effects; renderers read only the Scene.</> },
          ]}
        />
        <P>
          More in{' '}
          <Link href="/docs/architecture" className={link}>
            Architecture
          </Link>
          .
        </P>

        <H2 id="packages">Packages</H2>
        <PropTable
          nameLabel="Package"
          rows={[
            { name: '@elah/editor', type: 'start here', desc: 'The full SDK: EditorProvider, Preview, AssetPanel and on-canvas editing, plus everything below.' },
            { name: '@elah/timeline', desc: 'The Timeline component: tracks, clips, trimming, snapping, zoom.' },
            { name: '@elah/react', desc: 'Hooks over the engine, for your own UI.' },
            { name: '@elah/core', desc: 'The engine, resolver, WebGL2 renderer and export. No React.' },
            { name: '@elah/cli', type: 'own version', desc: 'Render on a server: build, export and an HTTP render server.' },
          ]}
        />
        <P>
          The first four are released together and share a version. All are Apache-2.0.
        </P>
        <Callout title="React Native is in progress">
          <C>@elah/react-native</C> is at 0.1.0 and not published yet.
        </Callout>

        <H2 id="all-docs">All docs</H2>
        <div className="my-5 flex flex-col gap-6">
          {docsHome.map((group) => (
            <section key={group.title} id={groupId(group.title)} className="scroll-mt-28 md:scroll-mt-20">
              <h3 className={`mb-2 text-on-surface-variant ${label}`}>{group.title}</h3>
              <ul className="m-0 list-none border-t border-outline-variant p-0">
                {group.cards.map(({ title, desc, href }) => (
                  <li key={href} className="border-b border-outline-variant">
                    <Link href={href} className="group flex items-baseline gap-4 py-2.5 no-underline">
                      <span className="w-48 shrink-0 text-[14px] font-medium text-on-surface group-hover:underline group-hover:decoration-[#FF003C] group-hover:underline-offset-4">
                        {title}
                      </span>
                      <span className="hidden text-[13px] leading-[1.5] text-on-surface-variant sm:block">{desc}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
