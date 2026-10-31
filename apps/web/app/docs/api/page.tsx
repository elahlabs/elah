import type { Metadata } from 'next'
import Link from 'next/link'
import { DocsToc } from '@/components/docs/DocsToc'
import { Code } from '@/components/docs/Code'
import { C, Callout, DocsPager, H2, H3, P, PropTable } from '@/components/docs/DocsKit'
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

const link = 'text-on-surface underline decoration-[#FF003C] underline-offset-4 hover:decoration-2'

export default function ApiPage() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
      <article className="min-w-0 max-w-3xl flex-1">
        <PageHeader
          variant="doc"
          eyebrow="Reference"
          title="API Reference"
          lede="The engine's main classes and functions on one page: what each call takes and what it does. The guides link here for exact signatures."
        />
        <P>
          Everything below is exported by <C>@elah/core</C> and re-exported by <C>@elah/editor</C>; the hooks come from <C>@elah/react</C>.
        </P>

        <H2 id="timeline-engine">TimelineEngine</H2>
        <P>
          Every change to a project goes through the engine. Each change makes a new immutable <C>Project</C> and an undo step. Get it with{' '}
          <C>useTimelineEngine()</C> inside an <C>EditorProvider</C>.
        </P>
        <Callout kind="warning" title="Clip calls take the track id too">
          Clips are stored per track, so most clip methods need both <C>clipId</C> and <C>trackId</C>.
        </Callout>

        <H3>Clips</H3>
        <PropTable
          nameLabel="Method"
          rows={[
            { name: 'addClip(options)', type: '→ Clip', desc: <>Add a clip. <C>trackId</C>, <C>type</C>, <C>startFrame</C> and <C>durationFrames</C> are required, plus <C>text</C>, <C>generator</C>, <C>compound</C> or <C>sequence</C> for those clip types.</> },
            { name: 'updateClip(clipId, trackId, changes)', type: '→ void', desc: 'Change any fields: transform, text, opacity, keyframes…' },
            { name: 'moveClip(clipId, fromTrackId, toTrackId, startFrame)', type: '→ void', desc: 'Move in time or to another track. Ignored if it would overlap a clip or either track is locked.' },
            { name: 'trimClip(clipId, trackId, startFrame, durationFrames)', type: '→ void', desc: 'Set a new start and length.' },
            { name: 'splitClip(clipId, trackId, atFrame)', type: '→ [leftId, rightId] | null', desc: 'Cut a clip in two. null if it could not split, for example on a locked track.' },
            { name: 'removeClip(clipId, trackId)', type: '→ void', desc: 'Delete a clip.' },
            { name: 'setClipSpeed(clipId, trackId, speed)', type: '→ void', desc: <>Video only, 0.25 to 4. Also updates the clip&apos;s length. See <Link href="/docs/clips#speed" className={link}>Speed</Link>.</> },
          ]}
        />
        <H3>Drags</H3>
        <PropTable
          nameLabel="Method"
          rows={[
            { name: 'previewClip(clipId, trackId, changes)', type: '→ void', desc: 'Show a change while the user is still dragging, without an undo step.' },
            { name: 'commitInteraction(description?)', type: '→ void', desc: 'Finish the drag as one undo step.' },
          ]}
        />
        <H3>Tracks</H3>
        <PropTable
          nameLabel="Method"
          rows={[
            { name: 'addTrack(kind, options?)', type: '→ Track', desc: <>Options: <C>name</C>, <C>height</C> (default 64), <C>order</C>, <C>protected</C>, <C>pinned</C>. A new video track goes below the last video track. See <Link href="/docs/clips#multiple-video-tracks" className={link}>Multiple video tracks</Link>.</> },
            { name: 'updateTrack(trackId, changes)', type: '→ void', desc: 'Rename, resize, lock, mute and so on.' },
            { name: 'reorderTracks(orderedIds)', type: '→ void', desc: 'Pass every track id, topmost first.' },
            { name: 'removeTrack(trackId)', type: '→ void', desc: 'Does nothing for a protected track.' },
          ]}
        />
        <H3>Transitions</H3>
        <PropTable
          nameLabel="Method"
          rows={[
            { name: 'addTransition({ fromClipId, toClipId, trackId, kind, durationFrames, easing?, direction? })', type: '→ Transition | null', desc: <>Between two neighbouring clips on one track. null if the clips are not on that track. Kinds are listed on <Link href="/docs/editor#transitions" className={link}>Editor: Transitions</Link>.</> },
            { name: 'removeTransition(id)', type: '→ void', desc: 'Delete a transition.' },
          ]}
        />
        <H3>Project &amp; history</H3>
        <PropTable
          nameLabel="Method"
          rows={[
            { name: 'getProject()', type: '→ Project', desc: 'The current project. Immutable: never edit it in place.' },
            { name: 'loadProject(project, { transport?, history? })', type: '→ void', desc: <>Replace everything. Pass the result of <C>readProjectDocument</C>. See <Link href="/docs/project-documents#load-project" className={link}>loadProject</Link>.</> },
            { name: 'setStage(width, height)', type: '→ void', desc: 'Change the frame size. Positions are fractions of the stage, so clips refit on their own.' },
            { name: 'setMasterVolume(value)', type: '→ void', desc: 'Saved on the project, so it is exported too.' },
            { name: 'batch(fn, description?)', type: '→ void', desc: 'Every change inside fn becomes one undo step.' },
            { name: 'undo() · redo()', type: '→ boolean', desc: 'True if a step was applied. Use canUndo() and canRedo() to enable buttons.' },
          ]}
        />
        <H3>Events</H3>
        <Code
          code={`
const onChange = (project) => save(project)
engine.on('change', onChange)
engine.off('change', onChange)`}
        />
        <P>
          <C>change</C> · <C>history:change</C> · <C>project:loaded</C> · <C>track:added</C> · <C>track:removed</C> · <C>clip:added</C> ·{' '}
          <C>clip:removed</C> · <C>clip:updated</C> · <C>clip:split</C> · <C>transition:added</C> · <C>transition:removed</C>
        </P>

        <H2 id="playback-engine">PlaybackEngine</H2>
        <P>
          The clock. It decides which frame is showing and whether it is playing. In React you normally read it through <C>usePlaybackStore</C>;
          use it directly outside React or for a custom transport.
        </P>
        <Code
          highlight={[3, 4, 5, 6]}
          code={`
import { PlaybackEngine, tracksStore } from '@elah/core'

const playback = new PlaybackEngine({
  fps: 30,
  getTotalFrames: () => tracksStore.getState().totalFrames, // when to stop or loop
})

playback.play()
playback.seek(90)

const unsubscribe = playback.subscribe(({ currentFrame, isPlaying }) => {
  render(currentFrame)
})`}
        />
        <PropTable
          nameLabel="Member"
          rows={[
            { name: 'new PlaybackEngine({ fps, getTotalFrames })', desc: <><C>getTotalFrames</C> is required: the clock asks it each tick to know when to stop or loop.</> },
            { name: 'play() · pause() · seek(frame)', desc: 'Transport.' },
            { name: 'setLoop(loop) · setPlaybackRate(rate)', desc: 'Looping and speed.' },
            { name: 'subscribe(fn)', desc: <>Called with <C>{'{ currentFrame, isPlaying, playbackRate, loop, epoch }'}</C>. Returns an unsubscribe function.</> },
            { name: 'isPlaying', desc: 'Whether it is playing now.' },
            { name: 'destroy()', desc: 'Stop the clock for good.' },
          ]}
        />

        <H2 id="resolve-timeline">resolveTimeline()</H2>
        <P>
          Turns a project and a frame number into a <C>Scene</C>: everything visible and audible at that frame. It has no side effects, so it
          runs the same in tests, workers and export. The preview and the exporter both draw from it.
        </P>
        <Code
          highlight={[3]}
          code={`
import { resolveTimeline, type Scene } from '@elah/core'

const scene: Scene = resolveTimeline(frame, project)`}
        />
        <PropTable
          nameLabel="Scene field"
          rows={[
            { name: 'frame · fps · stage', desc: 'Where and what size.' },
            { name: 'videos · images · texts · shapes · freehand', desc: 'The clips on screen, each with its id, source frame, opacity, z-index and transform.' },
            { name: 'audios', desc: 'The clips that are playing sound, with volume after track mute.' },
            { name: 'transitions', desc: 'Active transitions, with their eased progress.' },
            { name: 'adjustments · rotoMasks', type: 'optional', desc: 'Adjustment layers and masks, when the project has them.' },
          ]}
        />

        <H2 id="gpu-renderer">GpuRenderer</H2>
        <P>
          The WebGL2 renderer that <C>Preview</C> uses. It draws a <C>Scene</C>, and nothing else. You can swap in your own renderer by
          implementing the same <C>Renderer</C> interface; see{' '}
          <Link href="/docs/plugins" className={link}>
            Plugins
          </Link>
          .
        </P>
        <Code
          highlight={[3]}
          code={`
import { GpuRenderer, createDefaultDemuxerFactory } from '@elah/core'

const renderer = new GpuRenderer({ demuxerFactory: createDefaultDemuxerFactory() })
renderer.mount(containerEl)
renderer.resize(width, height, window.devicePixelRatio)
renderer.render(scene) // every frame
renderer.dispose()     // on unmount`}
        />
        <PropTable
          nameLabel="Renderer method"
          rows={[
            { name: 'mount(container)', desc: 'Attach to a DOM element, once.' },
            { name: 'resize(cssWidth, cssHeight, dpr?)', desc: 'The canvas size in CSS pixels. The stage is fitted inside, letterboxed.' },
            { name: 'render(scene)', desc: 'Draw one frame.' },
            { name: 'prewarm?(scene)', desc: 'Optional: start decoding a frame ahead of time.' },
            { name: 'dispose()', desc: 'Release everything.' },
          ]}
        />
        <Callout title="The stage size comes from the Scene">
          The constructor takes options such as <C>demuxerFactory</C>, not a size. Without a demuxer factory, video shows placeholder frames
          instead of decoding.
        </Callout>

        <H2 id="hooks">Hooks</H2>
        <P>
          From <C>@elah/react</C>, re-exported by <C>@elah/editor</C>. The{' '}
          <Link href="/docs/react" className={link}>
            @elah/react page
          </Link>{' '}
          explains each in detail.
        </P>
        <PropTable
          nameLabel="Hook"
          rows={[
            { name: 'useTimelineEngine()', type: '→ TimelineEngine', desc: 'For edits.' },
            { name: 'usePlaybackEngine()', type: '→ PlaybackEngine', desc: 'The clock itself. Usually read usePlaybackStore instead.' },
            { name: 'useEditor()', type: '→ { engine, playback }', desc: 'Both.' },
            { name: 'useTracksStore(selector)', desc: 'Tracks, clips, stage, totalFrames, canUndo, canRedo.' },
            { name: 'usePlaybackStore(selector)', desc: 'Current frame, playing, rate, loop, volume, zoom, and transport actions.' },
            { name: 'useSelectionStore(selector)', desc: 'Selected clips and the active track.' },
            { name: 'useTransitionsStore(selector)', desc: 'All transitions.' },
            { name: 'useMediaLibrary()', desc: 'Assets, plus importFiles, importUrl and importBlob.' },
            { name: 'useClipLoadStore(selector)', desc: 'Which clips cannot be drawn yet.' },
            { name: 'useTextStylePresetsStore(selector)', desc: 'The user’s saved text styles.' },
            { name: 'useAudioMixer · useMasterVolume · useTrackLevels', desc: 'Gain, master volume and level meters for an AudioPlaybackController.' },
          ]}
        />

        <H2 id="types">Types</H2>
        <P>
          The data model. Field-by-field tables with descriptions are on{' '}
          <Link href="/docs/timeline#tracks-and-clips" className={link}>
            Timeline: Tracks &amp; clips
          </Link>
          ,{' '}
          <Link href="/docs/editor#transforms" className={link}>
            Editor: Transforms
          </Link>{' '}
          and{' '}
          <Link href="/docs/text-templates-and-motion#motion-spec" className={link}>
            MotionSpec
          </Link>
          ; export options are on{' '}
          <Link href="/docs/export#export-video" className={link}>
            Export
          </Link>
          .
        </P>
        <Code
          title="Project & Track"
          code={`
interface Project {
  id: string
  fps: number
  stage: { width: number; height: number }
  tracks: Track[]
  clips: Record<string, Clip[]> // keyed by track id, not nested in Track
  transitions: Transition[]
  version: number
  masterVolume?: number         // 0..2
}

type TrackKind = 'video' | 'audio' | 'elements'

interface Track {
  id: string
  name: string
  kind: TrackKind
  order: number                 // lower = higher on the timeline
  height: number
  locked: boolean
  disabled: boolean
  muted: boolean
  solo: boolean
  volume?: number               // 0..2
  protected?: boolean
  pinned?: 'bottom'
}`}
        />
        <Code
          title="Clip"
          code={`
type ClipType =
  | 'video' | 'audio' | 'text' | 'image' | 'shape' | 'freehand'
  | 'adjustment' | 'generator' | 'compound' | 'sequence'

interface Clip {
  id: string
  trackId: string
  type: ClipType
  name: string
  startFrame: number            // whole frames
  durationFrames: number
  sourceStartFrame: number      // trim in-point
  sourceDurationFrames: number
  src?: string
  assetId?: string
  transform?: Transform
  opacity?: number              // 0..1
  volume?: number
  speed?: number                // video; 0.25..4
  crop?: { x: number; y: number; width: number; height: number }
  cornerRadius?: number         // 0..0.5
  locked?: boolean
  disabled?: boolean
  // text clips: content, fontSize, color, fontFamily, fontWeight, textAlign
  textAnimation?: TextAnimation
  shapeAnimation?: TextAnimation
}`}
        />
        <Code
          title="Transform & Transition"
          code={`
interface Transform {
  x: number                     // 0..1 of stage width
  y: number                     // 0..1 of stage height
  scale: number                 // 1 = native size
  scaleX?: number
  scaleY?: number
  rotation: number              // radians, clockwise
  anchor: { x: number; y: number }
}

interface Transition {
  id: string
  kind: 'fade' | 'slide' | 'wipe' | 'zoom' | 'spin' | 'whip'
      | 'glitchCut' | 'warpDissolve' | 'lumaWipe'
  fromClipId: string
  toClipId: string
  trackId: string
  startFrame: number
  durationFrames: number
  direction?: 'left' | 'right' | 'up' | 'down'
  easing?: 'linear' | 'ease-in' | 'ease-out'
}`}
        />
        <Callout title="Time is always whole frames">
          Every position and length in a project is an integer frame count. Convert at the edges with <C>secondsToFrames</C> and{' '}
          <C>framesToSeconds</C>.
        </Callout>

        <DocsPager href="/docs/api" />
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
