import type { Metadata } from 'next'
import Link from 'next/link'
import { CodeBlock } from '@/components/docs/CodeBlock'
import { DocsToc } from '@/components/docs/DocsToc'
import { PageHeader } from '@/components/site/PageHeader'

export const metadata: Metadata = {
  title: 'Timeline',
  description:
    'The @elah/timeline React components: tracks and clips, multiple video tracks, playback, anchored zoom and snapping, clip virtualization, transitions, and keyboard shortcuts for drag, trim, and split.',
  alternates: { canonical: '/docs/timeline' },
}

const toc = [
  { id: 'overview', title: 'Overview', level: 2 },
  { id: 'tracks-and-clips', title: 'Tracks & Clips', level: 2 },
  { id: 'playback', title: 'Playback', level: 2 },
  { id: 'zooming', title: 'Zooming & Snapping', level: 2 },
  { id: 'multiple-video-tracks', title: 'Multiple Video Tracks', level: 2 },
  { id: 'virtualization', title: 'Clip Virtualization', level: 2 },
  { id: 'transitions', title: 'Transitions', level: 2 },
  { id: 'shortcuts', title: 'Keyboard Shortcuts', level: 2 },
]

export default function TimelinePage() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
      <article className="min-w-0 flex-1 max-w-3xl">
        <PageHeader
          variant="doc"
          eyebrow="Timeline"
          title="Timeline"
          lede={
            <>
              The Timeline component is a fully interactive NLE timeline. Tracks, clips, drag-to-trim, drag-to-move, snapping, zoom, and the full keyboard shortcut set.
            </>
          }
        />

        {/* Overview */}
        <section className="mb-10">
          <h2 id="overview" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20">
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
          <h2 id="tracks-and-clips" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20">
            Tracks & Clips
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            Each <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">Track</code> has a <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">kind</code>: <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">video</code>, <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">audio</code>, or <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">elements</code> (text, shapes, and freehand live on <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">elements</code> tracks). A project can have any number of tracks of any kind, including several video tracks; <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">initialTracks</code> on <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">EditorProvider</code> sets the starting layout. Clips are stored on the <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">Project</code> keyed by track id (<code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">project.clips[trackId]</code>).
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
  protected?: boolean    // the user cannot remove this track
  pinned?: 'bottom'      // addTrack keeps this lane below every non-pinned track
}

interface Clip {
  id: string
  trackId: string
  type: 'video' | 'audio' | 'text' | 'image' | 'shape' | 'freehand'
      | 'adjustment' | 'generator' | 'compound' | 'sequence'
  name: string
  src?: string                  // URL or blob ref for video/audio/image
  startFrame: number            // integer — position on the timeline
  durationFrames: number        // integer — length on the timeline
  sourceStartFrame: number      // trim in-point into the source asset
  sourceDurationFrames: number  // source length (used for trim constraints)
  transform?: Transform         // position, scale, rotation (optional)
  opacity?: number              // 0..1, managed by the transition system
  speed?: number                // video only; 0.25..4, default 1
  crop?: { x: number; y: number; width: number; height: number } // 0..1 of the source
  cornerRadius?: number         // video/image; 0..0.5 of the shorter side
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
          <h2 id="playback" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20">
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
          <h2 id="zooming" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20">
            Zooming & Snapping
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            The timeline supports <strong className="text-on-surface font-medium">Ctrl/Cmd + scroll</strong> to zoom, anchored on the pointer, and pinch to zoom on touch, anchored on the finger midpoint. Clips snap to other clip edges, the playhead, and track boundaries. The snap tolerance is configurable:
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
          <p className="mt-4 mb-4 text-sm leading-relaxed text-on-surface-variant">
            For toolbar buttons and sliders, use the imperative handle rather than writing the zoom store directly. <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">zoomAtAnchor(nextZoom)</code> sets the zoom in pixels per frame, clamped by the store, and keeps the view anchored: the playhead stays where it is on screen when it is visible, and the viewport centre does otherwise, so zooming never scrolls the playhead out of view. <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">fitToWindow()</code> zooms so the whole timeline fits the visible track area.
          </p>
          <CodeBlock
            language="tsx"
            code={`const ref = useRef<TimelineRef>(null)

<Timeline ref={ref} fps={30} />

// TimelineRef: { engine, playback, fitToWindow, zoomAtAnchor }
ref.current?.zoomAtAnchor(8)   // 8 px per frame, anchored on the playhead
ref.current?.fitToWindow()`}
          />
        </section>

        {/* Multiple video tracks */}
        <section className="mb-10">
          <h2 id="multiple-video-tracks" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20">
            Multiple Video Tracks
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            As of 0.6.0 a project can have more than one video track. <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">engine.addTrack(&apos;video&apos;)</code> adds another lane instead of returning the existing one. Each lane is its own row in the timeline, and overlapping clips on separate video lanes layer instead of conflicting. Lanes composite in track order, so the topmost lane draws on top, and a new video track is placed directly below the last one. See <Link href="/docs/clips#multiple-video-tracks" className="text-primary hover:underline">Clips &amp; Tracks</Link> for placement, reordering, and the protected and pinned track options.
          </p>
        </section>

        {/* Virtualization */}
        <section className="mb-10">
          <h2 id="virtualization" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20">
            Clip Virtualization
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            On a long timeline, mounting every clip would dominate the render cost. The timeline mounts only the clips inside the scrolled viewport, plus a margin so clips do not visibly pop in during a fast scroll or drag. Nothing needs to be enabled and there is no prop for it.
          </p>
          <ul className="mb-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-on-surface-variant">
            <li>
              The visible window is quantized to 200 pixel steps, so rows re-render once per step of scrolling rather than on every pixel.
            </li>
            <li>
              The window is rounded outward (start down, end up), so it is always a superset of the true viewport and never culls a clip that is actually visible.
            </li>
            <li>
              The window is measured from the lane area only. The sticky track-label sidebar covers the left part of the viewport, so it is excluded.
            </li>
          </ul>
        </section>

        {/* Transitions */}
        <section className="mb-10">
          <h2 id="transitions" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20">
            Transitions
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            Transitions are defined on the <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">Project</code> level and stored in <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">useTransitionsStore</code>. There are nine kinds (<code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">fade</code>, <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">slide</code>, <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">wipe</code>, <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">zoom</code>, <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">spin</code>, <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">whip</code>, <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">glitchCut</code>, <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">warpDissolve</code> and <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">lumaWipe</code>), all drawn by the WebGL2 renderer in the preview and in export; see <Link href="/docs/editor#transitions" className="text-primary hover:underline">Editor: Transitions</Link>.
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
  kind: 'fade',        // 'fade' | 'slide' | 'wipe' | 'zoom' | 'spin' | 'whip'
                       // | 'glitchCut' | 'warpDissolve' | 'lumaWipe'
  durationFrames: 15, // 0.5 seconds at 30fps
  easing: 'ease-out',  // 'linear' | 'ease-in' | 'ease-out'
})

// resolveTimeline(frame, project) → Scene lists the active transition in
// scene.transitions with its eased progress t (0 → 1). Both clips stay in
// the scene; the WebGL2 renderer composites them through the transition,
// in preview and in export, with their effects intact.`}
          />
        </section>

        {/* Shortcuts */}
        <section className="mb-10">
          <h2 id="shortcuts" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20">
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
                className={`flex flex-col items-start gap-1.5 border-b border-outline-variant p-3 last:border-0 sm:flex-row sm:items-center sm:gap-4 ${i % 2 === 0 ? 'bg-surface-low' : 'bg-surface-lowest'}`}
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
