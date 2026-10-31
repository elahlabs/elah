import type { Metadata } from 'next'
import Link from 'next/link'
import { DocsToc } from '@/components/docs/DocsToc'
import { Code } from '@/components/docs/Code'
import { C, Callout, DocsPager, H2, P, PropTable, Shortcuts } from '@/components/docs/DocsKit'
import { PageHeader } from '@/components/site/PageHeader'

export const metadata: Metadata = {
  title: 'Quick Start',
  description:
    'Build a working browser video editor in minutes: mount EditorProvider, Preview, and Timeline, learn the keyboard shortcuts, and add clips programmatically.',
  alternates: { canonical: '/docs/getting-started' },
}

const toc = [
  { id: 'levels', title: 'Pick a level', level: 2 },
  { id: 'timeline-only', title: '1. Timeline only', level: 2 },
  { id: 'preview-component', title: '2. Add a preview', level: 2 },
  { id: 'full-editor', title: '3. Full editor', level: 2 },
  { id: 'adding-clips', title: 'Adding clips from code', level: 2 },
  { id: 'keyboard-shortcuts', title: 'Keyboard shortcuts', level: 2 },
]

const link = 'text-on-surface underline decoration-[#FF003C] underline-offset-4 hover:decoration-2'

export default function GettingStartedPage() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
      <article className="min-w-0 max-w-3xl flex-1">
        <PageHeader
          variant="doc"
          eyebrow="Getting Started"
          title="Quick Start"
          lede="A working video editor in three steps: a timeline, then a preview, then the full editor with media and export. Each step adds to the last."
        />
        <Callout kind="warning" title="Set up first">
          These examples assume you have done{' '}
          <Link href="/docs/installation" className={link}>
            Installation
          </Link>
          : the package, the three stylesheets, and the Next.js or Vite config. Without the stylesheets the editor renders unstyled.
        </Callout>

        <H2 id="levels">Pick a level</H2>
        <PropTable
          nameLabel="Level"
          rows={[
            { name: '1 · Timeline only', desc: 'A drag-and-drop timeline with undo. No video playback.' },
            { name: '2 · Timeline + Preview', desc: 'Adds the video canvas: playback, and moving clips on the stage.' },
            { name: '3 · Full editor', desc: 'Adds the media library, a transport bar, and MP4 export.' },
          ]}
        />

        <H2 id="timeline-only">1. Timeline only</H2>
        <P>
          Put a <C>Timeline</C> inside an <C>EditorProvider</C>. Any component inside the provider can change the project through{' '}
          <C>useTimelineEngine()</C>:
        </P>
        <Code
          title="TimelineOnly.tsx"
          highlight={[10, 28, 31]}
          code={`
import { EditorProvider, Timeline, useTimelineEngine, type InitialTrackConfig } from '@elah/editor'

const TRACKS: InitialTrackConfig[] = [
  { kind: 'video', name: 'Video' },
  { kind: 'audio', name: 'Audio' },
  { kind: 'elements', name: 'Elements' },
]

function Controls() {
  const engine = useTimelineEngine()

  const addClip = () => {
    const video = engine.getProject().tracks.find((t) => t.kind === 'video')!
    engine.addClip({ trackId: video.id, type: 'video', src: 'my-video.mp4', startFrame: 0, durationFrames: 90, name: 'My clip' })
  }

  return (
    <div>
      <button onClick={addClip}>Add clip</button>
      <button onClick={() => engine.undo()}>Undo</button>
      <button onClick={() => engine.redo()}>Redo</button>
    </div>
  )
}

export default function App() {
  return (
    <EditorProvider fps={30} initialTracks={TRACKS}>
      <div className="elah-root">
        <Controls />
        <Timeline fps={30} style={{ height: 240 }} />
      </div>
    </EditorProvider>
  )
}`}
        />
        <Callout title="Pass initialTracks">
          Without it the editor starts with a single video track, so there is nowhere to put text or audio until you add tracks.
        </Callout>
        <P>
          Try the same setup live in the{' '}
          <Link href="/playground/timeline" className={link}>
            Timeline playground
          </Link>
          .
        </P>

        <H2 id="preview-component">2. Add a preview</H2>
        <P>
          <C>Preview</C> is the video canvas. Give it a demuxer factory, which reads video files. The built-in one needs no setup:
        </P>
        <Code
          title="App.tsx"
          highlight={[5, 11]}
          code={`
import { EditorProvider, Preview, Timeline, createDefaultDemuxerFactory } from '@elah/editor'

// TRACKS is the same list as in step 1.
// Create the factory once, outside the component.
const demuxerFactory = createDefaultDemuxerFactory()

export default function App() {
  return (
    <EditorProvider fps={30} initialTracks={TRACKS}>
      <div className="elah-root" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <Preview demuxerFactory={demuxerFactory} style={{ flex: 1, minHeight: 0 }} />
        <Timeline fps={30} style={{ height: 240 }} />
      </div>
    </EditorProvider>
  )
}`}
        />
        <P>
          Selecting a clip in the preview gives you move and resize handles, and double-clicking text edits it in place. There is nothing extra to
          wire up. See{' '}
          <Link href="/docs/editor#transforms" className={link}>
            Editor: Transforms
          </Link>
          .
        </P>
        <Callout title="The stage is portrait by default">
          A new project is 1080 × 1920. For landscape video, pass <C>{'stage={{ width: 1920, height: 1080 }}'}</C> to <C>EditorProvider</C>.
        </Callout>

        <H2 id="full-editor">3. Full editor</H2>
        <P>
          Add <C>AssetPanel</C> for importing media (drag and drop, thumbnails, waveforms) and a toolbar with play, undo and export:
        </P>
        <Code
          title="FullEditor.tsx"
          highlight={[13, 14, 15, 18, 42]}
          code={`
import {
  EditorProvider, AssetPanel, Preview, Timeline,
  createDefaultDemuxerFactory, exportVideo, framesToTimecode,
  usePlaybackStore, useTimelineEngine, type InitialTrackConfig,
} from '@elah/editor'

const FPS = 30
const TRACKS: InitialTrackConfig[] = [{ kind: 'video', name: 'Video / Image' }, { kind: 'audio', name: 'Audio' }, { kind: 'elements', name: 'Elements' }]
const demuxerFactory = createDefaultDemuxerFactory()

function Toolbar() {
  const engine = useTimelineEngine()
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const togglePlayPause = usePlaybackStore((s) => s.togglePlayPause)
  const currentFrame = usePlaybackStore((s) => s.currentFrame)

  const exportMp4 = async () => {
    const blob = await exportVideo(engine.getProject())
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'export.mp4'
    a.click()
  }

  return (
    <div style={{ display: 'flex', gap: 8, padding: 8 }}>
      <button onClick={togglePlayPause}>{isPlaying ? 'Pause' : 'Play'}</button>
      <span>{framesToTimecode(currentFrame, FPS)}</span>
      <button onClick={() => engine.undo()}>Undo</button>
      <button onClick={() => engine.redo()}>Redo</button>
      <button onClick={exportMp4}>Export MP4</button>
    </div>
  )
}

export default function FullEditor() {
  return (
    <EditorProvider fps={FPS} initialTracks={TRACKS}>
      <div className="elah-root" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <Toolbar />
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <AssetPanel style={{ width: 240, flexShrink: 0 }} />
          <Preview demuxerFactory={demuxerFactory} style={{ flex: 1, minWidth: 0 }} />
        </div>
        <Timeline fps={FPS} style={{ height: 240, flexShrink: 0 }} />
      </div>
    </EditorProvider>
  )
}`}
        />
        <Callout title="Select only what a component shows">
          Each <C>usePlaybackStore</C> call above picks one value. Selecting the whole store, <C>usePlaybackStore((s) =&gt; s)</C>, re-renders
          the component on every change.
        </Callout>
        <P>
          For progress, cancelling and other formats, see{' '}
          <Link href="/docs/export" className={link}>
            Export
          </Link>
          . This is the same setup as the{' '}
          <Link href="/playground/production" className={link}>
            Production playground
          </Link>
          .
        </P>

        <H2 id="adding-clips">Adding clips from code</H2>
        <P>
          Any component inside the provider can add clips. Times are whole frames: at 30 fps, 90 frames is three seconds.
        </P>
        <Code
          title="AddClipButtons.tsx"
          highlight={[9, 14]}
          code={`
import { useTimelineEngine, useTracksStore, usePlaybackStore } from '@elah/editor'

export function AddClipButtons() {
  const engine = useTimelineEngine()
  const tracks = useTracksStore((s) => s.tracks)
  const at = usePlaybackStore((s) => s.currentFrame)
  const track = (kind: 'video' | 'elements') => tracks.find((t) => t.kind === kind)!.id

  const addVideo = () => engine.addClip({ trackId: track('video'), type: 'video', src: 'my-video.mp4', startFrame: at, durationFrames: 90, name: 'Clip' })
  const addImage = () => engine.addClip({ trackId: track('video'), type: 'image', src: 'my-image.png', startFrame: at, durationFrames: 60, name: 'Image' })
  const addText = () =>
    engine.addClip({
      trackId: track('elements'), type: 'text', startFrame: at, durationFrames: 60, name: 'Title',
      text: { content: 'Hello World', fontSize: 48, color: '#ffffff', fontWeight: 'bold' },
    })

  return (
    <div>
      <button onClick={addVideo}>+ Video</button>
      <button onClick={addImage}>+ Image</button>
      <button onClick={addText}>+ Text</button>
    </div>
  )
}`}
        />
        <PropTable
          nameLabel="Clip type"
          rows={[
            { name: 'video · image', desc: <>Go on a <C>video</C> track, with a <C>src</C> URL.</> },
            { name: 'text', desc: <>Goes on an <C>elements</C> track. <C>text.content</C> is required; style fields are optional.</> },
            { name: 'audio', desc: <>Goes on an <C>audio</C> track, with a <C>src</C>.</> },
          ]}
        />
        <P>
          Every option is listed on{' '}
          <Link href="/docs/api#timeline-engine" className={link}>
            API Reference: TimelineEngine
          </Link>
          .
        </P>

        <H2 id="keyboard-shortcuts">Keyboard shortcuts</H2>
        <P>The timeline handles these when it has focus:</P>
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

        <DocsPager href="/docs/getting-started" />
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
