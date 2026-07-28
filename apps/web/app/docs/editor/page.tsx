import type { Metadata } from 'next'
import { CodeBlock } from '@/components/docs/CodeBlock'
import { DocsToc } from '@/components/docs/DocsToc'

export const metadata: Metadata = {
  title: 'Editor',
  description:
    'The @elah/editor SDK: EditorProvider, Preview, AssetPanel, interactive transforms, text overlays, transitions, and stage aspect ratio.',
  alternates: { canonical: '/docs/editor' },
}

const toc = [
  { id: 'editor-provider', title: 'EditorProvider', level: 2 },
  { id: 'preview', title: 'Preview', level: 2 },
  { id: 'asset-panel', title: 'AssetPanel', level: 2 },
  { id: 'transforms', title: 'Transforms', level: 2 },
  { id: 'text-overlays', title: 'Text Overlays', level: 2 },
  { id: 'transitions', title: 'Transitions', level: 2 },
  { id: 'stage-aspect', title: 'Stage / Aspect Ratio', level: 2 },
]

export default function EditorPage() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
      <article className="min-w-0 flex-1 max-w-3xl">
        <div className="mb-8 pb-6 border-b border-outline-variant">
          <div className="label-mono mb-2 text-2xs text-on-surface-variant opacity-90">Editor</div>
          <h1 className="text-3xl font-semibold tracking-tight text-on-surface" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Editor
          </h1>
          <p className="mt-3 text-base leading-relaxed text-on-surface-variant">
            EditorProvider, Preview, AssetPanel, transform overlays, text editing, and the transition system.
          </p>
        </div>

        {/* EditorProvider */}
        <section className="mb-10">
          <h2 id="editor-provider" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            EditorProvider
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">EditorProvider</code> creates and wires the <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">TimelineEngine</code>, <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">PlaybackEngine</code>, and all Zustand stores. It must wrap all components that use engine hooks.
          </p>
          <CodeBlock
            language="tsx"
            code={`import { EditorProvider, type InitialTrackConfig } from '@elah/editor'

const tracks: InitialTrackConfig[] = [
  { kind: 'video', name: 'Video / Image' },
  { kind: 'audio', name: 'Audio' },
  { kind: 'elements', name: 'Elements' },
]

function App() {
  return (
    <EditorProvider
      fps={30}          // frames per second (required)
      initialTracks={tracks}
    >
      {/* All children can access engine + stores */}
    </EditorProvider>
  )
}`}
          />
          <div className="mt-4 overflow-x-auto rounded-md border border-outline-variant bg-surface-low p-4">
            <table className="w-full min-w-[30rem] text-xs">
              <thead>
                <tr className="border-b border-outline-variant">
                  <th className="pb-2 text-left font-mono font-medium text-on-surface">Prop</th>
                  <th className="pb-2 text-left font-medium text-on-surface">Type</th>
                  <th className="pb-2 text-left font-medium text-on-surface">Description</th>
                </tr>
              </thead>
              <tbody className="text-on-surface-variant">
                {[
                  ['fps', 'number', 'Frames per second (e.g. 30, 60, 24)'],
                  ['initialTracks', 'InitialTrackConfig[]', 'Track layout to initialize the engine with'],
                  ['children', 'ReactNode', 'All components that need engine access'],
                ].map(([prop, type, desc]) => (
                  <tr key={prop} className="border-b border-outline-variant last:border-0">
                    <td className="py-2 font-mono text-on-surface">{prop}</td>
                    <td className="py-2 font-mono">{type}</td>
                    <td className="py-2">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Preview */}
        <section className="mb-10">
          <h2 id="preview" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Preview
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">{'<Preview>'}</code> mounts the WebGL2 renderer and drives the RAF playback loop. It reads resolved scenes from <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">resolveTimeline</code> and composites video, image, and text layers. Transform overlays are painted on top automatically.
          </p>
          <CodeBlock
            language="tsx"
            filename="Preview usage"
            code={`import {
  Preview,
  createDefaultDemuxerFactory,
  type PreviewHandle,
} from '@elah/editor'
import { useRef } from 'react'

// Build the factory once outside the component
const demuxerFactory = createDefaultDemuxerFactory()

function MyPreview() {
  const ref = useRef<PreviewHandle>(null)

  // PreviewHandle exposes:
  // ref.current.getCanvas()   → HTMLCanvasElement | null
  // ref.current.getRenderer() → GpuRenderer | null

  return (
    <Preview
      ref={ref}
      demuxerFactory={demuxerFactory}
      enableAudio={true}    // default: true
      style={{ flex: 1 }}
    />
  )
}`}
          />
          <p className="mt-4 text-sm leading-relaxed text-on-surface-variant">
            The canvas is letterboxed to the project stage aspect ratio. Off-aspect clips are <strong className="text-on-surface font-medium">contained</strong> (never stretched) within the frame using <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">object-fit: contain</code> semantics.
          </p>
        </section>

        {/* AssetPanel */}
        <section className="mb-10">
          <h2 id="asset-panel" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            AssetPanel
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            The <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">AssetPanel</code> provides the media library UI. Features: file import via button or drag-drop, filmstrip thumbnail generation, audio waveform visualization, and drag-to-timeline for clip creation.
          </p>
          <CodeBlock
            language="tsx"
            code={`import { AssetPanel } from '@elah/editor'

// Minimal usage
<AssetPanel style={{ width: 240, minHeight: 0, overflowY: 'auto' }} />

// The panel uses useMediaLibrary() internally. The hook returns the assets
// plus import/remove helpers — importFiles takes an Iterable<File>:
import { useMediaLibrary } from '@elah/editor'

function CustomLibrary() {
  const { assets, importFiles, removeAsset } = useMediaLibrary()

  const handleFileDrop = async (files: FileList) => {
    const result = await importFiles(files)
    console.log('imported:', result.imported)
    console.log('skipped:', result.skipped)
  }

  return (
    <div onDrop={(e) => handleFileDrop(e.dataTransfer.files)}>
      {assets.map((asset) => (
        <div key={asset.id}>{asset.name}</div>
      ))}
    </div>
  )
}`}
          />
        </section>

        {/* Transforms */}
        <section className="mb-10">
          <h2 id="transforms" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Transforms
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            Every clip has an optional <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">transform</code> property. The <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">MediaTransformOverlay</code> provides interactive drag-move and corner-drag uniform scale for video and image clips:
          </p>
          <CodeBlock
            language="typescript"
            code={`interface Transform {
  x: number        // position, normalized 0..1 of stage width
  y: number        // position, normalized 0..1 of stage height
  scale: number    // uniform scale factor (1 = native size)
  rotation: number // radians, positive = clockwise
  anchor: { x: number; y: number } // 0..1 within the clip's own box
}

// Set transform programmatically (updateClip needs the clip's trackId)
engine.updateClip(clipId, trackId, {
  transform: { x: 0.5, y: 0.4, scale: 1.2, rotation: 0, anchor: { x: 0.5, y: 0.5 } },
})

// The transform flows to both renderers:
// GpuRenderer: applies to WebGL2 textured quad
// ExportWorker: applies via resolveDrawRect() placement math`}
          />
          <div className="mt-4 rounded-md border border-outline-variant bg-surface-low p-4">
            <div className="label-mono mb-1 text-2xs text-on-surface-variant opacity-90">Status</div>
            <p className="text-xs leading-relaxed text-on-surface-variant">
              Move and uniform scale are fully interactive. Rotation handle is partial — <code className="rounded bg-surface-container px-1.5 py-0.5 font-mono">transform.rotation</code> flows through both renderers but the interactive drag handle is not yet built.
            </p>
          </div>
        </section>

        {/* Text overlays */}
        <section className="mb-10">
          <h2 id="text-overlays" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Text Overlays
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            Text clips are rendered via a 2D-canvas-to-texture pipeline (GPU <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">TextLayer</code>). An interactive overlay (<code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">TextOverlay</code>) handles drag, resize (re-rasterized to stay crisp), and inline-edit.
          </p>
          <CodeBlock
            language="tsx"
            code={`// Add a text clip. The 'text' option carries content + style
// (TextClipMetadata); it is required when type is 'text'.
engine.addClip({
  trackId: textTrack.id,
  type: 'text',
  startFrame: 0,
  durationFrames: 90,
  name: 'Title',
  text: {
    content: 'Hello World',
    fontSize: 48,
    color: '#ffffff',
    fontWeight: 'bold',     // 'normal' | 'bold'
    textAlign: 'center',    // 'left' | 'center' | 'right'
    fontFamily: 'Inter',
  },
  transform: {
    x: 0.5,
    y: 0.8, // lower third
    scale: 1,
    rotation: 0,            // radians
    anchor: { x: 0.5, y: 0.5 },
  },
})

// Entry/exit animation lives on the clip as 'textAnimation', not on 'text'.
// Set it after creation via updateClip (in/out ramp, kind is 'fade'):
engine.updateClip(clipId, textTrack.id, {
  textAnimation: { in: 'fade', out: 'fade', durationFrames: 10 },
})`}
          />
        </section>

        {/* Transitions */}
        <section className="mb-10">
          <h2 id="transitions" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Transitions
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            Transitions use a snapshot-overlay architecture. The resolver sets <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">fromClip.opacity</code> and <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">toClip.opacity</code>; <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">TransitionOverlay</code> fades a frozen canvas snapshot via CSS; export mirrors with <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">globalAlpha</code>.
          </p>
          <CodeBlock
            language="tsx"
            code={`// Add a fade transition between two adjacent clips on the same track.
// trackId is required; returns the created Transition (or null if the
// clips aren't found on that track).
engine.addTransition({
  fromClipId: clip1.id,
  toClipId: clip2.id,
  trackId: track.id,
  kind: 'fade',           // 'fade' | 'slide' (partial) | 'wipe' (partial)
  durationFrames: 15,
  easing: 'ease-out',     // 'linear' | 'ease-in' | 'ease-out'
})

// Read transitions
const transitions = useTransitionsStore((s) => s.transitions)

// Remove a transition
engine.removeTransition(transitionId)`}
          />
        </section>

        {/* Stage aspect */}
        <section className="mb-10">
          <h2 id="stage-aspect" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Stage / Aspect Ratio
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            The stage aspect ratio is set on the engine and changes the canvas viewport. All clips are letterboxed to the stage. The <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">StageBorder</code> component shows a frame outline:
          </p>
          <CodeBlock
            language="tsx"
            code={`const engine = useTimelineEngine()

// setStage takes (width, height) as positional args.
// Portrait (9:16 — Reels/Shorts/TikTok)
engine.setStage(1080, 1920)

// Landscape (16:9 — YouTube)
engine.setStage(1920, 1080)

// Square (1:1)
engine.setStage(1080, 1080)

// Custom
engine.setStage(2560, 1440)`}
          />
        </section>
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
