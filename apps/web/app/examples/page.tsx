import type { Metadata } from 'next'
import { Navbar } from '@/components/marketing/Navbar'
import { Footer } from '@/components/marketing/Footer'
import { CodeBlock } from '@/components/docs/CodeBlock'
import { ArrowRight, Github } from 'lucide-react'
import Link from 'next/link'
import { siteConfig } from '@/config/site'

const fullExamples = [
  {
    framework: 'React',
    runtime: 'Vite + React 19',
    description:
      'A complete production editor — preview, timeline, asset/element panels, text inspector, and MP4 export — wired as a standalone Vite app consuming @elah/editor from npm.',
    href: `${siteConfig.links.github}/tree/main/playground/react`,
  },
  {
    framework: 'Next.js',
    runtime: 'Next.js 16 · App Router',
    description:
      'The same full editor composition in a Next.js App Router app, with the client-only dynamic import and transpilePackages config needed to ship it in production.',
    href: `${siteConfig.links.github}/tree/main/playground/next`,
  },
]

export const metadata: Metadata = {
  title: 'Examples',
  description: 'Code examples showing how to integrate elah for specific use cases.',
}

const examples = [
  {
    id: 'timeline-only',
    category: 'Integration',
    title: 'Timeline Only',
    description: 'The timeline as a drop-in component — no renderer, no decode pipeline. Ideal for building a custom rendering layer or exploring the edit model.',
    code: `import { useRef } from 'react'
import {
  EditorProvider,
  Timeline,
  useTimelineEngine,
  usePlaybackStore,
  framesToTimecode,
  type TimelineRef,
} from '@elah/editor'

const TRACKS = [
  { kind: 'video' as const, name: 'Video / Image' },
  { kind: 'audio' as const, name: 'Audio' },
  { kind: 'elements' as const, name: 'Elements' },
]

function Transport({ fps }: { fps: number }) {
  const { isPlaying, togglePlayPause, currentFrame } =
    usePlaybackStore((s) => s)

  return (
    <div style={{ display: 'flex', gap: 8, padding: 8 }}>
      <button onClick={togglePlayPause}>
        {isPlaying ? '⏸' : '▶'}
      </button>
      <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
        {framesToTimecode(currentFrame, fps)}
      </span>
    </div>
  )
}

export default function TimelineOnlyExample() {
  const ref = useRef<TimelineRef>(null)
  const fps = 30

  return (
    <EditorProvider fps={fps} initialTracks={TRACKS}>
      <Transport fps={fps} />
      <Timeline ref={ref} fps={fps} style={{ height: 260 }} />
    </EditorProvider>
  )
}`,
  },
  {
    id: 'custom-demuxer',
    category: 'Advanced',
    title: 'Custom Demuxer',
    description: 'Replace mediabunny with your own demuxer by implementing the DemuxerFactory interface.',
    code: `import {
  EditorProvider,
  Preview,
  Timeline,
  type DemuxerFactory,
} from '@elah/editor'

// Implement DemuxerFactory with your own backend
const myDemuxerFactory: DemuxerFactory = () => ({
  async probe(src: string) {
    const res = await fetch(\`/api/probe?src=\${encodeURIComponent(src)}\`)
    return res.json() // { width, height, durationSeconds, fps }
  },
  async demux(src, opts, onChunk) {
    const res = await fetch(src)
    const reader = res.body!.getReader()
    // Feed chunks to your WebCodecs VideoDecoder
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      onChunk(new EncodedVideoChunk({
        type: 'key',
        timestamp: opts.startTimestamp,
        data: value,
      }))
    }
  },
  destroy() {},
})

export default function CustomDemuxerExample() {
  return (
    <EditorProvider fps={30}>
      <Preview demuxerFactory={myDemuxerFactory} style={{ flex: 1 }} />
      <Timeline fps={30} style={{ height: 240 }} />
    </EditorProvider>
  )
}`,
  },
  {
    id: 'export-with-progress',
    category: 'Export',
    title: 'Export with Progress UI',
    description: 'Full export flow with progress bar, cancel support, and MP4 download trigger.',
    code: `import { useState, useCallback } from 'react'
import {
  exportVideo,
  useTimelineEngine,
  createDefaultDemuxerFactory,
  type ExportProgress,
} from '@elah/editor'

const demuxerFactory = createDefaultDemuxerFactory()

export function ExportPanel() {
  const engine = useTimelineEngine()
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleExport = useCallback(async () => {
    setError(null)
    try {
      const blob = await exportVideo(engine.getProject(), {
        fps: 30,
        demuxerFactory,
        videoCodec: 'avc',
        videoBitrate: 8_000_000,
        onProgress: setProgress,
      })

      // Trigger download
      const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: 'export.mp4',
      })
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setProgress(null)
    }
  }, [engine])

  return (
    <div style={{ padding: 16 }}>
      <button
        onClick={handleExport}
        disabled={!!progress}
        style={{ padding: '8px 16px', background: '#b7102a', color: '#fff' }}
      >
        {progress ? \`Exporting \${Math.round(progress.percent)}%\` : 'Export MP4'}
      </button>

      {progress && (
        <div style={{ marginTop: 8 }}>
          <progress value={progress.percent} max={100} style={{ width: '100%' }} />
          <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
            {progress.phase} · frame {progress.frame} / {progress.totalFrames}
          </div>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 8, color: '#b7102a', fontSize: 12 }}>
          Error: {error}
        </div>
      )}
    </div>
  )
}`,
  },
  {
    id: 'resolve-timeline-custom',
    category: 'Advanced',
    title: 'Custom Renderer with resolveTimeline',
    description: 'Use the pure resolver to build a completely custom rendering layer — DOM, Canvas 2D, or any other target.',
    code: `import { useEffect, useRef } from 'react'
import {
  EditorProvider,
  Timeline,
  useTimelineEngine,
  usePlaybackStore,
  useTracksStore,
  resolveTimeline,
} from '@elah/editor'

// DOM renderer: updates div positions instead of WebGL
function DomPreview() {
  const engine = useTimelineEngine()
  const currentFrame = usePlaybackStore((s) => s.currentFrame)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const project = engine.getProject()
    const scene = resolveTimeline(currentFrame, project)

    if (!containerRef.current) return
    containerRef.current.innerHTML = ''

    // Render text clips as DOM elements
    for (const text of scene.texts) {
      const el = document.createElement('div')
      el.textContent = text.text?.content ?? ''
      el.style.cssText = \`
        position: absolute;
        opacity: \${text.opacity};
        font-size: \${text.text?.fontSize ?? 32}px;
        color: \${text.text?.color ?? '#fff'};
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
      \`
      containerRef.current.appendChild(el)
    }
  }, [currentFrame, engine])

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        flex: 1,
        background: '#000',
        overflow: 'hidden',
      }}
    />
  )
}

export default function CustomRendererExample() {
  return (
    <EditorProvider fps={30}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <DomPreview />
        <Timeline fps={30} style={{ height: 240 }} />
      </div>
    </EditorProvider>
  )
}`,
  },
]

