import { Navbar } from '@/components/marketing/Navbar'
import { Footer } from '@/components/marketing/Footer'
import { HeroSection } from '@/components/marketing/HeroSection'
import { FeatureCard } from '@/components/marketing/FeatureCard'
import { PlaygroundCard } from '@/components/marketing/PlaygroundCard'
import { CTASection } from '@/components/marketing/CTASection'
const features = [
  {
    iconName: 'Clock',
    title: 'Frame-Accurate Time Model',
    description:
      'All time is integer frames — no floating-point drift, no sync bugs. Same project + same frame = same pixels, always.',
    tech: ['Immer', 'Zustand'],
  },
  {
    iconName: 'Cpu',
    title: 'WebCodecs Decode Pipeline',
    description:
      'Push-based StreamingFrameProducer with ahead-of-playhead decoding. Frames are copied to ImageBitmap so the hardware output pool never starves.',
    tech: ['WebCodecs', 'ImageBitmap', 'mediabunny'],
  },
  {
    iconName: 'Layers',
    title: 'WebGL2 GPU Renderer',
    description:
      'GpuRenderer turns each resolved Scene into sorted textured-quad draws composited by zIndex. Supports VideoLayer, ImageLayer, and TextLayer.',
    tech: ['WebGL2', 'OffscreenCanvas', 'GLSL'],
  },
  {
    iconName: 'Shuffle',
    title: 'Pure Resolver Architecture',
    description:
      'resolveTimeline(frame, project) → Scene is deterministic and side-effect-free. Runs identically in preview, tests, and export workers.',
    tech: ['Pure function', 'Worker-safe'],
  },
  {
    iconName: 'FileVideo',
    title: 'Zero-Drift Export Pipeline',
    description:
      'Export worker steps resolveTimeline frame-by-frame on OffscreenCanvas using the same placement math as the live renderer. Preview and export never drift.',
    tech: ['Web Worker', 'MP4', 'mediabunny'],
  },
  {
    iconName: 'Wand2',
    title: 'Interactive Transform Overlays',
    description:
      'Click-select, drag-move, corner-drag uniform scale for video and image clips. Text clips support drag, resize, inline-edit, and rotation.',
    tech: ['React', 'CSS transforms'],
  },
  {
    iconName: 'GitBranch',
    title: 'Full Edit History',
    description:
      'Every edit goes through TimelineEngine.commit() — Immer-backed structural sharing with batching, undo/redo, and typed events.',
    tech: ['Immer', 'Undo/Redo'],
  },
  {
    iconName: 'Zap',
    title: 'Fade & Transition System',
    description:
      'Snapshot-overlay architecture. Resolver sets opacity; CSS handles preview via TransitionOverlay; export mirrors with globalAlpha. Renderer-agnostic.',
    tech: ['CSS', 'globalAlpha'],
  },
  {
    iconName: 'Box',
    title: 'Renderer-Agnostic Core',
    description:
      'The data model and resolver know nothing about DOM, Canvas, or WebGL. Swap rendering backends without touching state or timeline logic.',
    tech: ['TypeScript', 'Interfaces'],
  },
]

