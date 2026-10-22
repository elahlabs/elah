import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, Layers, Clock, Cpu, Braces, Terminal } from 'lucide-react'
import { DocsToc } from '@/components/docs/DocsToc'
import { docsHome } from '@/config/docs'
import { PageHeader } from '@/components/site/PageHeader'

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
  { id: 'architecture', title: 'Architecture', level: 2 },
  { id: 'packages', title: 'Packages', level: 2 },
  { id: 'design-principles', title: 'Design Principles', level: 2 },
  ...docsHome.map((group) => ({ id: groupId(group.title), title: group.title, level: 2 })),
]

export default function DocsPage() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
      <article className="min-w-0 flex-1 max-w-3xl">
        {/* Page header */}
        <PageHeader
          variant="doc"
          id="introduction"
          eyebrow="elah"
          title="Introduction"
          lede={
            <>
              elah is an open, framework-agnostic architecture for building browser-native video editors. It currently ships first-class support for Next.js and React, with React Native (experimental) and more frameworks coming soon. Engine-first, renderer-agnostic, scalable from MVP to production.
            </>
          }
        />

        {/* What is it */}
        <section className="mb-10">
          <p className="text-sm leading-relaxed text-on-surface-variant mb-4">
            elah is <strong className="text-on-surface font-medium">not</strong> a drag-and-drop video editing app you open in a browser. It is the <strong className="text-on-surface font-medium">engine, resolver, and timeline SDK</strong> that any modern web-based video editor should sit on.
          </p>
          <p className="text-sm leading-relaxed text-on-surface-variant mb-4">
            Three goals shape every decision:
          </p>
          <ol className="space-y-3 mb-6">
            {[
              { n: '1', title: 'Deterministic playback', desc: 'Same project + same frame = same pixels, always. Time is integer frames; never floating-point seconds.' },
              { n: '2', title: 'Renderer-agnostic core', desc: 'The data model and timeline resolver know nothing about DOM, Canvas, WebGL, or WebGPU. Swap rendering backends without touching state.' },
              { n: '3', title: 'Iteration speed', desc: 'Small surface area, no plugin systems, no over-engineered abstractions. You can read the entire core in one sitting.' },
            ].map((item) => (
              <li key={item.n} className="flex gap-3 rounded-md border border-outline-variant bg-surface-low p-4">
                <span className="label-mono mt-0.5 text-xs text-primary">{item.n}.</span>
                <div>
                  <div className="text-sm font-medium text-on-surface mb-0.5">{item.title}</div>
                  <div className="text-xs leading-relaxed text-on-surface-variant">{item.desc}</div>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Architecture */}
        <section className="mb-10">
          <h2
            id="architecture"
            className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20"
          >
            Architecture
          </h2>
          <p className="text-sm leading-relaxed text-on-surface-variant mb-4">
            A single immutable <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">Project</code> tree owns all timeline data. The framework-agnostic <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">TimelineEngine</code> is the only place mutations happen — every edit is an Immer-backed commit with structural sharing, history, batching, and typed events.
          </p>
          <p className="text-sm leading-relaxed text-on-surface-variant mb-6">
            A pure function <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">resolveTimeline(frame, project) → Scene</code> determines what is visible and audible at any frame. This is the only thing renderers consume — the shipped renderer is a WebGL2 <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">GpuRenderer</code> that turns each <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">Scene</code> into sorted textured-quad draws.
          </p>

          {/* Architecture layers diagram */}
          <div className="overflow-hidden rounded-md border border-outline-variant">
            {[
              { label: 'React UI Layer', items: ['Timeline', 'Preview', 'AssetPanel', 'Transform Overlays'], bg: 'bg-surface-low' },
              { label: 'Zustand Stores', items: ['useTracksStore', 'usePlaybackStore', 'useSelectionStore', 'useTransitionsStore'], bg: 'bg-surface-lowest' },
              { label: 'Engine Layer', items: ['TimelineEngine', 'PlaybackEngine', 'AudioPlaybackController'], bg: 'bg-surface-low' },
              { label: 'Pure Resolver', items: ['resolveTimeline(frame, project) → Scene'], bg: 'bg-surface-lowest' },
              { label: 'Renderer Interface', items: ['GpuRenderer (WebGL2)', 'ExportWorker (OffscreenCanvas)'], bg: 'bg-surface-low' },
              { label: 'Media Pipeline', items: ['StreamingFrameProducer', 'WebCodecs API', 'mediabunny demux', 'ImageBitmap cache'], bg: 'bg-surface-lowest' },
            ].map((layer) => (
              <div key={layer.label} className={`flex flex-col gap-2 border-b border-outline-variant p-3 last:border-0 sm:flex-row sm:gap-4 ${layer.bg}`}>
                <div className="pt-0.5 sm:w-32 sm:shrink-0">
                  <span className="label-mono text-2xs text-on-surface-variant" style={{ opacity: 0.65 }}>
                    {layer.label}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {layer.items.map((item) => (
                    <span
                      key={item}
                      className="rounded border border-outline-variant bg-surface-container px-2 py-0.5 font-mono text-xs text-on-surface"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Packages */}
        <section className="mb-10">
          <h2
            id="packages"
            className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20"
          >
            Packages
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            Five packages. <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">@elah/core</code>, <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">@elah/react</code>, <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">@elah/timeline</code> and <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">@elah/editor</code> are released together and share a version. <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">@elah/cli</code> versions independently.
          </p>
          <div className="space-y-3">
            {[
              {
                name: '@elah/editor',
                desc: 'The full SDK. Exports EditorProvider, Preview, AssetPanel and the transform overlays, and re-exports core, react and timeline.',
                icon: Layers,
              },
              {
                name: '@elah/core',
                desc: 'Framework-agnostic engine. TimelineEngine, PlaybackEngine, resolveTimeline, GpuRenderer, export pipeline. Zero React imports.',
                icon: Cpu,
              },
              {
                name: '@elah/react',
                desc: 'React bindings. EditorContext, useEditor, the store hooks, the media library hook and the audio mixer hooks. Core stays React-free.',
                icon: Braces,
              },
              {
                name: '@elah/timeline',
                desc: 'React timeline UI components. Timeline, Ruler, TrackRow, ClipBlock, Playhead, and all interaction hooks.',
                icon: Clock,
              },
              {
                name: '@elah/cli',
                desc: 'Headless runtime. elah build/export/serve — render projects on your server via headless Chrome, bit-identical to browser export. Also importable as a Node library.',
                icon: Terminal,
              },
            ].map(({ name, desc, icon: Icon }) => (
              <div key={name} className="flex gap-3 rounded-md border border-outline-variant bg-surface-low p-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-outline-variant bg-surface-low">
                  <Icon className="h-4 w-4 text-on-surface-variant" />
                </div>
                <div>
                  <div className="mb-1 font-mono text-sm font-medium text-on-surface">{name}</div>
                  <div className="text-xs leading-relaxed text-on-surface-variant">{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Design principles */}
        <section className="mb-10">
          <h2
            id="design-principles"
            className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20"
          >
            Design Principles
          </h2>
          <div className="space-y-2">
            {[
              { p: 'Engine-first', desc: 'The core is plain TypeScript. React is a consumer, not a master.' },
              { p: 'Frames, not seconds', desc: 'Integer time eliminates a class of floating-point bugs that haunt every NLE.' },
              { p: 'One mutation funnel', desc: 'All edits go through TimelineEngine.commit(). No back-doors.' },
              { p: 'Pure resolver', desc: 'resolveTimeline is deterministic and side-effect-free — runs in tests, workers, and export pipelines without ceremony.' },
              { p: 'Renderer is just a consumer', desc: 'A renderer reads Scene, writes pixels, and knows nothing else.' },
              { p: 'Small surface area', desc: 'No plugin systems, no event buses, no dependency injection — until proven needed.' },
            ].map(({ p, desc }) => (
              <div key={p} className="flex gap-3 py-2">
                <div className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" />
                <div>
                  <span className="text-sm font-medium text-on-surface">{p}. </span>
                  <span className="text-sm text-on-surface-variant">{desc}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Where to go next: grouped cards, driven by docsHome in config/docs.ts */}
        {docsHome.map((group) => (
          <section key={group.title} className="mb-10 last:mb-0">
            <h2
              id={groupId(group.title)}
              className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20"
            >
              {group.title}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {group.cards.map(({ title, desc, href }) => (
                <Link
                  key={href}
                  href={href}
                  className="group flex items-start justify-between gap-2 rounded-md border border-outline-variant bg-surface-low p-4 no-underline transition-colors hover:border-outline"
                >
                  <div>
                    <div className="mb-1 text-sm font-medium text-on-surface">{title}</div>
                    <div className="text-xs leading-relaxed text-on-surface-variant">{desc}</div>
                  </div>
                  <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-on-surface-variant transition-transform group-hover:translate-x-0.5" />
                </Link>
              ))}
            </div>
          </section>
        ))}
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
