import type { Metadata } from 'next'
import { CodeBlock } from '@/components/docs/CodeBlock'
import { DocsToc } from '@/components/docs/DocsToc'

export const metadata: Metadata = { title: 'Timeline' }

const toc = [
  { id: 'overview', title: 'Overview', level: 2 },
  { id: 'tracks-and-clips', title: 'Tracks & Clips', level: 2 },
  { id: 'playback', title: 'Playback', level: 2 },
  { id: 'zooming', title: 'Zooming & Snapping', level: 2 },
  { id: 'transitions', title: 'Transitions', level: 2 },
  { id: 'shortcuts', title: 'Keyboard Shortcuts', level: 2 },
]

export default function TimelinePage() {
  return (
    <div className="flex gap-12">
      <article className="min-w-0 flex-1 max-w-3xl">
        <div className="mb-8 pb-6 border-b border-outline-variant">
          <div className="label-mono mb-2 text-2xs text-on-surface-variant opacity-60">Timeline</div>
          <h1 className="text-3xl font-semibold tracking-tight text-on-surface" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Timeline
          </h1>
          <p className="mt-3 text-base leading-relaxed text-on-surface-variant">
            The Timeline component is a fully interactive NLE timeline. Tracks, clips, drag-to-trim, drag-to-move, snapping, zoom, and the full keyboard shortcut set.
          </p>
        </div>

        {/* Overview */}
        <section className="mb-10">
          <h2 id="overview" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Overview
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            The <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">Timeline</code> component reads state from <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">useTracksStore</code> and dispatches mutations through <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">TimelineEngine</code>. It is fully controlled by the Zustand stores — you can read or write those stores directly to drive the timeline from outside.
          </p>
          <CodeBlock
            language="tsx"
            filename="Example: Timeline only"
            code={`import { useRef } from 'react'
import {
  EditorProvider,
  Timeline,
  type TimelineRef,
  type InitialTrackConfig,
} from '@elah/editor'

const TRACKS: InitialTrackConfig[] = [
  { kind: 'video', name: 'Video / Image' },
  { kind: 'audio', name: 'Audio' },
  { kind: 'elements', name: 'Elements' },
]

export default function TimelineOnlyDemo() {
  const ref = useRef<TimelineRef>(null)

  return (
    <EditorProvider fps={30} initialTracks={TRACKS}>
      <Timeline
        ref={ref}
        fps={30}
        style={{ height: 260 }}
      />
    </EditorProvider>
  )
}`}
          />
        </section>

        {/* Tracks & Clips */}
        <section className="mb-10">
          <h2 id="tracks-and-clips" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Tracks & Clips
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            Each <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">Track</code> has a <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">kind</code>: <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">video</code>, <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">audio</code>, or <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">elements</code> (text, shapes, and freehand live on <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">elements</code> tracks). V1 uses a fixed 3-lane layout. Clips are stored on the <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">Project</code> keyed by track id (<code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">project.clips[trackId]</code>).
          </p>
          <CodeBlock
            language="typescript"
            filename="types.ts (data model)"
            code={`interface Track {
  id: string
  name: string
  kind: 'video' | 'audio' | 'elements'
  order: number          // lower = closer to top of timeline
  height: number         // px
  locked: boolean
  disabled: boolean
  muted: boolean
  solo: boolean
  volume?: number        // 0..2, linear
}

interface Clip {
  id: string
  trackId: string
  type: 'video' | 'audio' | 'text' | 'image' | 'shape' | 'freehand'
  name: string
  src?: string                  // URL or blob ref for video/audio/image
  startFrame: number            // integer — position on the timeline
  durationFrames: number        // integer — length on the timeline
  sourceStartFrame: number      // trim in-point into the source asset
  sourceDurationFrames: number  // source length (used for trim constraints)
  transform?: Transform         // position, scale, rotation (optional)
  opacity?: number              // 0..1, managed by the transition system
  // Text clips carry flat style fields (content, fontSize, color, ...).
}

// Clips are NOT nested on Track. The Project stores them keyed by track:
//   project.clips: Record<string /* trackId */, Clip[]>`}
          />
          <p className="mt-4 mb-4 text-sm leading-relaxed text-on-surface-variant">
            Add and remove clips via the engine:
          </p>
          <CodeBlock
            language="tsx"
            code={`const engine = useTimelineEngine()

// Add a video clip
engine.addClip({
  trackId: videoTrack.id,
  type: 'video',
  src: 'https://example.com/video.mp4',
  startFrame: 0,
  durationFrames: 150, // 5 seconds at 30fps
  name: 'Intro',
})

// Move a clip to a new start frame (same track here — pass the target
// track id as the 3rd arg to move it across tracks).
engine.moveClip(clipId, videoTrack.id, videoTrack.id, 30)

// Remove a clip
engine.removeClip(clipId, trackId)

// Split the selected clip at the current playhead. Reads the selection
// and playhead from the stores — just hand it the engine.
import { splitClipAtPlayhead } from '@elah/editor'
splitClipAtPlayhead(engine)`}
          />
        </section>

        {/* Playback */}
        <section className="mb-10">
          <h2 id="playback" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Playback
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            The <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">PlaybackEngine</code> owns the RAF clock and publishes <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">(frame, isPlaying)</code> snapshots. React reads playback state via <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">usePlaybackStore</code>:
          </p>
          <CodeBlock
            language="tsx"
            filename="TransportControls.tsx"
            code={`import {
  usePlaybackStore,
  useTracksStore,
  framesToTimecode,
} from '@elah/editor'

export function TransportControls({ fps = 30 }) {
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const togglePlayPause = usePlaybackStore((s) => s.togglePlayPause)
  const currentFrame = usePlaybackStore((s) => s.currentFrame)
  const setCurrentFrame = usePlaybackStore((s) => s.setCurrentFrame)
  const totalFrames = useTracksStore((s) => s.totalFrames)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button onClick={() => setCurrentFrame(0)}>⏮</button>
      <button onClick={togglePlayPause}>
        {isPlaying ? '⏸ Pause' : '▶ Play'}
      </button>
      <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
        {framesToTimecode(currentFrame, fps)}
        {' / '}
        {framesToTimecode(totalFrames, fps)}
      </span>
    </div>
  )
}`}
          />
        </section>

        {/* Zooming & snapping */}
        <section className="mb-10">
          <h2 id="zooming" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Zooming & Snapping
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            The timeline supports <strong className="text-on-surface font-medium">Ctrl/Cmd + scroll</strong> to zoom. Clips snap to other clip edges, the playhead, and track boundaries. The snap tolerance is configurable:
          </p>
          <CodeBlock
            language="tsx"
            code={`// Snapping is on by default. Ctrl/Cmd + scroll zooms the timeline.
<Timeline ref={ref} fps={30} style={{ height: 240 }} />

// The snap utilities are exported for custom drag implementations.
// buildSnapPoints takes the project's clips record (project.clips),
// snapFrame snaps a frame to the nearest point within a pixel threshold.
import {
  snapFrame,
  buildSnapPoints,
  DEFAULT_OVERLAP_TOLERANCE,
} from '@elah/editor'

const snapPoints = buildSnapPoints(project.clips, excludeClipId)
const snappedFrame = snapFrame(frame, snapPoints, threshold)`}
          />
        </section>

        {/* Transitions */}
        <section className="mb-10">
          <h2 id="transitions" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Transitions
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            Transitions are defined on the <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">Project</code> level and stored in <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">useTransitionsStore</code>. The fade transition is fully implemented; slide/wipe transitions have architecture in place.
          </p>
          <CodeBlock
            language="tsx"
            code={`const engine = useTimelineEngine()

// Add a fade transition between two adjacent clips on the same track.
// trackId is required.
engine.addTransition({
  fromClipId: clip1.id,
  toClipId: clip2.id,
  trackId: track.id,
  kind: 'fade',
  durationFrames: 15, // 0.5 seconds at 30fps
  easing: 'ease-out',  // 'linear' | 'ease-in' | 'ease-out'
})

// The resolver handles opacity automatically:
// resolveTimeline(frame, project) → Scene
// During transition: fromClip.opacity interpolated 1→0
//                   toClip.opacity interpolated 0→1
//
// Preview: TransitionOverlay fades a CSS snapshot
// Export: globalAlpha mirrors the opacity values`}
          />
        </section>

        {/* Shortcuts */}
        <section className="mb-10">
          <h2 id="shortcuts" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Keyboard Shortcuts
          </h2>
          <div className="overflow-hidden rounded-md border border-outline-variant">
            {[
              ['Space', 'Play / Pause'],
              ['S', 'Split selected clip at playhead'],
              ['Delete / Backspace', 'Delete selected clip(s)'],
              ['Ctrl/Cmd + C', 'Copy selected clip(s)'],
              ['Ctrl/Cmd + V', 'Paste at playhead'],
              ['Ctrl/Cmd + Z', 'Undo'],
              ['Ctrl/Cmd + Shift + Z', 'Redo'],
              ['Ctrl/Cmd + Scroll', 'Zoom timeline'],
              ['← / →', 'Step one frame'],
            ].map(([key, action], i) => (
              <div
                key={key}
                className={`flex items-center gap-4 border-b border-outline-variant p-3 last:border-0 ${i % 2 === 0 ? 'bg-surface-low' : 'bg-surface-lowest'}`}
              >
                <kbd className="min-w-0 rounded border border-outline-variant bg-surface-container px-2.5 py-1 font-mono text-xs text-on-surface whitespace-nowrap">
                  {key}
                </kbd>
                <span className="text-sm text-on-surface-variant">{action}</span>
              </div>
            ))}
          </div>
        </section>
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
