import type { Metadata } from 'next'
import Link from 'next/link'
import { DocsToc } from '@/components/docs/DocsToc'
import { Code } from '@/components/docs/Code'
import { C, Callout, DocsPager, H2, H3, Kbd, P, PropTable } from '@/components/docs/DocsKit'
import { LazyDemo } from '@/components/home/LazyDemo'
import { PageHeader } from '@/components/site/PageHeader'
import { label } from '@/components/eb'

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
  { id: 'text-overlays', title: 'Text overlays', level: 2 },
  { id: 'transitions', title: 'Transitions', level: 2 },
  { id: 'stage-aspect', title: 'Stage & aspect ratio', level: 2 },
]

const link = 'text-on-surface underline decoration-[#FF003C] underline-offset-4 hover:decoration-2'
const bullets = 'my-4 list-none space-y-3 p-0 text-[15px] leading-[1.75] text-on-surface/85'
const dot = <span aria-hidden className="mt-[11px] h-[5px] w-[5px] shrink-0 bg-on-surface" />

export default function EditorPage() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
      <article className="min-w-0 max-w-3xl flex-1">
        <PageHeader
          variant="doc"
          eyebrow="Editor"
          title="Editor"
          lede="The pieces of a full editor: EditorProvider holds the project, Preview draws it, AssetPanel brings in media, and on-canvas overlays move, resize, crop and edit text."
        />

        <figure className="my-8 border border-outline-variant">
          <LazyDemo name="hero" timelineHeight={140} minHeight={460} label="Preview and Timeline in one EditorProvider" />
          <figcaption className={`border-t border-outline-variant px-4 py-2.5 text-on-surface-variant ${label}`}>
            Preview and Timeline in one EditorProvider, running on this page
          </figcaption>
        </figure>

        <H2 id="editor-provider">EditorProvider</H2>
        <P>
          <C>EditorProvider</C> creates the <C>TimelineEngine</C>, the <C>PlaybackEngine</C> and the stores, and connects them. Wrap your whole
          editor in it.
        </P>
        <Code
          highlight={[11, 12, 13]}
          code={`
import { EditorProvider, type InitialTrackConfig } from '@elah/editor'

const tracks: InitialTrackConfig[] = [
  { kind: 'video', name: 'Video / Image' },
  { kind: 'audio', name: 'Audio' },
  { kind: 'elements', name: 'Elements' },
]

function App() {
  return (
    <EditorProvider fps={30} initialTracks={tracks}>
      {/* Preview, Timeline, AssetPanel, your own UI */}
    </EditorProvider>
  )
}`}
        />
        <PropTable
          nameLabel="Prop"
          rows={[
            { name: 'fps', type: 'number', desc: 'Frames per second, such as 24, 30 or 60. Required.' },
            { name: 'initialTracks', type: 'InitialTrackConfig[]', desc: 'The track layout the engine starts with.' },
            { name: 'children', type: 'ReactNode', desc: 'Everything that uses the engine.' },
          ]}
        />
        <Callout title="Engine hooks only work inside the provider">
          <C>useTimelineEngine()</C>, the store hooks and every editor component need an <C>EditorProvider</C> above them.
        </Callout>

        <H2 id="preview">Preview</H2>
        <P>
          <C>Preview</C> is the video canvas. It draws each frame with the WebGL2 renderer, runs the playback loop, and paints the transform
          overlays on top.
        </P>
        <Code
          title="MyPreview.tsx"
          highlight={[3]}
          code={`
import { Preview, createDefaultDemuxerFactory } from '@elah/editor'

const demuxerFactory = createDefaultDemuxerFactory()

function MyPreview() {
  return <Preview demuxerFactory={demuxerFactory} style={{ flex: 1 }} />
}`}
        />
        <Callout title="Create the demuxer factory once">
          Build it outside the component, as above, so it is not recreated on every render.
        </Callout>
        <PropTable
          nameLabel="Prop"
          rows={[
            { name: 'demuxerFactory', type: 'DemuxerFactory', desc: <>Reads media files; needed for real playback. <C>createDefaultDemuxerFactory()</C> gives you the built-in one.</> },
            { name: 'enableAudio', type: 'boolean', optional: true, desc: 'Play audio with the video. Default true.' },
            { name: 'ref', type: 'PreviewHandle', optional: true, desc: <><C>getCanvas()</C> returns the canvas element, <C>getRenderer()</C> the GpuRenderer. Both can be null.</> },
          ]}
        />
        <P>
          The canvas is letterboxed to the stage&apos;s aspect ratio. A clip with a different shape is fitted inside the frame, never
          stretched, like <C>object-fit: contain</C>.
        </P>

        <H2 id="asset-panel">AssetPanel</H2>
        <P>The media library, ready to drop in:</P>
        <ul className={bullets}>
          {[
            'Import files with a button or by dragging them in.',
            'Filmstrip thumbnails for video, waveforms for audio.',
            'Drag an asset onto the timeline to make a clip.',
          ].map((t) => (
            <li key={t} className="flex gap-3">
              {dot}
              {t}
            </li>
          ))}
        </ul>
        <Code
          code={`
import { AssetPanel } from '@elah/editor'

<AssetPanel style={{ width: 240, minHeight: 0, overflowY: 'auto' }} />`}
        />
        <H3>Build your own library</H3>
        <P>
          <C>AssetPanel</C> is built on <C>useMediaLibrary()</C>. Use the hook directly for a custom UI. <C>importFiles</C> takes any list of files
          and tells you which were imported and which were skipped.
        </P>
        <Code
          highlight={[4, 7]}
          code={`
import { useMediaLibrary } from '@elah/editor'

function CustomLibrary() {
  const { assets, importFiles, removeAsset } = useMediaLibrary()

  const onDrop = async (files: FileList) => {
    const { imported, skipped } = await importFiles(files)
  }

  return (
    <div onDrop={(e) => onDrop(e.dataTransfer.files)}>
      {assets.map((a) => <div key={a.id}>{a.name}</div>)}
    </div>
  )
}`}
        />

        <H2 id="transforms">Transforms</H2>
        <P>
          A clip&apos;s optional <C>transform</C> places it on the stage. Users change it by dragging on the canvas; you can also set it from code.
          Either way it is saved on the clip, so the preview and the export always agree.
        </P>
        <PropTable
          rows={[
            { name: 'x · y', type: 'number', desc: 'Position, as a fraction (0 to 1) of the stage width and height.' },
            { name: 'scale', type: 'number', desc: 'Uniform size. 1 is the native size.' },
            { name: 'scaleX · scaleY', type: 'number', optional: true, desc: 'Extra stretch on one axis, on top of scale. Default 1.' },
            { name: 'rotation', type: 'number', desc: 'In radians. Positive is clockwise.' },
            { name: 'anchor', type: '{ x, y }', desc: 'The point the clip scales and rotates around, as a fraction of its own box.' },
          ]}
        />
        <Code
          highlight={[2]}
          code={`
engine.updateClip(clipId, trackId, {
  transform: { x: 0.5, y: 0.4, scale: 1.2, rotation: 0, anchor: { x: 0.5, y: 0.5 } },
})`}
        />

        <H3>Editing on the canvas</H3>
        <P>
          Select a video or image clip in the preview and <C>MediaTransformOverlay</C> takes over:
        </P>
        <ul className={bullets}>
          <li className="flex gap-3">
            {dot}
            <span>
              <strong className="font-semibold text-on-surface">Eight resize handles</strong> on the corners and edges. They stretch freely; hold{' '}
              <Kbd>Shift</Kbd> to keep the aspect ratio. The opposite side stays put while you drag.
            </span>
          </li>
          <li className="flex gap-3">
            {dot}
            <span>
              <strong className="font-semibold text-on-surface">Crop mode.</strong> A Resize / Crop toggle sits above the selection. In Crop mode
              the handles change the crop window, and dragging inside pans the source underneath. A new selection always starts in Resize. More in{' '}
              <Link href="/docs/clips#crop" className={link}>
                Clips &amp; Tracks
              </Link>
              .
            </span>
          </li>
          <li className="flex gap-3">
            {dot}
            <span>
              <strong className="font-semibold text-on-surface">One undo step per drag.</strong> Moving, resizing and cropping each save as a single
              history entry.
            </span>
          </li>
          <li className="flex gap-3">
            {dot}
            <span>
              <strong className="font-semibold text-on-surface">Grabbing never moves a clip.</strong> A clip without a transform is drawn fitted
              to the frame; the first drag starts from exactly that position.
            </span>
          </li>
        </ul>
        <Callout kind="warning" title="Media clips have no rotate handle yet">
          Text clips do: drag the knob above the box, and hold <Kbd>Shift</Kbd> to snap to 15° steps. For video and image clips, set{' '}
          <C>rotation</C> on the transform from code, as above.
        </Callout>

        <H2 id="text-overlays">Text overlays</H2>
        <P>
          Text clips are drawn by the GPU like any other layer. On the canvas, users can drag them, resize them (the text is redrawn, so it stays
          sharp), rotate them with the knob, and double-click to edit the words in place.
        </P>
        <Code
          highlight={[7, 8, 9, 10, 11, 12, 13, 14]}
          code={`
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
    fontWeight: 'bold',  // 'normal' | 'bold'
    textAlign: 'center', // 'left' | 'center' | 'right'
    fontFamily: 'Inter',
  },
  transform: { x: 0.5, y: 0.8, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } },
})`}
        />
        <Callout title="text is required for text clips">
          When <C>type</C> is <C>&apos;text&apos;</C>, the <C>text</C> option carries the words and their style.
        </Callout>
        <P>
          Fade a title in and out by setting <C>textAnimation</C> on the clip after you create it:
        </P>
        <Code
          code={`
engine.updateClip(clipId, textTrack.id, {
  textAnimation: { in: 'fade', out: 'fade', durationFrames: 10 },
})`}
        />
        <P>
          For more than a fade, a layered <C>MotionSpec</C> animates several properties at once, and 14 built-in text templates bundle a look with
          its motion. See{' '}
          <Link href="/docs/text-templates-and-motion" className={link}>
            Text Templates &amp; Motion
          </Link>
          .
        </P>

        <H2 id="transitions">Transitions</H2>
        <P>
          A transition blends two neighbouring clips on the same track. Both clips keep playing through it, with their effects, and the export
          uses the same shader as the preview.
        </P>
        <Code
          highlight={[5, 8]}
          code={`
engine.addTransition({
  fromClipId: clip1.id,
  toClipId: clip2.id,
  trackId: track.id,  // required
  kind: 'slide',
  durationFrames: 15,
  easing: 'ease-out', // 'linear' | 'ease-in' | 'ease-out'
  direction: 'left',  // slide and whip: 'left' | 'right' | 'up' | 'down'
})`}
        />
        <P>
          It returns the new transition, or <C>null</C> if the clips are not on that track. Remove one with{' '}
          <C>engine.removeTransition(id)</C>, and read them all with <C>useTransitionsStore((s) =&gt; s.transitions)</C>.
        </P>
        <PropTable
          nameLabel="Kind"
          rows={[
            { name: 'fade', desc: 'The outgoing clip fades out over the incoming one.' },
            { name: 'slide', desc: 'The outgoing clip slides off the stage. Takes a direction; the default is right.' },
            { name: 'wipe', desc: 'A hard edge sweeps across to reveal the incoming clip.' },
            { name: 'zoom', desc: 'Punch through into the next clip.' },
            { name: 'spin', desc: 'Rotate out, rotate in.' },
            { name: 'whip', desc: 'A fast blurred pan. Takes a direction.' },
            { name: 'glitchCut', desc: 'A burst of digital glitch at the cut.' },
            { name: 'warpDissolve', desc: 'A noisy, melting dissolve.' },
            { name: 'lumaWipe', desc: 'Dark areas give way first.' },
          ]}
        />
        <Callout kind="warning" title="Six of the nine need WebGL2 to export">
          A project that only uses <C>fade</C>, <C>slide</C> and <C>wipe</C> still exports where the export worker has no WebGL2 (slides then
          go only left or right). Any of the other six makes that export fail.
        </Callout>

        <H2 id="stage-aspect">Stage &amp; aspect ratio</H2>
        <P>
          The stage is the frame size of the video. Set it on the engine with a width and a height; the preview follows and every clip is
          letterboxed to it. Add <C>StageBorder</C> to outline the frame.
        </P>
        <Code
          code={`
const engine = useTimelineEngine()

engine.setStage(1080, 1920) // 9:16 portrait: Reels, Shorts, TikTok
engine.setStage(1920, 1080) // 16:9 landscape: YouTube
engine.setStage(1080, 1080) // 1:1 square`}
        />

        <DocsPager href="/docs/editor" />
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
