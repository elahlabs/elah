import type { Metadata } from 'next'
import Link from 'next/link'
import { CodeBlock } from '@/components/docs/CodeBlock'
import { DocsToc } from '@/components/docs/DocsToc'
import { PageHeader } from '@/components/site/PageHeader'

export const metadata: Metadata = {
  title: 'Quick Start',
  description:
    'Build a working browser video editor in minutes: mount EditorProvider, Preview, and Timeline, learn the keyboard shortcuts, and add clips programmatically.',
  alternates: { canonical: '/docs/getting-started' },
}

const toc = [
  { id: 'timeline-only', title: 'Timeline Only', level: 2 },
  { id: 'preview-component', title: 'Adding Preview', level: 2 },
  { id: 'full-editor', title: 'Full Editor', level: 2 },
  { id: 'keyboard-shortcuts', title: 'Keyboard Shortcuts', level: 2 },
  { id: 'adding-clips', title: 'Adding Clips Programmatically', level: 2 },
]

export default function GettingStartedPage() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
      <article className="min-w-0 flex-1 max-w-3xl">
        <PageHeader
          variant="doc"
          eyebrow="Getting Started"
          title="Quick Start"
          lede={
            <>
              Three levels of integration — timeline only, timeline + preview, and the full editor. Start from whichever level matches your use case.
            </>
          }
        />

        {/* Timeline only */}
        <section className="mb-10">
          <h2 id="timeline-only" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20">
            Level 1: Timeline Only
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            The <code className="bg-surface-container px-1.5 py-0.5 text-xs font-mono">Timeline</code> component is the most isolated piece. Wrap it in <code className="bg-surface-container px-1.5 py-0.5 text-xs font-mono">EditorProvider</code> and you get a fully functional NLE timeline — drag, trim, split, snap, undo/redo.
          </p>
          <CodeBlock
            language="tsx"
            filename="TimelineOnly.tsx"
            code={`import { useRef } from 'react'
import {
  EditorProvider,
  Timeline,
  useTimelineEngine,
  type TimelineRef,
} from '@elah/editor'

function Controls() {
  const engine = useTimelineEngine()

  const addVideoClip = () => {
    const tracks = engine.getProject().tracks
    const videoTrack = tracks.find((t) => t.kind === 'video')
    if (!videoTrack) return

    engine.addClip({
      trackId: videoTrack.id,
      type: 'video',
      src: 'my-video.mp4',
      startFrame: 0,
      durationFrames: 90, // 3 seconds at 30fps
      name: 'My Clip',
    })
  }

  return (
    <div style={{ padding: 8, display: 'flex', gap: 8 }}>
      <button onClick={addVideoClip}>Add Video Clip</button>
      <button onClick={() => engine.undo()}>Undo</button>
      <button onClick={() => engine.redo()}>Redo</button>
    </div>
  )
}

export default function TimelineOnly() {
  const timelineRef = useRef<TimelineRef>(null)

  return (
    <EditorProvider
      fps={30}
      initialTracks={[
        { kind: 'video', name: 'Video' },
        { kind: 'audio', name: 'Audio' },
        { kind: 'elements', name: 'Elements' },
      ]}
    >
      <Controls />
      <Timeline
        ref={timelineRef}
        fps={30}
        style={{ height: 240 }}
      />
    </EditorProvider>
  )
}`}
          />
          <div className="mt-4 border border-outline-variant bg-surface-low p-4 flex items-center justify-between gap-4">
            <p className="text-xs leading-relaxed text-on-surface-variant">
              This is the same integration used in the live Timeline playground.
            </p>
            <Link
              href="/playground/timeline"
              className="shrink-0 border border-outline px-3 py-1.5 text-xs font-medium text-on-surface transition-colors hover:bg-surface-container"
            >
              Open Timeline →
            </Link>
          </div>
        </section>

        {/* Preview component */}
        <section className="mb-10">
          <h2 id="preview-component" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20">
            Level 2: Timeline + Preview
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            Add <code className="bg-surface-container px-1.5 py-0.5 text-xs font-mono">{'<Preview>'}</code> to mount the WebGL2 renderer and drive the RAF loop. You inject a <strong className="text-on-surface font-medium">demuxer factory</strong> so the SDK never hard-depends on a specific decode backend:
          </p>
          <CodeBlock
            language="tsx"
            filename="TimelineWithPreview.tsx"
            code={`import { useRef } from 'react'
import {
  EditorProvider,
  Preview,
  Timeline,
  createDefaultDemuxerFactory,
  type PreviewHandle,
  type TimelineRef,
} from '@elah/editor'

// Zero-config demuxer — mediabunny ships bundled with @elah/editor
const demuxerFactory = createDefaultDemuxerFactory()

export default function App() {
  const previewRef = useRef<PreviewHandle>(null)
  const timelineRef = useRef<TimelineRef>(null)

  return (
    <EditorProvider fps={30}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
      }}>
        {/* Preview takes up most of the vertical space */}
        <Preview
          ref={previewRef}
          demuxerFactory={demuxerFactory}
          enableAudio // default: true
          style={{ flex: 1, minHeight: 0 }}
        />

        {/* Timeline at the bottom */}
        <Timeline
          ref={timelineRef}
          fps={30}
          style={{ height: 240 }}
        />
      </div>
    </EditorProvider>
  )
}`}
          />
          <div className="mt-4 border border-outline-variant bg-surface-low p-4">
            <div className="label-mono mb-1 text-2xs text-on-surface-variant opacity-90">Note</div>
            <p className="text-xs leading-relaxed text-on-surface-variant">
              <code className="bg-surface-container px-1.5 py-0.5 font-mono">{'<Preview>'}</code> paints interactive transform overlays automatically — drag/resize for video and image clips, inline-edit for text clips. No additional wiring needed.
            </p>
          </div>
        </section>

        {/* Full editor */}
        <section className="mb-10">
          <h2 id="full-editor" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20">
            Level 3: Full Editor
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            Add <code className="bg-surface-container px-1.5 py-0.5 text-xs font-mono">{'<AssetPanel>'}</code> for the media library (drag-drop import, filmstrip thumbnails, waveform previews), a transport toolbar, and export:
          </p>
          <CodeBlock
            language="tsx"
            filename="FullEditor.tsx"
            code={`import { useRef } from 'react'
import {
  EditorProvider,
  AssetPanel,
  Preview,
  Timeline,
  createDefaultDemuxerFactory,
  usePlaybackStore,
  useTimelineEngine,
  framesToTimecode,
  exportVideo,
  type TimelineRef,
  type PreviewHandle,
  type InitialTrackConfig,
} from '@elah/editor'

const FPS = 30

const INITIAL_TRACKS: InitialTrackConfig[] = [
  { kind: 'video', name: 'Video / Image' },
  { kind: 'audio', name: 'Audio' },
  { kind: 'elements', name: 'Elements' },
]

const demuxerFactory = createDefaultDemuxerFactory()

function Toolbar() {
  const engine = useTimelineEngine()
  const { isPlaying, togglePlayPause, currentFrame } =
    usePlaybackStore((s) => s)

  const handleExport = async () => {
    // fps is read from project.fps — exportVideo takes only encode options.
    const project = engine.getProject()
    const blob = await exportVideo(project)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'export.mp4'
    a.click()
  }

  return (
    <div style={{ display: 'flex', gap: 8, padding: 8,
                  background: '#1a1a1a', color: '#fff' }}>
      <button onClick={togglePlayPause}>
        {isPlaying ? 'Pause' : 'Play'}
      </button>
      <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
        {framesToTimecode(currentFrame, FPS)}
      </span>
      <button onClick={() => engine.undo()}>Undo</button>
      <button onClick={() => engine.redo()}>Redo</button>
      <button onClick={handleExport}>Export MP4</button>
    </div>
  )
}

export default function FullEditor() {
  const timelineRef = useRef<TimelineRef>(null)
  const previewRef = useRef<PreviewHandle>(null)

  return (
    <EditorProvider fps={FPS} initialTracks={INITIAL_TRACKS}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
      }}>
        <Toolbar />

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <AssetPanel style={{ width: 240, flexShrink: 0 }} />
          <Preview
            ref={previewRef}
            demuxerFactory={demuxerFactory}
            style={{ flex: 1, minWidth: 0 }}
          />
        </div>

        <Timeline
          ref={timelineRef}
          fps={FPS}
          style={{ height: 240, flexShrink: 0 }}
        />
      </div>
    </EditorProvider>
  )
}`}
          />
          <div className="mt-4 border border-outline-variant bg-surface-low p-4 flex items-center justify-between gap-4">
            <p className="text-xs leading-relaxed text-on-surface-variant">
              This is the same integration used in the live Production playground — asset panel, preview, timeline, transport, and export.
            </p>
            <Link
              href="/playground/production"
              className="shrink-0 border border-outline px-3 py-1.5 text-xs font-medium text-on-surface transition-colors hover:bg-surface-container"
            >
              Open Production →
            </Link>
          </div>
        </section>

        {/* Keyboard shortcuts */}
        <section className="mb-10">
          <h2 id="keyboard-shortcuts" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20">
            Keyboard Shortcuts
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            The Timeline component handles these shortcuts automatically when it has focus:
          </p>
          <div className="overflow-hidden border border-outline-variant">
            {[
              { key: 'Space', action: 'Play / Pause' },
              { key: 'S', action: 'Split selected clip at playhead' },
              { key: 'Delete / Backspace', action: 'Delete selected clip(s)' },
              { key: 'Ctrl/Cmd + C', action: 'Copy selected clip(s)' },
              { key: 'Ctrl/Cmd + V', action: 'Paste copied clip(s) at playhead' },
              { key: 'Ctrl/Cmd + Z', action: 'Undo' },
              { key: 'Ctrl/Cmd + Shift + Z', action: 'Redo' },
              { key: 'Ctrl/Cmd + Scroll', action: 'Zoom timeline' },
              { key: '← / →', action: 'Step one frame back / forward' },
            ].map((row, i) => (
              <div
                key={row.key}
                className={`flex flex-col items-start gap-1.5 border-b border-outline-variant p-3 last:border-0 sm:flex-row sm:items-center sm:gap-4 ${i % 2 === 0 ? 'bg-surface-low' : 'bg-surface-lowest'}`}
              >
                <kbd className="min-w-0 border border-outline-variant bg-surface-container px-2.5 py-1 font-mono text-xs text-on-surface whitespace-nowrap">
                  {row.key}
                </kbd>
                <span className="text-sm text-on-surface-variant">{row.action}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Adding clips programmatically */}
        <section className="mb-10">
          <h2 id="adding-clips" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20">
            Adding Clips Programmatically
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            Use <code className="bg-surface-container px-1.5 py-0.5 text-xs font-mono">useTimelineEngine()</code> to access the engine from any child of <code className="bg-surface-container px-1.5 py-0.5 text-xs font-mono">EditorProvider</code>. All mutations go through <code className="bg-surface-container px-1.5 py-0.5 text-xs font-mono">engine.addClip()</code>:
          </p>
          <CodeBlock
            language="tsx"
            filename="AddClipButton.tsx"
            code={`import { useTimelineEngine, useTracksStore, usePlaybackStore } from '@elah/editor'

export function AddClipButton() {
  const engine = useTimelineEngine()
  const tracks = useTracksStore((s) => s.tracks)
  const currentFrame = usePlaybackStore((s) => s.currentFrame)

  const addVideoClip = () => {
    const videoTrack = tracks.find((t) => t.kind === 'video')
    if (!videoTrack) return

    engine.addClip({
      trackId: videoTrack.id,
      type: 'video',
      src: 'my-video.mp4',
      startFrame: currentFrame,
      durationFrames: 90,
      name: 'Clip',
    })
  }

  const addTextClip = () => {
    const textTrack = tracks.find((t) => t.kind === 'elements')
    if (!textTrack) return

    engine.addClip({
      trackId: textTrack.id,
      type: 'text',
      startFrame: currentFrame,
      durationFrames: 60,
      name: 'My Title',
      text: {
        content: 'Hello World',
        fontSize: 48,
        color: '#ffffff',
        fontWeight: 'bold',
      },
    })
  }

  const addImageClip = () => {
    const videoTrack = tracks.find((t) => t.kind === 'video')
    if (!videoTrack) return

    engine.addClip({
      trackId: videoTrack.id,
      type: 'image',
      src: 'my-image.png',
      startFrame: currentFrame,
      durationFrames: 60,
      name: 'Image',
    })
  }

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <button onClick={addVideoClip}>+ Video</button>
      <button onClick={addTextClip}>+ Text</button>
      <button onClick={addImageClip}>+ Image</button>
    </div>
  )
}`}
          />
          <div className="mt-4 border border-outline-variant bg-surface-low p-4">
            <div className="label-mono mb-1 text-2xs text-on-surface-variant opacity-90">Batch edits</div>
            <p className="mb-3 text-xs leading-relaxed text-on-surface-variant">
              Wrap multiple mutations in <code className="bg-surface-container px-1.5 py-0.5 font-mono">engine.batch()</code> to commit them as a single undo entry:
            </p>
            <CodeBlock
              language="tsx"
              code={`engine.batch(() => {
  engine.addClip({ trackId, type: 'video', ...videoOpts })
  engine.addClip({ trackId: audioTrackId, type: 'audio', ...audioOpts })
}, 'Add video + audio')`}
            />
          </div>
          <div className="mt-4 border border-outline-variant bg-surface-low p-4">
            <div className="label-mono mb-1 text-2xs text-on-surface-variant opacity-90">Remote media: place it now, size it later</div>
            <p className="mb-3 text-xs leading-relaxed text-on-surface-variant">
              A remote URL does not have a duration until it has been probed. <code className="bg-surface-container px-1.5 py-0.5 font-mono">beginImportUrl</code> registers it as a pending asset immediately, so you can insert a clip with a fallback length right away, then call <code className="bg-surface-container px-1.5 py-0.5 font-mono">growClipToAssetDuration</code> from <code className="bg-surface-container px-1.5 py-0.5 font-mono">@elah/timeline</code> once the real duration is known. The clip shows a loading shimmer in between. Full walkthrough on <Link href="/docs/clips#growing-clips" className="text-on-surface underline decoration-primary underline-offset-4 hover:decoration-2">Clips &amp; Tracks</Link>.
            </p>
            <CodeBlock
              language="tsx"
              code={`import {
  beginImportUrl,
  insertMediaAsset,
  growClipToAssetDuration,
  mediaLibraryStore,
} from '@elah/editor'

const asset = await beginImportUrl(url)               // pending, placeholder duration
const result = await insertMediaAsset(engine, asset.id, { videoOnly: true })
if (!result.ok) return

const clipId = result.clipIds[0]
const fallbackFrames = engine.findClip(clipId)!.clip.durationFrames

const unsubscribe = mediaLibraryStore.subscribe((state) => {
  const ready = state.assets[asset.id]
  if (ready?.status !== 'ready') return
  unsubscribe()
  growClipToAssetDuration(engine, clipId, fallbackFrames, ready.durationSec)
})`}
            />
          </div>
        </section>
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
