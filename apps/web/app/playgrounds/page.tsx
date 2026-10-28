import type { Metadata } from 'next'
import { Navbar } from '@/components/marketing/Navbar'
import { Footer } from '@/components/marketing/Footer'
import { PlaygroundCard } from '@/components/marketing/PlaygroundCard'
import { Terminal } from 'lucide-react'
import { PageHeader } from '@/components/site/PageHeader'
import { Slate, cardLight, container, label, mono, outline, sectionY } from '@/components/eb'

export const metadata: Metadata = {
  title: 'Playgrounds',
  description: 'Interactive playground environments for elah. Explore the full editor, timeline-only, and demo modes.',
  alternates: { canonical: '/playgrounds' },
}

const playgrounds = [
  {
    title: 'Full Editor',
    description:
      'The complete editor composition: asset panel with drag-drop import, GPU-accelerated preview with interactive transform overlays, full timeline with snapping, audio playback, transitions, and MP4 export.',
    techLabels: ['WebGL2', 'WebCodecs', 'Timeline', 'Audio', 'Export'],
    href: '/playground/production',
    status: 'live' as const,
    variant: 'full' as const,
    detail: [
      'Drop any video/image/audio file to import',
      'Drag clips to timeline from asset panel',
      'Click preview to select + transform clips',
      'Space to play/pause, S to split at playhead',
      'Export button → MP4 download',
    ],
  },
  {
    title: 'Timeline Only',
    description:
      'The timeline component in isolation. Explore the full editing interaction model without the WebGL renderer or decode pipeline. Ideal for integration testing or building a custom rendering layer.',
    techLabels: ['Timeline', 'React', 'Zustand', 'Framer Motion'],
    href: '/playground/timeline',
    status: 'live' as const,
    variant: 'timeline' as const,
    detail: [
      'Programmatically add video/audio/text clips',
      'Drag to move, edge-drag to trim',
      'Ctrl+Scroll to zoom',
      'Context menu → Delete',
      'Full undo/redo history',
    ],
  },
  {
    title: 'Full Editor Demo',
    description:
      'Guided demo with sample media pre-loaded. Walks through the major features: cut editing, title overlays, fade transition, and MP4 export — in a single browser session.',
    techLabels: ['Full Stack', 'Sample Media', 'Transitions', 'Export'],
    href: '/playground/raw',
    status: 'preview' as const,
    variant: 'demo' as const,
    detail: [
      'Pre-loaded sample video and audio',
      'Guided walkthrough of core features',
      'Demonstrates fade transition',
      'Text overlay creation and styling',
      'Export pipeline end-to-end',
    ],
  },
]

export default function PlaygroundsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <Navbar />

      <main className="flex-1">
        {/* Header */}
        <PageHeader
          eyebrow="Interactive"
          title="Playgrounds"
          lede={
            <>
              Each playground is a live deployment of the elah SDK. Launch one to explore the editor, test your integration, or demo the capabilities.
            </>
          }
        >
          <div className={`mt-6 inline-flex items-start gap-3 bg-surface-low p-4 ${outline}`}>
              <Terminal className="mt-0.5 h-4 w-4 shrink-0 text-on-surface-variant" />
              <div>
                <div className={`text-on-surface ${label}`}>Running locally?</div>
                <p className="mt-1 text-[13px] leading-[20px] text-on-surface-variant">
                  Start the web app with{' '}
                  <code className={`bg-surface px-1.5 py-0.5 text-[12px] text-on-surface ${mono} ${outline}`}>npm run dev:web</code>{' '}
                  and open any playground above directly in the browser.
                </p>
              </div>
            </div>
        </PageHeader>

        {/* Cards */}
        <div className={`${container} pt-12 ${sectionY}`}>
          <Slate n={1} label="Playgrounds" kicker="Live deployments" />
          <div className="grid grid-cols-1 gap-4 pt-10 lg:grid-cols-3">
            {playgrounds.map((pg, i) => (
              <div key={pg.title} className="flex flex-col gap-4">
                <PlaygroundCard {...pg} index={i} />

                {/* Feature list */}
                <div className={`bg-surface-low p-4 ${outline}`}>
                  <div className={`mb-3 text-on-surface ${label}`}>
                    What you can explore
                  </div>
                  <ul className="space-y-1.5">
                    {pg.detail.map((item) => (
                      <li key={item} className="flex items-start gap-2">
                        <div className="mt-2 h-1 w-1 shrink-0 bg-on-surface-variant" />
                        <span className="text-[14px] leading-[22px] text-on-surface-variant">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tech breakdown */}
        <div className={`${container} ${sectionY}`}>
          <Slate n={2} label="What powers the playgrounds" />
          <div className="pt-10">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {[
                { label: 'Renderer', value: 'WebGL2 GpuRenderer', sub: 'VideoLayer, ImageLayer, TextLayer' },
                { label: 'Decode', value: 'WebCodecs API', sub: 'Push-based StreamingFrameProducer' },
                { label: 'Demux', value: 'mediabunny', sub: 'MP4/WebM container parsing' },
                { label: 'Export', value: 'Web Worker', sub: 'OffscreenCanvas + mediabunny mux' },
                { label: 'State', value: 'Zustand + Immer', sub: 'Structural sharing, undo/redo' },
                { label: 'UI', value: 'React 18', sub: 'Concurrent mode, refs' },
                { label: 'Build', value: 'Vite + TypeScript', sub: 'npm workspaces, project refs' },
                { label: 'Audio', value: 'Web Audio API', sub: 'Main-thread scheduling' },
              ].map(({ label: tagLabel, value, sub }) => (
                <div key={tagLabel} className={`${cardLight} gap-0 p-4`}>
                  <div className={`mb-2 text-on-surface-variant ${label}`}>{tagLabel}</div>
                  <div className="text-[15px] font-medium text-on-surface">{value}</div>
                  <div className="mt-1 text-[13px] leading-[20px] text-on-surface-variant">{sub}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
