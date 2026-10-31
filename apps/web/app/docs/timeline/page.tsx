import type { Metadata } from 'next'
import Link from 'next/link'
import { DocsToc } from '@/components/docs/DocsToc'
import { Code } from '@/components/docs/Code'
import { C, Callout, DocsPager, H2, H3, P, PropTable, Shortcuts } from '@/components/docs/DocsKit'
import { LazyDemo } from '@/components/home/LazyDemo'
import { PageHeader } from '@/components/site/PageHeader'
import { label } from '@/components/eb'

export const metadata: Metadata = {
  title: 'Timeline',
  description:
    'The @elah/timeline React components: tracks and clips, multiple video tracks, playback, anchored zoom and snapping, clip virtualization, transitions, and keyboard shortcuts for drag, trim, and split.',
  alternates: { canonical: '/docs/timeline' },
}

const toc = [
  { id: 'overview', title: 'Add a timeline', level: 2 },
  { id: 'tracks-and-clips', title: 'Tracks & clips', level: 2 },
  { id: 'editing-clips', title: 'Editing clips', level: 2 },
  { id: 'playback', title: 'Playback', level: 2 },
  { id: 'zooming', title: 'Zoom & snapping', level: 2 },
  { id: 'multiple-video-tracks', title: 'Multiple video tracks', level: 2 },
  { id: 'virtualization', title: 'Clip virtualization', level: 2 },
  { id: 'transitions', title: 'Transitions', level: 2 },
  { id: 'shortcuts', title: 'Keyboard shortcuts', level: 2 },
]

const link = 'text-on-surface underline decoration-[#FF003C] underline-offset-4 hover:decoration-2'

