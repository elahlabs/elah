import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, Layers, Clock, Cpu, FileVideo } from 'lucide-react'
import { DocsToc } from '@/components/docs/DocsToc'

export const metadata: Metadata = {
  title: 'Documentation',
  description: 'elah documentation. Browser-native video infrastructure.',
}

const toc = [
  { id: 'introduction', title: 'Introduction', level: 2 },
  { id: 'architecture', title: 'Architecture', level: 2 },
  { id: 'packages', title: 'Packages', level: 2 },
  { id: 'design-principles', title: 'Design Principles', level: 2 },
  { id: 'next-steps', title: 'Next Steps', level: 2 },
]

export default function DocsPage() {
  return (
    <div className="flex gap-12">
      <article className="min-w-0 flex-1 max-w-3xl">
        {/* Page header */}
        <div className="mb-8 pb-6 border-b border-outline-variant">
          <div className="label-mono mb-2 text-2xs text-on-surface-variant opacity-60">
            elah
          </div>
          <h1
            className="text-3xl font-semibold tracking-tight text-on-surface"
            id="introduction"
            style={{ fontFamily: 'var(--font-inter), sans-serif' }}
          >
            Introduction
          </h1>
          <p className="mt-3 text-base leading-relaxed text-on-surface-variant">
            elah is an open, framework-agnostic architecture for building browser-native video editors. It currently ships first-class support for Next.js and React, with React Native (experimental) and more frameworks coming soon. Engine-first, renderer-agnostic, scalable from MVP to production.
          </p>
        </div>

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
            className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-20"
            style={{ fontFamily: 'var(--font-inter), sans-serif' }}
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
              { label: 'React UI Layer', items: ['Timeline', 'Preview', 'AssetPanel', 'Transform Overlays', 'TransitionOverlay'], bg: 'bg-surface-low' },
              { label: 'Zustand Stores', items: ['useTracksStore', 'usePlaybackStore', 'useSelectionStore', 'useTransitionsStore'], bg: 'bg-surface-lowest' },
              { label: 'Engine Layer', items: ['TimelineEngine', 'PlaybackEngine', 'AudioPlaybackController'], bg: 'bg-surface-low' },
              { label: 'Pure Resolver', items: ['resolveTimeline(frame, project) → Scene'], bg: 'bg-surface-lowest' },
              { label: 'Renderer Interface', items: ['GpuRenderer (WebGL2)', 'ExportWorker (OffscreenCanvas)'], bg: 'bg-surface-low' },
              { label: 'Media Pipeline', items: ['StreamingFrameProducer', 'WebCodecs API', 'mediabunny demux', 'ImageBitmap cache'], bg: 'bg-surface-lowest' },
            ].map((layer) => (
              <div key={layer.label} className={`flex gap-4 border-b border-outline-variant p-3 last:border-0 ${layer.bg}`}>
                <div className="w-32 shrink-0 pt-0.5">
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
            className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-20"
            style={{ fontFamily: 'var(--font-inter), sans-serif' }}
          >
            Packages
          </h2>
          <div className="space-y-3">
            {[
              {
                name: '@elah/editor',
                desc: 'The full SDK. Exports EditorProvider, Timeline, Preview, AssetPanel, all hooks, and re-exports core.',
                icon: Layers,
              },
              {
                name: '@elah/core',
                desc: 'Framework-agnostic engine. TimelineEngine, PlaybackEngine, resolveTimeline, GpuRenderer, export pipeline. Zero React imports.',
                icon: Cpu,
              },
              {
                name: '@elah/timeline',
                desc: 'React timeline UI components. Timeline, Ruler, TrackRow, ClipBlock, Playhead, and all interaction hooks.',
                icon: Clock,
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
            className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-20"
            style={{ fontFamily: 'var(--font-inter), sans-serif' }}
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

        {/* Next steps */}
        <section>
          <h2
            id="next-steps"
            className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-20"
            style={{ fontFamily: 'var(--font-inter), sans-serif' }}
          >
            Next Steps
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[
              { title: 'Installation', desc: 'Install @elah/editor from npm and configure Next.js or Vite.', href: '/docs/installation' },
              { title: 'Quick Start', desc: 'Build the full editor in under 20 lines. Wire your demuxer, render, ship.', href: '/docs/getting-started' },
              { title: 'Timeline', desc: 'Deep-dive into tracks, clips, playback, snapping, and keyboard shortcuts.', href: '/docs/timeline' },
              { title: 'API Reference', desc: 'Full reference for TimelineEngine, PlaybackEngine, resolveTimeline, hooks.', href: '/docs/api' },
            ].map(({ title, desc, href }) => (
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
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
