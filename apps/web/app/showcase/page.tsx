import type { Metadata } from 'next'
import { Navbar } from '@/components/marketing/Navbar'
import { Footer } from '@/components/marketing/Footer'
import { ExternalLink, Layers, Clock, FileVideo, Cpu } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Showcase',
  description: 'Projects and tools built with elah.',
}

const showcaseItems = [
  {
    name: 'Full Editor Playground',
    description: 'The reference implementation. Asset panel, GPU-accelerated preview, timeline, audio, transitions, and MP4 export — all wired together.',
    tags: ['Reference', 'WebGL2', 'Export'],
    icon: Layers,
    href: '/playground/production',
    color: '#b7102a',
    status: 'Live',
  },
  {
    name: 'Timeline Demo',
    description: 'Isolated timeline interaction model. The full editing surface without the renderer — useful for testing integration or building a custom rendering layer.',
    tags: ['Timeline', 'Integration'],
    icon: Clock,
    href: '/playground/timeline',
    color: '#485f84',
    status: 'Live',
  },
  {
    name: 'Export Pipeline Demo',
    description: 'Step through the export worker frame-by-frame. Visualizes the resolveTimeline → OffscreenCanvas → VideoEncoder pipeline.',
    tags: ['Export', 'WebCodecs', 'Worker'],
    icon: FileVideo,
    href: '#',
    color: '#006860',
    status: 'Coming soon',
  },
  {
    name: 'GPU Renderer Debug',
    description: 'GpuDebugCounters visualizer — draw call counts, texture uploads, frame timing, and context-loss simulation.',
    tags: ['WebGL2', 'Debug'],
    icon: Cpu,
    href: '#',
    color: '#5b403f',
    status: 'Coming soon',
  },
]

export default function ShowcasePage() {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <Navbar />

      <main className="flex-1">
        {/* Header */}
        <div className="border-b border-outline-variant bg-surface py-14">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="label-mono mb-3 text-2xs text-on-surface-variant opacity-60">Showcase</div>
            <h1
              className="text-3xl font-semibold tracking-tight text-on-surface md:text-4xl"
              style={{ fontFamily: 'var(--font-inter), sans-serif' }}
            >
              Built with elah
            </h1>
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-on-surface-variant">
              Reference implementations, integration demos, and tools built on the SDK.
            </p>
          </div>
        </div>

        {/* Grid */}
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {showcaseItems.map((item) => {
              const Icon = item.icon
              const isLive = item.status === 'Live'
              return (
                <div
                  key={item.name}
                  className="group flex flex-col overflow-hidden rounded-md border border-outline-variant bg-white"
                >
                  {/* Preview mockup */}
                  <div
                    className="flex items-center justify-center"
                    style={{ height: '140px', background: '#0a0a0a' }}
                  >
                    <div
                      className="flex h-16 w-16 items-center justify-center rounded-lg"
                      style={{ backgroundColor: item.color + '20', border: `1px solid ${item.color}30` }}
                    >
                      <Icon className="h-8 w-8" style={{ color: item.color }} />
                    </div>
                  </div>

                  <div className="flex flex-1 flex-col p-5">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <h2
                        className="text-sm font-semibold text-on-surface"
                        style={{ fontFamily: 'var(--font-inter), sans-serif' }}
                      >
                        {item.name}
                      </h2>
                      <span
                        className={`shrink-0 rounded border px-2 py-0.5 text-2xs font-medium ${
                          isLive
                            ? 'bg-green-50 text-green-700 border-green-200'
                            : 'bg-surface-high text-on-surface-variant border-outline-variant'
                        }`}
                      >
                        {item.status}
                      </span>
                    </div>

                    <p className="mb-4 flex-1 text-xs leading-relaxed text-on-surface-variant">
                      {item.description}
                    </p>

                    <div className="mb-4 flex flex-wrap gap-1">
                      {item.tags.map((tag) => (
                        <span
                          key={tag}
                          className="label-mono rounded border border-outline-variant px-1.5 py-0.5 text-2xs text-on-surface-variant"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>

                    {isLive ? (
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 rounded border px-3 py-2 text-xs font-medium transition-colors"
                        style={{
                          borderColor: item.color + '40',
                          color: item.color,
                          backgroundColor: item.color + '08',
                        }}
                      >
                        <ExternalLink className="h-3 w-3" />
                        Open
                      </a>
                    ) : (
                      <div className="flex items-center justify-center gap-2 rounded border border-outline-variant px-3 py-2 text-xs text-on-surface-variant">
                        Coming soon
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Submit */}
          <div className="mt-12 rounded-md border border-outline-variant bg-surface-low p-6">
            <div className="label-mono mb-2 text-2xs text-on-surface-variant opacity-60">Built something?</div>
            <h3 className="mb-1 text-sm font-semibold text-on-surface">
              Share your project
            </h3>
            <p className="mb-4 text-xs leading-relaxed text-on-surface-variant">
              If you have built something with elah, open a PR to add it to the showcase.
            </p>
            <a
              href="https://github.com/elahlabs/elah/issues/new?template=showcase.md"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded border border-outline-variant px-4 py-2 text-xs font-medium text-on-surface transition-colors hover:bg-surface-container"
            >
              Submit on GitHub
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