export default function TimelinePage() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
      <article className="min-w-0 max-w-3xl flex-1">
        <PageHeader
          variant="doc"
          eyebrow="Timeline"
          title="Timeline"
          lede="A drag-and-drop editing timeline for React: tracks, clips, trimming, snapping, zoom and keyboard shortcuts."
        />

        <figure className="my-8 border border-outline-variant">
          <LazyDemo name="hero" preview={false} timelineHeight={200} minHeight={200} label="The Timeline component, running live" />
          <figcaption className={`border-t border-outline-variant px-4 py-2.5 text-on-surface-variant ${label}`}>
            The real Timeline component, running on this page
          </figcaption>
        </figure>

        <H2 id="overview">Add a timeline</H2>
        <P>
          Put <C>Timeline</C> inside an <C>EditorProvider</C>. The provider holds the project; the timeline shows it and edits it.
        </P>
        <Code
          title="TimelineOnly.tsx"
          highlight={[11, 12, 13]}
          code={`
import { EditorProvider, Timeline, type InitialTrackConfig } from '@elah/editor'

const TRACKS: InitialTrackConfig[] = [
  { kind: 'video', name: 'Video / Image' },
  { kind: 'audio', name: 'Audio' },
  { kind: 'elements', name: 'Elements' },
]

export default function App() {
  return (
    <EditorProvider fps={30} initialTracks={TRACKS}>
      <Timeline fps={30} style={{ height: 260 }} />
    </EditorProvider>
  )
}`}
        />
        <Callout title="Anything inside the provider stays in sync">
          The timeline reads the editor&apos;s stores (<C>useTracksStore</C>) and makes every change through <C>TimelineEngine</C>. A{' '}
          <C>Preview</C> or your own buttons inside the same provider see the same project.
        </Callout>

        <H2 id="tracks-and-clips">Tracks &amp; clips</H2>
        <P>
          A project has any number of tracks, and each track has a <C>kind</C>: <C>video</C>, <C>audio</C> or <C>elements</C>. Text, shapes and
          freehand drawings go on <C>elements</C> tracks. <C>initialTracks</C> on the provider sets the starting layout.
        </P>

        <H3>Track</H3>
        <PropTable
          rows={[
            { name: 'id', type: 'string', desc: 'Unique id.' },
            { name: 'name', type: 'string', desc: 'Label on the track header.' },
            { name: 'kind', type: "'video' | 'audio' | 'elements'", desc: 'What the track holds.' },
            { name: 'order', type: 'number', desc: 'Stacking position. Lower is closer to the top of the timeline.' },
            { name: 'height', type: 'number', desc: 'Row height in pixels.' },
            { name: 'locked · disabled · muted · solo', type: 'boolean', desc: 'Per-track toggles. A locked track rejects clip moves.' },
            { name: 'volume', type: 'number', optional: true, desc: 'Linear gain, from 0 to 2.' },
            { name: 'protected', type: 'boolean', optional: true, desc: 'The user cannot remove this track.' },
            { name: 'pinned', type: "'bottom'", optional: true, desc: 'addTrack keeps this lane below every non-pinned track.' },
          ]}
        />

        <H3>Clip</H3>
        <PropTable
          rows={[
            { name: 'id · trackId', type: 'string', desc: 'The clip, and the track it sits on.' },
            { name: 'type', type: "'video' | 'audio' | 'text' | …", desc: 'One of video, audio, text, image, shape, freehand, adjustment, generator, compound or sequence.' },
            { name: 'name', type: 'string', desc: 'Label on the clip.' },
            { name: 'src', type: 'string', optional: true, desc: 'URL or blob reference, for video, audio and image clips.' },
            { name: 'startFrame', type: 'number', desc: 'Where the clip starts on the timeline, in whole frames.' },
            { name: 'durationFrames', type: 'number', desc: 'How long it lasts on the timeline, in whole frames.' },
            { name: 'sourceStartFrame', type: 'number', desc: 'Trim in-point into the source media.' },
            { name: 'sourceDurationFrames', type: 'number', desc: 'Length of the source, which limits how far a trim can go.' },
            { name: 'transform', type: 'Transform', optional: true, desc: 'Position, scale and rotation.' },
            { name: 'opacity', type: 'number', optional: true, desc: 'From 0 to 1. Managed by the transition system.' },
            { name: 'speed', type: 'number', optional: true, desc: 'Video only. From 0.25 to 4, default 1.' },
            { name: 'crop', type: '{ x, y, width, height }', optional: true, desc: 'Fractions (0 to 1) of the source.' },
            { name: 'cornerRadius', type: 'number', optional: true, desc: 'Video and image. From 0 to 0.5 of the shorter side.' },
          ]}
          footer="Text clips also carry flat style fields: content, fontSize, color and so on."
        />
        <Callout kind="warning" title="Clips are not stored inside tracks">
          The project keeps them in a record keyed by track id: <C>project.clips[trackId]</C> is the array of clips on that track.
        </Callout>

        <H2 id="editing-clips">Editing clips</H2>
        <P>
          Every edit goes through the engine. Get it with <C>useTimelineEngine()</C> inside the provider, then add a clip:
        </P>
        <Code
          code={`
const engine = useTimelineEngine()

engine.addClip({
  trackId: videoTrack.id,
  type: 'video',
  src: 'https://example.com/video.mp4',
  startFrame: 0,
  durationFrames: 150, // 5 seconds at 30 fps
  name: 'Intro',
})`}
        />
        <P>The other everyday edits:</P>
        <PropTable
          nameLabel="Call"
          rows={[
            { name: 'engine.moveClip(clipId, fromTrackId, toTrackId, startFrame)', desc: 'Move a clip in time. Pass a different toTrackId to move it to another track.' },
            { name: 'engine.removeClip(clipId, trackId)', desc: 'Delete a clip.' },
            { name: 'splitClipAtPlayhead(engine)', desc: <>Split the selected clip at the playhead. Import it from <C>@elah/editor</C>.</> },
          ]}
        />
        <Callout title="Some edits are refused on purpose">
          <C>moveClip</C> does nothing if the clip would overlap another clip on the target track, or if either track is locked.{' '}
          <C>splitClipAtPlayhead</C> needs exactly one selected clip, the playhead inside it, and playback paused. It returns{' '}
          <C>{'{ ok: false, reason }'}</C> when it cannot split.
        </Callout>

        <H2 id="playback">Playback</H2>
        <P>
          <C>PlaybackEngine</C> runs the clock. Read the current frame and play state from <C>usePlaybackStore</C> to build your own transport
          controls:
        </P>
        <Code
          title="TransportControls.tsx"
          highlight={[4, 5, 6]}
          code={`
import { usePlaybackStore, framesToTimecode } from '@elah/editor'

export function TransportControls({ fps = 30 }) {
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const togglePlayPause = usePlaybackStore((s) => s.togglePlayPause)
  const currentFrame = usePlaybackStore((s) => s.currentFrame)

  return (
    <div>
      <button onClick={togglePlayPause}>{isPlaying ? 'Pause' : 'Play'}</button>
      <span>{framesToTimecode(currentFrame, fps)}</span>
    </div>
  )
}`}
        />

        <H2 id="zooming">Zoom &amp; snapping</H2>
        <P>
          Users zoom with <C>Ctrl/Cmd + scroll</C> (anchored on the pointer) or a pinch on touch screens (anchored between the fingers).
          While dragging, clips snap to other clip edges, the playhead and track boundaries. Snapping is on by default.
        </P>
        <P>To zoom from your own buttons or sliders, use the timeline&apos;s ref:</P>
        <Code
          code={`
const ref = useRef<TimelineRef>(null)

<Timeline ref={ref} fps={30} />

ref.current?.zoomAtAnchor(8) // 8 pixels per frame
ref.current?.fitToWindow()   // fit the whole timeline in view`}
          highlight={[5, 6]}
        />
        <Callout title="Prefer zoomAtAnchor over writing the zoom store">
          It clamps the zoom and keeps the view anchored: on the playhead when it is visible, otherwise on the centre. Zooming never scrolls
          the playhead out of view.
        </Callout>
        <P>Building your own drag interaction? The snap helpers are exported:</P>
        <Code
          code={`
import { buildSnapPoints, snapFrame } from '@elah/editor'

const points = buildSnapPoints(project.clips, excludeClipId)
const snapped = snapFrame(frame, points, threshold)`}
        />

        <H2 id="multiple-video-tracks">Multiple video tracks</H2>
        <P>
          A project can have more than one video track. <C>engine.addTrack(&apos;video&apos;)</C> adds a new lane, placed directly below the last
          video track. Clips that overlap on different lanes layer instead of conflicting, and the top lane draws on top. See{' '}
          <Link href="/docs/clips#multiple-video-tracks" className={link}>
            Clips &amp; Tracks
          </Link>{' '}
          for reordering and the protected and pinned options.
        </P>

        <H2 id="virtualization">Clip virtualization</H2>
        <P>On a long timeline, only the clips near the visible area are mounted. There is nothing to enable.</P>
        <ul className="my-4 list-none space-y-2 p-0 text-[15px] leading-[1.75] text-on-surface/85">
          {[
            'The visible window moves in 200-pixel steps, so rows re-render once per step of scrolling, not on every pixel.',
            'The window is rounded outward, so a clip that is actually on screen is never skipped.',
            'A margin around the window stops clips from popping in during a fast scroll or drag.',
            'The window covers the clip lanes only, not the track-label column on the left.',
          ].map((t) => (
            <li key={t} className="flex gap-3">
              <span aria-hidden className="mt-[11px] h-[5px] w-[5px] shrink-0 bg-on-surface" />
              {t}
            </li>
          ))}
        </ul>

        <H2 id="transitions">Transitions</H2>
        <P>
          Add a transition between two neighbouring clips on the same track. The WebGL2 renderer draws it in the preview and in export. More
          in{' '}
          <Link href="/docs/editor#transitions" className={link}>
            Editor: Transitions
          </Link>
          .
        </P>
        <Code
          highlight={[5]}
          code={`
engine.addTransition({
  fromClipId: clip1.id,
  toClipId: clip2.id,
  trackId: track.id,   // required
  kind: 'fade',
  durationFrames: 15,  // 0.5 seconds at 30 fps
  easing: 'ease-out',  // 'linear' | 'ease-in' | 'ease-out'
})`}
        />
        <P>
          There are nine kinds: <C>fade</C> <C>slide</C> <C>wipe</C> <C>zoom</C> <C>spin</C> <C>whip</C> <C>glitchCut</C> <C>warpDissolve</C>{' '}
          <C>lumaWipe</C>.
        </P>

        <H2 id="shortcuts">Keyboard shortcuts</H2>
        <Shortcuts
          items={[
            ['Space', 'Play or pause'],
            ['S', 'Split the selected clip at the playhead'],
            ['Delete', 'Delete the selected clips (Backspace works too)'],
            ['Ctrl/Cmd + C', 'Copy the selected clips'],
            ['Ctrl/Cmd + V', 'Paste at the playhead'],
            ['Ctrl/Cmd + Z', 'Undo'],
            ['Ctrl/Cmd + Shift + Z', 'Redo'],
            ['Ctrl/Cmd + Scroll', 'Zoom the timeline'],
            ['← / →', 'Step one frame'],
          ]}
        />

        <DocsPager href="/docs/timeline" />
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
