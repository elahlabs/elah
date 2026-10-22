import type { Metadata } from 'next'
import Link from 'next/link'
import { CodeBlock } from '@/components/docs/CodeBlock'
import { DocsToc } from '@/components/docs/DocsToc'
import { PageHeader } from '@/components/site/PageHeader'

export const metadata: Metadata = {
  title: 'Editor',
  description:
    'The @elah/editor SDK: EditorProvider, Preview, AssetPanel, interactive transforms with resize handles and crop, text overlays, nine transitions, and stage aspect ratio.',
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
        <PageHeader
          variant="doc"
          eyebrow="Editor"
          title="Editor"
          lede={
            <>
              EditorProvider, Preview, AssetPanel, transform overlays, text editing, and the transition system.
            </>
          }
        />

        {/* EditorProvider */}
        <section className="mb-10">
          <h2 id="editor-provider" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20">
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
          <h2 id="preview" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20">
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
          <h2 id="asset-panel" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20">
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
          <h2 id="transforms" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20">
            Transforms
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            Every clip has an optional <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">transform</code> property. The <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">MediaTransformOverlay</code> is the interactive surface for video and image clips: click to select, drag to move, eight resize handles, and a Crop mode. It writes its result back to the engine as a <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">transform</code> (or a <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">crop</code>), so there is one renderer and one source of truth.
          </p>
          <CodeBlock
            language="typescript"
            code={`interface Transform {
  x: number        // position, normalized 0..1 of stage width
  y: number        // position, normalized 0..1 of stage height
  scale: number    // uniform scale factor (1 = native size)
  scaleX?: number  // extra horizontal stretch on top of scale; omitted = 1
  scaleY?: number  // extra vertical stretch on top of scale; omitted = 1
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
          <ul className="mt-4 mb-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-on-surface-variant">
            <li>
              <strong className="text-on-surface font-medium">Eight resize handles</strong>: four corners and four edges. Dragging a handle scales the clip on that axis (<code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">scaleX</code> and <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">scaleY</code>), so a non-uniform stretch is the default. Hold <kbd className="rounded border border-outline-variant bg-surface-container px-1.5 py-0.5 font-mono text-2xs">Shift</kbd> to keep the aspect ratio. The opposite corner or edge stays fixed on screen while you drag.
            </li>
            <li>
              <strong className="text-on-surface font-medium">Crop mode.</strong> A small Resize / Crop toggle floats above the selection box. In Crop mode the same eight handles resize the clip&apos;s <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">crop</code> window instead of its scale, and dragging inside the box pans the source underneath a fixed crop window. A fresh selection always starts in Resize. See <Link href="/docs/clips#crop" className="text-primary hover:underline">Clips &amp; Tracks</Link>.
            </li>
            <li>
              <strong className="text-on-surface font-medium">One undo step per gesture.</strong> Move, resize and crop all write through the same preview-then-commit protocol, so each drag is a single undo entry, and preview and export honour the result identically.
            </li>
            <li>
              <strong className="text-on-surface font-medium">A clip with no transform</strong> is drawn contained. On the first gesture the overlay bakes the contain-equivalent transform (<code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">transformFromContainRect</code>) as the baseline, so grabbing a clip never moves it.
            </li>
          </ul>
          <div className="mt-4 rounded-md border border-outline-variant bg-surface-low p-4">
            <div className="label-mono mb-1 text-2xs text-on-surface-variant opacity-90">Rotation</div>
            <p className="text-xs leading-relaxed text-on-surface-variant">
              <code className="rounded bg-surface-container px-1.5 py-0.5 font-mono">transform.rotation</code> flows through both renderers, and the media selection box tilts with the clip. <strong className="text-on-surface font-medium">Text clips have a rotate knob</strong> above the box (drag it; Shift snaps to 15 degree steps). <strong className="text-on-surface font-medium">Media clips do not have a rotate handle yet</strong>: set <code className="rounded bg-surface-container px-1.5 py-0.5 font-mono">rotation</code> on the transform through the engine, as above.
            </p>
          </div>
        </section>

        {/* Text overlays */}
        <section className="mb-10">
          <h2 id="text-overlays" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20">
            Text Overlays
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            Text clips are rendered via a 2D-canvas-to-texture pipeline (GPU <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">TextLayer</code>). An interactive overlay (<code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">TextOverlay</code>) handles drag, resize (re-rasterized to stay crisp), rotation by a knob above the box, and double-click inline-edit.
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
          <p className="mt-4 text-sm leading-relaxed text-on-surface-variant">
            One end of an animation can also drive several channels at once with a layered <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">MotionSpec</code>, and 14 built-in text templates bundle a look with its motion. Applying a template is one undoable <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">engine.updateClip</code> call. See <Link href="/docs/text-templates-and-motion" className="text-primary hover:underline">Text Templates &amp; Motion</Link>.
          </p>
        </section>

        {/* Transitions */}
        <section className="mb-10">
          <h2 id="transitions" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20">
            Transitions
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            The resolver keeps both clips in the scene for the length of a transition and lists it in <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">scene.transitions</code> with its eased progress. The WebGL2 renderer draws each clip, with its effects, transform and blend, into its own target and composites the pair with one transition shader, so both clips keep playing through it. Export runs the same shader. There are nine kinds; a project that uses only the first three still exports where the worker has no WebGL2 (a 2D snapshot path, with a left-or-right slide), while any of the six after <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">wipe</code> needs WebGL2 and fails the export without it:
          </p>
          <div className="mb-4 overflow-hidden rounded-md border border-outline-variant">
            {[
              ['fade', 'Cross-fade: the outgoing clip fades out over the incoming one.'],
              ['slide', 'The outgoing clip slides off the stage in the given direction (left, right, up or down; the default is right).'],
              ['wipe', 'A hard edge sweeps across, revealing the incoming clip. It ignores direction.'],
              ['zoom', 'Punch through into the next clip.'],
              ['spin', 'Rotate out, rotate in.'],
              ['whip', 'A fast blurred pan between clips; takes a direction.'],
              ['glitchCut', 'A burst of digital glitch at the cut.'],
              ['warpDissolve', 'A noisy, melting dissolve.'],
              ['lumaWipe', 'Dark areas give way first.'],
            ].map(([kind, desc], i) => (
              <div
                key={kind}
                className={`flex flex-col gap-1 border-b border-outline-variant p-3 last:border-0 sm:flex-row sm:items-start sm:gap-4 ${i % 2 === 0 ? 'bg-surface-low' : 'bg-surface-lowest'}`}
              >
                <code className="font-mono text-xs font-medium text-on-surface sm:w-28 sm:shrink-0">{kind}</code>
                <div className="text-xs leading-relaxed text-on-surface-variant">{desc}</div>
              </div>
            ))}
          </div>
          <CodeBlock
            language="tsx"
            code={`// Add a transition between two adjacent clips on the same track.
// trackId is required; returns the created Transition (or null if the
// clips aren't found on that track).
engine.addTransition({
  fromClipId: clip1.id,
  toClipId: clip2.id,
  trackId: track.id,
  kind: 'fade',           // 'fade' | 'slide' | 'wipe' | 'zoom' | 'spin' | 'whip'
                          // | 'glitchCut' | 'warpDissolve' | 'lumaWipe'
  durationFrames: 15,
  easing: 'ease-out',     // 'linear' | 'ease-in' | 'ease-out'
  direction: 'left',      // optional: 'left' | 'right' | 'up' | 'down' (slide and whip)
})

// Read transitions
const transitions = useTransitionsStore((s) => s.transitions)

// Remove a transition
engine.removeTransition(transitionId)`}
          />
        </section>

        {/* Stage aspect */}
        <section className="mb-10">
          <h2 id="stage-aspect" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20">
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