const playgrounds = [
  {
    title: 'Full Editor',
    description:
      'Complete editor with asset panel, GPU-accelerated preview, interactive overlays, timeline, and export pipeline. The full @elah/editor composition.',
    techLabels: ['WebGL2', 'WebCodecs', 'Timeline', 'Export', 'Audio'],
    href: '/playground/production',
    status: 'live' as const,
    variant: 'full' as const,
  },
  {
    title: 'Timeline Only',
    description:
      'Isolated timeline UI demo. Explore tracks, clips, snapping, keyboard shortcuts, and the TimelineEngine without the full editor stack.',
    techLabels: ['Timeline', 'React', 'Zustand'],
    href: '/playground/timeline',
    status: 'live' as const,
    variant: 'timeline' as const,
  },
  {
    title: 'Full Editor Demo',
    description:
      'Guided demo with pre-loaded sample media. Walks through the major features — cut, trim, text, transitions, and export — in a single session.',
    techLabels: ['Full Stack', 'Demo', 'Sample Media'],
    href: '/playground/raw',
    status: 'preview' as const,
    variant: 'demo' as const,
  },
]

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <Navbar />

      <main className="flex-1">
        <HeroSection />

        {/* Features section */}
        <section className="border-b border-outline-variant bg-surface py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="mb-10">
              <div className="label-mono mb-3 text-2xs text-on-surface-variant opacity-60">
                Architecture
              </div>
              <h2
                className="text-2xl font-semibold tracking-tight text-on-surface md:text-3xl"
                style={{ fontFamily: 'var(--font-inter), sans-serif' }}
              >
                Built for precision.
              </h2>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-on-surface-variant">
                Every layer of the stack is designed around one principle: determinism. Same input, same output, every time.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((feature, i) => (
                <FeatureCard key={feature.title} {...feature} index={i} />
              ))}
            </div>
          </div>
        </section>

        {/* Architecture diagram section */}
        <section className="border-b border-outline-variant bg-surface-low py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="mb-10">
              <div className="label-mono mb-3 text-2xs text-on-surface-variant opacity-60">
                Data Flow
              </div>
              <h2
                className="text-2xl font-semibold tracking-tight text-on-surface md:text-3xl"
                style={{ fontFamily: 'var(--font-inter), sans-serif' }}
              >
                One mutation funnel.
                <br />
                One pure resolver.
              </h2>
            </div>
            <ArchitectureDiagram />
          </div>
        </section>

        {/* Playgrounds section */}
        <section className="border-b border-outline-variant bg-surface py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="mb-10 flex items-end justify-between gap-4">
              <div>
                <div className="label-mono mb-3 text-2xs text-on-surface-variant opacity-60">
                  Interactive
                </div>
                <h2
                  className="text-2xl font-semibold tracking-tight text-on-surface md:text-3xl"
                  style={{ fontFamily: 'var(--font-inter), sans-serif' }}
                >
                  Launch a playground.
                </h2>
                <p className="mt-3 max-w-lg text-sm leading-relaxed text-on-surface-variant">
                  Explore the editor live. Each playground is a fully functional deployment of the SDK.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {playgrounds.map((pg, i) => (
                <PlaygroundCard key={pg.title} {...pg} index={i} />
              ))}
            </div>
          </div>
        </section>

        {/* Quick code preview */}
        <section className="border-b border-outline-variant bg-surface-low py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
              <div>
                <div className="label-mono mb-3 text-2xs text-on-surface-variant opacity-60">
                  Integration
                </div>
                <h2
                  className="text-2xl font-semibold tracking-tight text-on-surface"
                  style={{ fontFamily: 'var(--font-inter), sans-serif' }}
                >
                  Drop in. Wire. Ship.
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">
                  The full editor composes in fewer than 20 lines. Bring your own demuxer factory and the preview handles decode, render, playback, and audio automatically.
                </p>
                <div className="mt-6 space-y-3">
                  {[
                    'EditorProvider wires all engines with a single fps prop',
                    'Preview mounts the WebGL2 renderer and drives the RAF loop',
                    'Timeline handles all interaction: drag, trim, split, snap',
                    'AssetPanel manages the media library and drag-drop import',
                    'exportVideo() runs the full pipeline in a dedicated worker',
                  ].map((point) => (
                    <div key={point} className="flex items-start gap-2.5">
                      <div className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" />
                      <p className="text-xs leading-relaxed text-on-surface-variant">{point}</p>
                    </div>
                  ))}
                </div>
              </div>
              <CodePreview />
            </div>
          </div>
        </section>

        <CTASection />
      </main>

      <Footer />
    </div>
  )
}

function ArchitectureDiagram() {
  const layers = [
    { label: 'React UI',       items: ['Timeline', 'Preview', 'AssetPanel', 'TransformOverlay'] },
    { label: 'Engine Layer',   items: ['TimelineEngine', 'PlaybackEngine', 'AudioPlaybackController'] },
    { label: 'Pure Resolver',  items: ['resolveTimeline(frame, project) → Scene'] },
    { label: 'Renderers',      items: ['GpuRenderer (WebGL2)', 'ExportWorker (OffscreenCanvas)'] },
    { label: 'Media Pipeline', items: ['StreamingFrameProducer', 'WebCodecs', 'mediabunny demux'] },
  ]

  return (
    <div className="overflow-hidden rounded-md border border-outline-variant bg-surface-container">
      {layers.map((layer, i) => (
        <div
          key={layer.label}
          className="flex items-start gap-4 border-b border-outline-variant p-4 last:border-0"
          style={{ backgroundColor: i % 2 === 0 ? 'var(--color-surface-container)' : 'var(--color-surface-high)' }}
        >
          <div className="w-28 shrink-0">
            <span
              className="label-mono text-2xs text-on-surface-variant"
              style={{ opacity: 0.7 }}
            >
              {layer.label.toUpperCase()}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {layer.items.map((item) => (
              <span
                key={item}
                className="rounded border border-outline-variant bg-surface-low px-2 py-1 font-mono text-xs text-on-surface"
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function CodePreview() {
  const code = `import {
  EditorProvider,
  AssetPanel,
  Preview,
  Timeline,
  createDefaultDemuxerFactory,
} from '@elah/editor'

const demuxerFactory = createDefaultDemuxerFactory()

export default function App() {
  return (
    <EditorProvider fps={30}>
      <div style={{ display: 'flex', height: '100vh',
                    flexDirection: 'column' }}>
        <div style={{ display: 'flex', flex: 1 }}>
          <AssetPanel style={{ width: 240 }} />
          <Preview
            demuxerFactory={demuxerFactory}
            style={{ flex: 1 }}
          />
        </div>
        <Timeline fps={30} style={{ height: 240 }} />
      </div>
    </EditorProvider>
  )
}`

  return (
    <div className="overflow-hidden rounded-md border border-outline-variant bg-[#0d0d0d]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <span className="font-mono text-xs text-white/30">App.tsx</span>
        <span className="label-mono text-2xs text-white/20">@elah/editor</span>
      </div>
      <pre
        className="overflow-x-auto p-4 text-xs leading-relaxed text-white/80"
        style={{ fontFamily: 'var(--font-geist-mono), JetBrains Mono, monospace' }}
      >
        <code>{code}</code>
      </pre>
    </div>
  )
}
