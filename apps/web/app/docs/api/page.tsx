import type { Metadata } from 'next'
import { CodeBlock } from '@/components/docs/CodeBlock'
import { DocsToc } from '@/components/docs/DocsToc'

export const metadata: Metadata = {
  title: 'API Reference',
  description:
    'API reference for @elah/core, @elah/timeline, and @elah/editor: TimelineEngine, PlaybackEngine, resolveTimeline, GpuRenderer, hooks, and types.',
  alternates: { canonical: '/docs/api' },
}

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
        className="mb-5 border-b border-outline-variant pb-3 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20"
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
              <div key={p.name} className="flex flex-col gap-0.5 text-xs sm:flex-row sm:gap-3">
                <code className="font-mono text-on-surface sm:w-32 sm:shrink-0">{p.name}</code>
                <code className="font-mono text-on-surface-variant sm:w-28 sm:shrink-0">{p.type}</code>
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
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
      <article className="min-w-0 flex-1 max-w-3xl">
        <div className="mb-8 pb-6 border-b border-outline-variant">
          <div className="label-mono mb-2 text-2xs text-on-surface-variant opacity-90">Reference</div>
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
              { name: 'type', type: 'ClipType', desc: "'video' | 'audio' | 'text' | 'image' | 'shape' | 'freehand'" },
              { name: 'startFrame', type: 'number', desc: 'Position on the timeline (integer frames)' },
              { name: 'durationFrames', type: 'number', desc: 'Length of the clip (integer frames)' },
              { name: 'src', type: 'string?', desc: 'URL or blob ref for video/audio/image clips' },
              { name: 'text', type: 'TextClipMetadata?', desc: 'Content + style; required when type is \'text\'' },
            ]}
          />

          <ApiEntry
            name="moveClip"
            signature="engine.moveClip(clipId: string, fromTrackId: string, toTrackId: string, startFrame: number): void"
            description="Moves a clip to a new start frame, optionally onto a different track. Pass the same id for fromTrackId and toTrackId to move within a track. No-ops if the move would overlap a neighbour or either track is locked."
          />

          <ApiEntry
            name="removeClip"
            signature="engine.removeClip(clipId: string, trackId: string): void"
            description="Removes a clip from a track."
          />

          <ApiEntry
            name="updateClip"
            signature="engine.updateClip(clipId: string, trackId: string, updates: Partial<Clip>): void"
            description="Updates any fields on a clip. Common use: transform, text content, opacity. During drag/trim gestures prefer previewClip() + commitInteraction() so the interaction is a single undo entry."
          />

          <ApiEntry
            name="addTrack"
            signature="engine.addTrack(kind: TrackKind, options?: Partial<CreateTrackOptions>): Track"
            description="Adds a new track. Video is capped at one lane — adding a video track when one exists returns the existing track (idempotent)."
          />

          <ApiEntry
            name="addTransition"
            signature="engine.addTransition(options): Transition | null"
            description="Adds a transition between two adjacent clips on the same track. Returns the created Transition, or null if the clips aren't found on that track."
            params={[
              { name: 'fromClipId', type: 'string', desc: 'The outgoing clip' },
              { name: 'toClipId', type: 'string', desc: 'The incoming clip' },
              { name: 'trackId', type: 'string', desc: 'Track both clips live on (required)' },
              { name: 'kind', type: 'TransitionKind', desc: "'fade' | 'slide' | 'wipe'" },
              { name: 'durationFrames', type: 'number', desc: 'How many frames the transition spans' },
              { name: 'easing', type: 'TransitionEasing?', desc: "'linear' | 'ease-in' | 'ease-out'" },
            ]}
          />

          <ApiEntry
            name="batch"
            signature="engine.batch(fn: () => void, label?: string): void"
            description="Groups multiple mutations into a single undo entry. All mutations inside fn() are committed atomically."
          />

          <ApiEntry
            name="undo / redo"
            signature="engine.undo(): boolean | engine.redo(): boolean"
            description="Step backwards/forwards through the commit history. Returns true if a step was applied (use canUndo() / canRedo() to gate UI)."
          />

          <ApiEntry
            name="getProject"
            signature="engine.getProject(): Project"
            description="Returns the current immutable Project snapshot."
          />

          <ApiEntry
            name="setStage"
            signature="engine.setStage(width: number, height: number): void"
            description="Sets the canvas output dimensions. Clips re-fit to the new stage on the next resolve — placement is normalized, so no per-clip migration is needed."
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
engine.seek(frame)

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
  fps: number
  stage: { width: number; height: number }
  videos: ActiveVideoClip[]
  audios: ActiveAudioClip[]
  texts: ActiveTextClip[]
  images: ActiveImageClip[]
  shapes: ActiveShapeClip[]
  freehand: ActiveFreehandClip[]
  transitions: ActiveTransition[]
}

