import type { Metadata } from 'next'
import Link from 'next/link'
import { CodeBlock } from '@/components/docs/CodeBlock'
import { DocsToc } from '@/components/docs/DocsToc'
import { PageHeader } from '@/components/site/PageHeader'

export const metadata: Metadata = {
  title: 'API Reference',
  description:
    'API reference for @elah/core, @elah/react, @elah/timeline, and @elah/editor: TimelineEngine, PlaybackEngine, resolveTimeline, GpuRenderer, hooks, and types.',
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
    <div className="mb-6 border border-outline-variant bg-surface-low overflow-hidden">
      <div className="border-b border-outline-variant bg-surface-low px-4 py-2.5">
        <span className="font-mono text-sm font-medium text-on-surface">{name}</span>
      </div>
      <div className="p-4">
        <div className="mb-3 border border-outline-variant bg-surface-container px-3 py-2">
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
        <PageHeader
          variant="doc"
          eyebrow="Reference"
          title="API Reference"
          lede={
            <>
              Complete reference for TimelineEngine, PlaybackEngine, resolveTimeline, GpuRenderer, React hooks, and TypeScript types.
            </>
          }
        />

        {/* TimelineEngine */}
        <Section id="timeline-engine" title="TimelineEngine">
          <p className="mb-5 text-sm leading-relaxed text-on-surface-variant">
            The single mutation funnel. All edits go through <code className="bg-surface-container px-1.5 py-0.5 text-xs font-mono">TimelineEngine</code>. Backed by Immer for structural sharing; every commit produces a new Project snapshot.
          </p>

          <ApiEntry
            name="addClip"
            signature="engine.addClip(options: CreateClipOptions): Clip"
            description="Adds a new clip to a track. The clip is placed at startFrame and returns the created Clip object."
            params={[
              { name: 'trackId', type: 'string', desc: 'Target track ID' },
              { name: 'type', type: 'ClipType', desc: "'video' | 'audio' | 'text' | 'image' | 'shape' | 'freehand' | 'adjustment' | 'generator' | 'compound' | 'sequence'" },
              { name: 'startFrame', type: 'number', desc: 'Position on the timeline (integer frames)' },
              { name: 'durationFrames', type: 'number', desc: 'Length of the clip (integer frames)' },
              { name: 'src', type: 'string?', desc: 'URL or blob ref for video/audio/image clips' },
              { name: 'text', type: 'TextClipMetadata?', desc: 'Content + style; required when type is \'text\'' },
              { name: 'generator', type: 'ClipGenerator?', desc: 'Which generator and its params; required when type is \'generator\'' },
              { name: 'compound', type: 'ClipCompound?', desc: 'The nested project; required when type is \'compound\'' },
              { name: 'sequence', type: 'ClipSequence?', desc: 'An animated image or numbered frames; required when type is \'sequence\'' },
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
            description="Adds a new track. Any number of tracks of any kind is allowed. Video tracks composite in track order (the topmost lane draws on top) and a new video track is placed directly below the last existing one; other kinds append, above any bottom-pinned lane."
            params={[
              { name: 'name', type: 'string?', desc: 'Display name; defaults to a kind-based name' },
              { name: 'height', type: 'number?', desc: 'Lane height in px (default 64)' },
              { name: 'order', type: 'number?', desc: 'Explicit render order; normally left to the engine' },
              { name: 'protected', type: 'boolean?', desc: 'When true, the user cannot remove the track' },
              { name: 'pinned', type: "'bottom'?", desc: 'Keeps the lane below every non-pinned track, whatever is added later' },
            ]}
          />

          <ApiEntry
            name="loadProject"
            signature="engine.loadProject(project: Project, options?: { transport?: 'rewind' | 'keep'; history?: 'reset' | 'keep' }): void"
            description="Replaces the whole composition. Pass the result of readProjectDocument(json), which throws ProjectDocumentError for an unreadable or too-new document. By default undo history is cleared and the playhead rewinds; { transport: 'keep', history: 'keep' } is for the relinkProjectMedia repair pass over a composition that is already on screen. Emits 'change' then 'project:loaded'."
            params={[
              { name: 'transport', type: "'rewind' | 'keep'", desc: "'rewind' (default) stops and returns to frame 0; 'keep' leaves the playhead alone" },
              { name: 'history', type: "'reset' | 'keep'", desc: "'reset' (default) clears undo/redo; 'keep' preserves the stacks and any open batch or drag" },
            ]}
          />

          <ApiEntry
            name="setClipSpeed"
            signature="engine.setClipSpeed(clipId: string, trackId: string, speed: number): void"
            description="Sets a video clip's playback multiplier, clamped to 0.25–4. The clip's on-timeline length follows the new speed; growth is clamped to the gap before the next clip."
          />

          <ApiEntry
            name="addTransition"
            signature="engine.addTransition(options): Transition | null"
            description="Adds a transition between two adjacent clips on the same track. Returns the created Transition, or null if the clips aren't found on that track."
            params={[
              { name: 'fromClipId', type: 'string', desc: 'The outgoing clip' },
              { name: 'toClipId', type: 'string', desc: 'The incoming clip' },
              { name: 'trackId', type: 'string', desc: 'Track both clips live on (required)' },
              { name: 'kind', type: 'TransitionKind', desc: "'fade' | 'slide' | 'wipe' | 'zoom' | 'spin' | 'whip' | 'glitchCut' | 'warpDissolve' | 'lumaWipe'" },
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
            Owns the RAF clock. Emits <code className="bg-surface-container px-1.5 py-0.5 text-xs font-mono">(frame, isPlaying)</code> snapshots. React consumes it via <code className="bg-surface-container px-1.5 py-0.5 text-xs font-mono">usePlaybackStore</code>.
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
            The pure, deterministic resolver. Consumes a <code className="bg-surface-container px-1.5 py-0.5 text-xs font-mono">Project</code> and frame index; produces a <code className="bg-surface-container px-1.5 py-0.5 text-xs font-mono">Scene</code>. No side effects, no imports, safe to call in tests, workers, and export pipelines.
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
            The shipped WebGL2 renderer. Accepts a <code className="bg-surface-container px-1.5 py-0.5 text-xs font-mono">Scene</code> and draws sorted textured quads. Can be replaced with any <code className="bg-surface-container px-1.5 py-0.5 text-xs font-mono">Renderer</code>-conforming implementation.
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
          <p className="mb-5 text-sm leading-relaxed text-on-surface-variant">
            All hooks below live in <code className="bg-surface-container px-1.5 py-0.5 text-xs font-mono">@elah/react</code> and are re-exported by <code className="bg-surface-container px-1.5 py-0.5 text-xs font-mono">@elah/editor</code> — install <code className="bg-surface-container px-1.5 py-0.5 text-xs font-mono">@elah/react</code> directly if you&apos;re building custom UI on <code className="bg-surface-container px-1.5 py-0.5 text-xs font-mono">@elah/core</code> without the full editor SDK. The <Link href="/docs/react" className="text-on-surface underline decoration-primary underline-offset-4 hover:decoration-2">@elah/react page</Link> covers the context, the store hooks, the audio hooks and using the same stores without React in detail.
          </p>
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
                hook: 'useTextStylePresetsStore(selector)',
                returns: 'T',
                desc: 'Zustand store for reusable text looks: the built-in presets plus any the user saves.',
              },
              {
                hook: 'useClipLoadStore(selector)',
                returns: 'T',
                desc: "Zustand store of which clips the preview cannot draw yet: byClipId[id] is 'loading' or 'error'. Renderer state only; never saved or undoable.",
              },
              {
                hook: 'useMediaLibrary()',
                returns: 'UseMediaLibraryApi',
                desc: 'Access the media library. Returns { assets, getAsset, removeAsset, updateAsset, importFiles, importUrl, importBlob }.',
              },
              {
                hook: 'useAudioMixer(controller)',
                returns: 'AudioMixerApi',
                desc: 'Click-free master/track gain controls for an AudioPlaybackController. Pass null while the controller isn’t initialized yet — methods become no-ops.',
              },
              {
                hook: 'useMasterVolume(controller, engine)',
                returns: 'MasterVolumeApi',
                desc: 'Master volume with both immediate audio-graph control and persistence to the project model.',
              },
              {
                hook: 'useTrackLevels(controller)',
                returns: 'Map<string, TrackLevel>',
                desc: 'Polls per-track RMS levels on every animation frame, for building level meters.',
              },
            ].map(({ hook, returns, desc }) => (
              <div key={hook} className="border border-outline-variant bg-surface-low p-4">
                <div className="mb-1.5 flex flex-wrap items-start gap-x-3 gap-y-1.5">
                  <code className="font-mono text-sm font-medium text-on-surface">{hook}</code>
                  <span className="mt-0.5 min-w-0 max-w-full break-words bg-surface-container px-2 py-0.5 font-mono text-xs text-on-surface-variant">
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
          <p className="mb-5 text-sm leading-relaxed text-on-surface-variant">
            The clip and track fields added in 0.6.0 (<code className="bg-surface-container px-1.5 py-0.5 text-xs font-mono">Clip.speed</code>, <code className="bg-surface-container px-1.5 py-0.5 text-xs font-mono">Clip.crop</code>, <code className="bg-surface-container px-1.5 py-0.5 text-xs font-mono">Clip.cornerRadius</code>, <code className="bg-surface-container px-1.5 py-0.5 text-xs font-mono">Track.protected</code>, <code className="bg-surface-container px-1.5 py-0.5 text-xs font-mono">Track.pinned</code>) are explained on <Link href="/docs/clips" className="text-on-surface underline decoration-primary underline-offset-4 hover:decoration-2">Clips &amp; Tracks</Link>. Layered text motion is on <Link href="/docs/text-templates-and-motion" className="text-on-surface underline decoration-primary underline-offset-4 hover:decoration-2">Text Templates &amp; Motion</Link>.
          </p>
          <CodeBlock
            language="typescript"
            filename="types.ts"
            code={`// Time
type FrameCount = number // always integer

type ClipType =
  | 'video' | 'audio' | 'text' | 'image' | 'shape' | 'freehand'
  | 'adjustment' | 'generator' | 'compound' | 'sequence'
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
  protected?: boolean     // the user cannot remove this track
  pinned?: 'bottom'       // addTrack keeps this lane below every non-pinned track
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
  speed?: number                // video only; 0.25..4, default 1
  cornerRadius?: number         // video/image; 0..0.5 of the shorter side
  crop?: { x: number; y: number; width: number; height: number } // 0..1 of the source
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
  shapeAnimation?: TextAnimation
  // Shape / freehand clips have their own shape*/stroke*/pathData fields.
}

interface Transform {
  x: number        // 0..1, normalized to stage width
  y: number        // 0..1, normalized to stage height
  scale: number    // 1 = native size
  scaleX?: number  // extra horizontal stretch on top of scale; omitted = 1
  scaleY?: number  // extra vertical stretch on top of scale; omitted = 1
  rotation: number // radians, positive = clockwise
  anchor: { x: number; y: number } // 0..1 within the clip box
}

// Entry/exit ramp for text (and shape) clips.
type TextAnimationKind = 'fade' | 'spin' | 'slide-up' | 'slide-down' | 'slide-left' | 'slide-right'

interface TextAnimation {
  in?: TextAnimationKind
  out?: TextAnimationKind
  durationFrames: number
  // Layered motion. When present it replaces in / out; used by text templates.
  inMotion?: MotionSpec
  outMotion?: MotionSpec
}

// One end of a layered animation: the state at the FAR end of the ramp.
// The near end is always the clip's resting state. Omitted channels stay at rest.
interface MotionSpec {
  opacity?: number       // 0..1
  offsetX?: number       // fraction of stage width
  offsetY?: number       // fraction of stage height
  scale?: number         // multiplier on the authored scale
  rotation?: number      // radians
  ease?: TextAnimationEasing        // geometry channels
  opacityEase?: TextAnimationEasing // default 'linear'
}

interface Transition {
  id: string
  kind: 'fade' | 'slide' | 'wipe'
      | 'zoom' | 'spin' | 'whip' | 'glitchCut' | 'warpDissolve' | 'lumaWipe'
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
type ExportVideoCodec = 'avc' | 'hevc' | 'av1' | 'vp9' | 'vp8' // where the browser can encode it
type ExportAudioCodec = 'aac' | 'opus'
type ExportContainer = 'mp4' | 'webm' | 'png-sequence' | 'gif'

interface ExportOptions {
  videoCodec?: ExportVideoCodec   // default 'avc'
  audioCodec?: ExportAudioCodec
  container?: ExportContainer     // default 'mp4'
  transparent?: boolean           // webm only, where the browser's own check passes
  range?: 'all' | 'inOut'         // default 'all'
  gifFps?: number                 // gif only, default 15
  videoBitrate?: number           // bits/s, default 8 Mbps
  audioBitrate?: number           // bits/s, default 128 kbps
  outputHeight?: number           // target SHORT edge in px (1080 = 1080p in either
                                  // orientation); other edge is rounded to even.
                                  // Default = the stage's own short edge
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