const categoryColors: Record<string, string> = {
  Integration: 'text-secondary bg-blue-50 border-blue-200',
  Advanced: 'text-primary bg-red-50 border-red-200',
  Export: 'text-tertiary bg-green-50 border-green-200',
}

export default function ExamplesPage() {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <Navbar />

      <main className="flex-1">
        {/* Header */}
        <div className="border-b border-outline-variant bg-surface py-14">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="label-mono mb-3 text-2xs text-on-surface-variant opacity-60">Code</div>
            <h1
              className="text-3xl font-semibold tracking-tight text-on-surface md:text-4xl"
              style={{ fontFamily: 'var(--font-inter), sans-serif' }}
            >
              Examples
            </h1>
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-on-surface-variant">
              Integration examples for common use cases. Copy, adapt, ship.
            </p>
          </div>
        </div>

        {/* Complete example apps */}
        <div className="border-b border-outline-variant bg-surface-low py-12">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="label-mono mb-3 text-2xs text-on-surface-variant opacity-60">
              Full apps
            </div>
            <h2
              className="text-xl font-semibold tracking-tight text-on-surface"
              style={{ fontFamily: 'var(--font-inter), sans-serif' }}
            >
              Complete production example
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-on-surface-variant">
              Runnable, end-to-end editor apps consuming the published{' '}
              <code className="rounded bg-surface-container px-1.5 py-0.5 font-mono text-xs">@elah/editor</code>{' '}
              package. Clone, install, and run — or read the source on GitHub.
            </p>

            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {fullExamples.map((ex) => (
                <a
                  key={ex.framework}
                  href={ex.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex flex-col rounded-md border border-outline-variant bg-surface p-5 transition-colors hover:border-outline hover:bg-surface-container"
                >
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h3
                      className="text-base font-semibold tracking-tight text-on-surface"
                      style={{ fontFamily: 'var(--font-inter), sans-serif' }}
                    >
                      {ex.framework}
                    </h3>
                    <Github className="h-4 w-4 shrink-0 text-on-surface-variant transition-colors group-hover:text-on-surface" />
                  </div>
                  <div className="label-mono mb-3 text-2xs text-on-surface-variant opacity-60">
                    {ex.runtime}
                  </div>
                  <p className="flex-1 text-xs leading-relaxed text-on-surface-variant">
                    {ex.description}
                  </p>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-primary">
                    View on GitHub
                    <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* Quick links */}
        <div className="border-b border-outline-variant bg-surface-low px-4 py-3 sm:px-6">
          <div className="mx-auto flex max-w-7xl flex-wrap gap-2">
            {examples.map((ex) => (
              <a
                key={ex.id}
                href={`#${ex.id}`}
                className="rounded border border-outline-variant px-3 py-1 text-xs text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
              >
                {ex.title}
              </a>
            ))}
          </div>
        </div>

        {/* Example blocks */}
        <div className="mx-auto max-w-7xl divide-y divide-outline-variant px-4 sm:px-6">
          {examples.map((ex) => (
            <section key={ex.id} id={ex.id} className="py-12 scroll-mt-16">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <span className={`rounded border px-2 py-0.5 text-2xs font-medium ${categoryColors[ex.category] ?? ''}`}>
                      {ex.category}
                    </span>
                  </div>
                  <h2
                    className="text-xl font-semibold tracking-tight text-on-surface"
                    style={{ fontFamily: 'var(--font-inter), sans-serif' }}
                  >
                    {ex.title}
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm leading-relaxed text-on-surface-variant">
                    {ex.description}
                  </p>
                </div>
              </div>
              <CodeBlock
                code={ex.code}
                language="tsx"
                filename={`${ex.id}.tsx`}
                showLineNumbers
              />
            </section>
          ))}
        </div>

        {/* CTA */}
        <div className="border-t border-outline-variant bg-surface-low py-12">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-medium text-on-surface">Need something more specific?</div>
                <p className="mt-1 text-xs text-on-surface-variant">
                  Check the API reference or open an issue on GitHub.
                </p>
              </div>
              <div className="flex gap-3">
                <Link
                  href="/docs/api"
                  className="inline-flex items-center gap-2 rounded border border-outline-variant px-4 py-2 text-xs font-medium text-on-surface transition-colors hover:bg-surface-container"
                >
                  API Reference
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