// Fields shared by every active clip:
interface ActiveClipBase {
  id: string
  trackId: string
  name: string
  sourceFrame: number      // source-asset frame at the current playhead
  opacity: number          // 0..1, modified by transitions
  zIndex: number           // higher = closer to viewer (front)
  transform?: Transform    // undefined → renderer default (contain-fit)
}

// Each ActiveVideoClip adds:
interface ActiveVideoClip extends ActiveClipBase {
  type: 'video'
  src: string
  volume: number           // 0..1, after track mute
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
  mount(container: HTMLElement): void
  resize(cssWidth: number, cssHeight: number, dpr?: number): void
  render(scene: Scene): void
  prewarm?(scene: Scene): void   // optional decode look-ahead
  dispose(): void
}

// Direct usage (usually consumed through <Preview>)
// The constructor takes RendererOptions — the stage size comes from the
// Scene each tick, not the constructor. Pass a demuxerFactory to enable
// the real WebCodecs decode pipeline.
const renderer = new GpuRenderer({
  demuxerFactory: () => createMediabunnyBackend(mediabunny),
})

renderer.mount(containerEl)      // attach to the DOM once
renderer.resize(1920, 1080, window.devicePixelRatio)
renderer.render(scene)           // called each RAF tick
renderer.dispose()               // cleanup on unmount`}
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
                returns: 'UseMediaLibraryApi',
                desc: 'Access the media library. Returns { assets, getAsset, removeAsset, updateAsset, importFiles, importUrl, importBlob }.',
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

type ClipType = 'video' | 'audio' | 'text' | 'image' | 'shape' | 'freehand'
type TrackKind = 'video' | 'audio' | 'elements'

// Core data types
interface Project {
  id: string
  fps: number
  stage: { width: number; height: number }
  tracks: Track[]
  // Clips are stored keyed by trackId, NOT nested on Track.
  clips: Record<string, Clip[]>
  transitions: Transition[]
  version: number
  masterVolume?: number   // 0..2, linear
}

interface Track {
  id: string
  name: string
  kind: TrackKind
  order: number           // lower = closer to top of timeline
  height: number          // px
  locked: boolean
  disabled: boolean
  muted: boolean
  solo: boolean
  volume?: number         // 0..2, linear
}

interface Clip {
  id: string
  trackId: string
  type: ClipType
  name: string
  startFrame: FrameCount        // position on the timeline
  durationFrames: FrameCount    // length on the timeline
  sourceStartFrame: FrameCount  // trim in-point into the source
  sourceDurationFrames: FrameCount
  src?: string
  assetId?: string
  transform?: Transform
  opacity?: number              // 0..1
  volume?: number               // 0..1
  locked?: boolean
  disabled?: boolean
  // Text clips (flat fields, not a nested object):
  content?: string
  fontSize?: number
  color?: string
  fontFamily?: string
  fontWeight?: 'normal' | 'bold'
  textAlign?: 'left' | 'center' | 'right'
  textAnimation?: TextAnimation
  // Shape / freehand clips have their own shape*/stroke*/pathData fields.
}

interface Transform {
  x: number        // 0..1, normalized to stage width
  y: number        // 0..1, normalized to stage height
  scale: number    // 1 = native size
  rotation: number // radians, positive = clockwise
  anchor: { x: number; y: number } // 0..1 within the clip box
}

// Entry/exit ramp for text (and shape) clips.
interface TextAnimation {
  in?: 'fade'
  out?: 'fade'
  durationFrames: number
}

interface Transition {
  id: string
  kind: 'fade' | 'slide' | 'wipe'
  fromClipId: string
  toClipId: string
  trackId: string
  startFrame: FrameCount   // = toClip.startFrame - durationFrames / 2
  durationFrames: FrameCount
  direction?: 'left' | 'right' | 'up' | 'down'
  easing?: 'linear' | 'ease-in' | 'ease-out'
}

// Export — fps is read from project.fps; the export worker uses
// mediabunny directly, so there is no demuxerFactory here.
type ExportVideoCodec = 'avc' | 'vp9' | 'vp8'
type ExportAudioCodec = 'aac' | 'opus'

interface ExportOptions {
  videoCodec?: ExportVideoCodec   // default 'avc'
  audioCodec?: ExportAudioCodec
  videoBitrate?: number           // bits/s, default 8 Mbps
  audioBitrate?: number           // bits/s, default 128 kbps
  outputHeight?: number           // scale output; default = stage height
  onProgress?: (p: ExportProgress) => void
  signal?: AbortSignal
}

interface ExportProgress {
  frame: number
  totalFrames: number
}`}
          />
        </Section>
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
