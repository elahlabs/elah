import type { Metadata } from 'next'
import { CodeBlock } from '@/components/docs/CodeBlock'
import { DocsToc } from '@/components/docs/DocsToc'

export const metadata: Metadata = { title: 'API Reference' }

const toc = [
  { id: 'timeline-engine', title: 'TimelineEngine', level: 2 },
  { id: 'playback-engine', title: 'PlaybackEngine', level: 2 },
  { id: 'resolve-timeline', title: 'resolveTimeline()', level: 2 },
  { id: 'gpu-renderer', title: 'GpuRenderer', level: 2 },
  { id: 'hooks', title: 'Hooks', level: 2 },
  { id: 'types', title: 'Types', level: 2 },
]

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mb-12">
      <h2
        id={id}
        className="mb-5 border-b border-outline-variant pb-3 text-xl font-semibold tracking-tight text-on-surface scroll-mt-20"
        style={{ fontFamily: 'var(--font-inter), sans-serif' }}
      >
        {title}
      </h2>
      {children}
    </section>
  )
}

function ApiEntry({ name, signature, description, params }: {
  name: string
  signature: string
  description: string
  params?: { name: string; type: string; desc: string }[]
}) {
  return (
    <div className="mb-6 rounded-md border border-outline-variant bg-surface-low overflow-hidden">
      <div className="border-b border-outline-variant bg-surface-low px-4 py-2.5">
        <span className="font-mono text-sm font-medium text-on-surface">{name}</span>
      </div>
      <div className="p-4">
        <div className="mb-3 rounded border border-outline-variant bg-surface-container px-3 py-2">
          <code className="font-mono text-xs text-on-surface">{signature}</code>
        </div>
        <p className="mb-3 text-sm text-on-surface-variant">{description}</p>
        {params && params.length > 0 && (
          <div className="space-y-1.5">
            {params.map((p) => (
              <div key={p.name} className="flex gap-3 text-xs">
                <code className="w-32 shrink-0 font-mono text-on-surface">{p.name}</code>
                <code className="w-28 shrink-0 font-mono text-on-surface-variant">{p.type}</code>
                <span className="text-on-surface-variant">{p.desc}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function ApiPage() {
  return (
    <div className="flex gap-12">
      <article className="min-w-0 flex-1 max-w-3xl">
        <div className="mb-8 pb-6 border-b border-outline-variant">
          <div className="label-mono mb-2 text-2xs text-on-surface-variant opacity-60">Reference</div>
          <h1 className="text-3xl font-semibold tracking-tight text-on-surface" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            API Reference
          </h1>
          <p className="mt-3 text-base leading-relaxed text-on-surface-variant">
            Complete reference for TimelineEngine, PlaybackEngine, resolveTimeline, GpuRenderer, React hooks, and TypeScript types.
          </p>
        </div>

        {/* TimelineEngine */}
        <Section id="timeline-engine" title="TimelineEngine">
          <p className="mb-5 text-sm leading-relaxed text-on-surface-variant">
            The single mutation funnel. All edits go through <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">TimelineEngine</code>. Backed by Immer for structural sharing; every commit produces a new Project snapshot.
          </p>

          <ApiEntry
            name="addClip"
            signature="engine.addClip(options: CreateClipOptions): Clip"
            description="Adds a new clip to a track. The clip is placed at startFrame and returns the created Clip object."
            params={[
              { name: 'trackId', type: 'string', desc: 'Target track ID' },
              { name: 'type', type: 'ClipType', desc: "'video' | 'audio' | 'text' | 'image'" },
              { name: 'startFrame', type: 'number', desc: 'Position on the timeline (integer frames)' },
              { name: 'durationFrames', type: 'number', desc: 'Length of the clip (integer frames)' },
              { name: 'src', type: 'string?', desc: 'URL or blob ref for video/audio/image clips' },
              { name: 'text', type: 'TextClipData?', desc: 'Text content and styling for text clips' },
            ]}
          />

          <ApiEntry
            name="moveClip"
            signature="engine.moveClip(clipId: string, options: { startFrame: number; trackId?: string }): void"
            description="Moves a clip to a new position, optionally changing its track."
          />

          <ApiEntry
            name="removeClip"
            signature="engine.removeClip(clipId: string, trackId: string): void"
            description="Removes a clip from a track."
          />

          <ApiEntry
            name="updateClip"
            signature="engine.updateClip(clipId: string, partial: Partial<Clip>): void"
            description="Updates any fields on a clip. Common use: transform, text content, opacity."
          />

          <ApiEntry
            name="addTrack"
            signature="engine.addTrack(kind: TrackKind, name?: string): Track"
            description="Adds a new track to the project."
          />

          <ApiEntry
            name="addTransition"
            signature="engine.addTransition(options: TransitionOptions): void"
            description="Adds a transition between two adjacent clips on the same track."
            params={[
              { name: 'fromClipId', type: 'string', desc: 'The outgoing clip' },
              { name: 'toClipId', type: 'string', desc: 'The incoming clip' },
              { name: 'kind', type: 'TransitionKind', desc: "'fade' | 'slide' | 'wipe'" },
              { name: 'durationFrames', type: 'number', desc: 'How many frames the transition spans' },
              { name: 'easing', type: 'TransitionEasing?', desc: "'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'" },
            ]}
          />

          <ApiEntry
            name="batch"
            signature="engine.batch(fn: () => void, label?: string): void"
            description="Groups multiple mutations into a single undo entry. All mutations inside fn() are committed atomically."
          />

          <ApiEntry
            name="undo / redo"
            signature="engine.undo(): void | engine.redo(): void"
            description="Step backwards/forwards through the commit history."
          />

          <ApiEntry
            name="getProject"
            signature="engine.getProject(): Project"
            description="Returns the current immutable Project snapshot."
          />

          <ApiEntry
            name="setStage"
            signature="engine.setStage(stage: { width: number; height: number }): void"
            description="Sets the canvas output dimensions. All clips are letterboxed to this aspect ratio."
          />
        </Section>

        {/* PlaybackEngine */}
        <Section id="playback-engine" title="PlaybackEngine">
          <p className="mb-5 text-sm leading-relaxed text-on-surface-variant">
            Owns the RAF clock. Emits <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">(frame, isPlaying)</code> snapshots. React consumes it via <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">usePlaybackStore</code>.
          </p>
          <CodeBlock
            language="typescript"
            code={`// Direct usage (advanced — usually use usePlaybackStore instead)
import { PlaybackEngine } from '@elah/core'

const engine = new PlaybackEngine({ fps: 30 })

engine.play()
engine.pause()
engine.seekTo(frame)

// Subscribe to playback ticks
const unsub = engine.subscribe((snapshot) => {
  console.log(snapshot.frame, snapshot.isPlaying)
})`}
          />
        </Section>

        {/* resolveTimeline */}
        <Section id="resolve-timeline" title="resolveTimeline()">
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            The pure, deterministic resolver. Consumes a <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">Project</code> and frame index; produces a <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">Scene</code>. No side effects, no imports, safe to call in tests, workers, and export pipelines.
          </p>
          <CodeBlock
            language="typescript"
            code={`import { resolveTimeline, type Scene } from '@elah/core'

const scene: Scene = resolveTimeline(currentFrame, project)

// Scene shape:
interface Scene {
  frame: number
  videos: ActiveVideoClip[]
  audios: ActiveAudioClip[]
  texts: ActiveTextClip[]
  images: ActiveImageClip[]
  transitions: ActiveTransition[]
}

// Each ActiveVideoClip includes:
interface ActiveVideoClip extends ActiveClipBase {
  src: string
  opacity: number          // 0..1, modified by transitions
  drawRect: DrawRect       // computed placement rectangle
  transform: Transform
  objectFit: 'contain' | 'cover' | 'fill'
}`}
          />
        </Section>

        {/* GpuRenderer */}
        <Section id="gpu-renderer" title="GpuRenderer">
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            The shipped WebGL2 renderer. Accepts a <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">Scene</code> and draws sorted textured quads. Can be replaced with any <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">Renderer</code>-conforming implementation.
          </p>
          <CodeBlock
            language="typescript"
            code={`import { GpuRenderer, type Renderer } from '@elah/core'

// The Renderer interface
interface Renderer {
  render(scene: Scene): void
  destroy(): void
}

// Direct usage (usually consumed through <Preview>)
const canvas = document.createElement('canvas')
const renderer = new GpuRenderer(canvas, {
  width: 1920,
  height: 1080,
})

renderer.render(scene) // called each RAF tick
renderer.destroy()     // cleanup on unmount`}
          />
        </Section>

        {/* Hooks */}
        <Section id="hooks" title="Hooks">
          <div className="space-y-4">
            {[
              {
                hook: 'useTimelineEngine()',
                returns: 'TimelineEngine',
                desc: 'Access the TimelineEngine from any child of EditorProvider. Use this for mutations.',
              },
              {
                hook: 'usePlaybackEngine()',
                returns: 'PlaybackEngine',
                desc: 'Access the PlaybackEngine directly. Usually prefer usePlaybackStore for state.',
              },
              {
                hook: 'useTracksStore(selector)',
                returns: 'T',
                desc: 'Zustand store for tracks, clips, totalFrames. Reactive to all engine mutations.',
              },
              {
                hook: 'usePlaybackStore(selector)',
                returns: 'T',
                desc: 'Zustand store for currentFrame, isPlaying, togglePlayPause, setCurrentFrame.',
              },
              {
                hook: 'useSelectionStore(selector)',
                returns: 'T',
                desc: 'Zustand store for selected clip IDs.',
              },
              {
                hook: 'useTransitionsStore(selector)',
                returns: 'T',
                desc: 'Zustand store for all transitions.',
              },
              {
                hook: 'useMediaLibrary()',
                returns: 'MediaLibraryStore',
                desc: 'Access the media library. Returns { assets, addAsset, removeAsset }.',
              },
            ].map(({ hook, returns, desc }) => (
              <div key={hook} className="rounded-md border border-outline-variant bg-surface-low p-4">
                <div className="mb-1.5 flex items-start gap-3">
                  <code className="font-mono text-sm font-medium text-on-surface">{hook}</code>
                  <span className="mt-0.5 rounded bg-surface-container px-2 py-0.5 font-mono text-xs text-on-surface-variant">
                    → {returns}
                  </span>
                </div>
                <p className="text-xs text-on-surface-variant">{desc}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* Types */}
        <Section id="types" title="Types">
          <CodeBlock
            language="typescript"
            filename="types.ts"
            code={`// Time
type FrameCount = number // always integer

// Core data types
interface Project {
  tracks: Track[]
  transitions: Transition[]
  stage: { width: number; height: number }
  fps: number
}

interface Track {
  id: string
  kind: 'video' | 'audio' | 'text'
  name: string
  muted: boolean
  solo: boolean
  zIndex: number
  clips: Clip[]
}

interface Clip {
  id: string
  trackId: string
  type: 'video' | 'audio' | 'text' | 'image'
  name: string
  src?: string
  startFrame: FrameCount
  durationFrames: FrameCount
  trimInFrames: FrameCount
  trimOutFrames: FrameCount
  transform: Transform
  text?: TextClipData
  opacity: number
  zIndex: number
}

interface Transform {
  x: number       // -1..1 offset (normalized)
  y: number
  scale: number   // 1.0 = contain-fit
  rotation: number // degrees
}

interface TextClipData {
  content: string
  fontSize: number
  color: string
  fontFamily?: string
  fontWeight?: 'normal' | 'bold'
  fontStyle?: 'normal' | 'italic'
  textAlign?: 'left' | 'center' | 'right'
  animation?: TextAnimation
}

interface TextAnimation {
  kind: 'fade-in' | 'fade-out' | 'slide-in' | 'typewriter'
  durationFrames: number
}

interface Transition {
  id: string
  fromClipId: string
  toClipId: string
  kind: 'fade' | 'slide' | 'wipe'
  durationFrames: FrameCount
  easing: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'
  direction?: 'left' | 'right' | 'up' | 'down'
}

// Utility types
interface ExportOptions {
  fps: number
  demuxerFactory: DemuxerFactory
  videoCodec?: 'avc' | 'vp9'
  audioCodec?: 'aac' | 'opus'
  videoBitrate?: number
  audioBitrate?: number
  onProgress?: (p: ExportProgress) => void
}

interface ExportProgress {
  frame: number
  totalFrames: number
  percent: number
  phase: 'encoding' | 'muxing' | 'done'
}`}
          />
        </Section>
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
