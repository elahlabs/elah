import type { Metadata } from 'next'
import Link from 'next/link'
import { CodeBlock } from '@/components/docs/CodeBlock'
import { DocsToc } from '@/components/docs/DocsToc'
import { PageHeader } from '@/components/site/PageHeader'

export const metadata: Metadata = {
  title: 'Frame Sequences',
  description:
    'Ordered image sets addressed by index: 360 degree orbits, generated sets and storyboards. createFrameSequence, FrameSequenceController, createFramePreloader and frameSequenceToProject.',
  alternates: { canonical: '/docs/frame-sequences' },
}

const toc = [
  { id: 'create', title: 'Create a Sequence', level: 2 },
  { id: 'controller', title: 'FrameSequenceController', level: 2 },
  { id: 'preloading', title: 'Preloading', level: 2 },
  { id: 'to-project', title: 'To a Project', level: 2 },
  { id: 'export', title: 'Export', level: 2 },
]

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20"
    >
      {children}
    </h2>
  )
}

function C({ children }: { children: React.ReactNode }) {
  return <code className="bg-surface-container px-1.5 py-0.5 text-xs font-mono">{children}</code>
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">{children}</p>
}

export default function FrameSequencesPage() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
      <article className="min-w-0 flex-1 max-w-3xl">
        <PageHeader
          variant="doc"
          eyebrow="Engine &amp; data"
          title="Frame Sequences"
          lede={
            <>
              An ordered set of images addressed by index: 360 degree orbits, generated sets, storyboards. A frame sequence is frames plus how to move through them, and it can be laid out as a project so it is editable and exportable like anything else.
            </>
          }
        />

        <section className="mb-10">
          <P>
            A sequence is deliberately not tied to what the frames depict. It is pure and React-free, and it lives in <C>@elah/core</C> (re-exported by <C>@elah/editor</C>). There is no viewer component in this repo. A host app renders the frames itself, or turns the sequence into a project with <C>frameSequenceToProject</C>.
          </P>
        </section>

        {/* Create */}
        <section className="mb-10">
          <H2 id="create">Create a Sequence</H2>
          <P>
            <C>createFrameSequence(options)</C> normalizes frames into <C>{'{ id, index, src }'}</C>. Pass bare URLs or partial frames, so a plain manifest works.
          </P>
          <CodeBlock
            language="typescript"
            code={`import { createFrameSequence, frameAt, frameCount, normalizeFrameIndex } from '@elah/editor'

const orbit = createFrameSequence({
  frames: ['orbit-000.webp', 'orbit-001.webp', 'orbit-002.webp' /* ... */],
  seamless: true,   // the last frame joins the first without a jump
  fps: 24,          // default 24
  label: 'Penthouse, living room',
  aspectRatio: 16 / 9,
})

frameCount(orbit)          // number of frames
frameAt(orbit, 1)          // the Frame at index 1 (normalized first; throws only on an empty sequence)
normalizeFrameIndex(orbit, -1) // -> last index, because loop is 'wrap'`}
          />
          <P>
            The loop mode decides what happens at the ends. <C>FrameLoopMode</C> is <C>&apos;none&apos;</C> (clamp: the first and last frames are walls), <C>&apos;wrap&apos;</C> (the last frame is followed by the first) or <C>&apos;pingpong&apos;</C> (reverse at each end, visiting each endpoint once). <C>loop</C> defaults from <C>seamless</C>: a closed orbit wraps, anything else bounces. That default is the reason <C>seamless</C> exists. A camera arc that stops at 200 degrees looks broken when wrapped, so describe it with <C>seamless: false</C>.
          </P>
          <P>
            <C>normalizeFrameIndex(sequence, index)</C> is the single place index movement is decided. Drag, scrub, keyboard and the playback clock all go through it, so they cannot disagree about the ends. A <C>Frame</C> may also carry <C>sources</C>, a list of <C>{'{ src, width, type? }'}</C> candidates (AVIF before WebP, for example) for responsive loading. <C>frame.src</C> is always the fallback.
          </P>
        </section>

        {/* Controller */}
        <section className="mb-10">
          <H2 id="controller">FrameSequenceController</H2>
          <P>
            <C>FrameSequenceController</C> is the transport and pointer-drag layer over a sequence. It is per instance, with nothing module-scoped, so several sequences can run on one page independently. Playback is not reimplemented: it owns a <C>PlaybackEngine</C>, the same anchor-and-integrate clock the editor transport uses.
          </P>
          <CodeBlock
            language="typescript"
            code={`import { FrameSequenceController } from '@elah/editor'

const controller = new FrameSequenceController({
  sequence: orbit,
  // optional: fps, loop ('none' | 'wrap' | 'pingpong'), initialIndex, dragSensitivity
})

controller.play()
controller.pause()
controller.toggle()
controller.seek(12)      // normalized by the loop mode
controller.next()
controller.prev()

// Drag-to-scrub. Tell it how wide the viewer is, then feed it pointer x values.
controller.setViewportWidth(el.clientWidth)
el.onpointerdown = (e) => controller.beginDrag(e.clientX)
el.onpointermove = (e) => controller.drag(e.clientX)
el.onpointerup = () => controller.endDrag()

// Subscribe. The snapshot is reference-stable between changes.
const unsubscribe = controller.subscribe((s) => {
  // s: { index, isPlaying, isDragging, epoch }
})

controller.destroy()`}
          />
          <ul className="mt-4 mb-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-on-surface-variant">
            <li>
              <strong className="text-on-surface font-medium">Drag is viewport-independent.</strong> <C>dragSensitivity</C> is the number of full-sequence traversals per drag across the viewer&apos;s width (default 1). One full-width drag moves through the whole sequence once, on a phone or a 4K monitor. Before the viewer reports its width, a fixed 8 pixels per frame is used.
            </li>
            <li>
              <strong className="text-on-surface font-medium">Drag pauses playback</strong> and only emits when the integer index actually changes, so a 120 Hz pointer stream does not become 120 renders a second.
            </li>
            <li>
              <C>getSnapshot()</C> is stable between changes, so it binds directly to React&apos;s <C>useSyncExternalStore</C> with no adapter. Other methods: <C>setLoop</C>, <C>setSequence(sequence, {'{ preserveIndex? }'})</C>, <C>setDragSensitivity</C>.
            </li>
            <li>
              <C>detach()</C> and <C>reattach()</C> release and restore the clock reversibly. Use them in an effect cleanup, because StrictMode runs setup, cleanup, setup against one memoized controller. <C>destroy()</C> is the irreversible one.
            </li>
          </ul>
        </section>

        {/* Preloading */}
        <section className="mb-10">
          <H2 id="preloading">Preloading</H2>
          <P>
            A 36-frame orbit is 36 requests. Firing them all at once starves the frame the user is looking at, and loading lazily flashes on every drag. <C>createFramePreloader</C> loads outward from the current index (current first, then plus and minus one, two and so on) under a concurrency cap. Under <C>wrap</C> it measures distance the short way round, so frame 0 treats the last frame as adjacent.
          </P>
          <CodeBlock
            language="typescript"
            code={`import { createFramePreloader } from '@elah/editor'

const preloader = createFramePreloader(orbit, {
  radius: 2,        // urgent window either side of the focus (default 2)
  concurrency: 6,   // simultaneous decodes (default 6)
  sizeHint: { widthCss: 960, dpr: window.devicePixelRatio },
  onProgress: ({ loaded, total, complete }) => {},
})

preloader.focus(controller.index)   // cheap; call it on every frame change
preloader.isLoaded(12)
preloader.status()                  // { loaded, total, complete }
preloader.dispose()`}
          />
          <P>
            Failures settle too, so a broken frame never wedges the queue. Decoding goes through core&apos;s shared image cache, so a frame preloaded here is the same decoded object the GPU renderer picks up if the sequence is later dropped on the timeline.
          </P>
          <P>
            <C>pickFrameSource(frame, sizeHint?)</C> returns the exact URL a browser would paint for a frame that has <C>sources</C>: the first type the browser supports wins (grouped in array order), then the narrowest candidate that still meets <C>widthCss * dpr</C>, else the widest. It falls back to <C>frame.src</C>. The preloader uses it so it warms the URL that will actually be requested. <C>supportsImageType(type)</C> is the memoized AVIF and WebP support probe behind it, and resolves <C>true</C> for any other type. Under SSR or jsdom it reports AVIF and WebP as unsupported.
          </P>
        </section>

        {/* To project */}
        <section className="mb-10">
          <H2 id="to-project">To a Project</H2>
          <P>
            <C>frameSequenceToProject(sequence, options?)</C> makes a sequence editable media rather than a dead image strip. Every frame becomes an image clip, laid end to end on one video track. The result is an ordinary <C>Project</C>: it loads into <C>engine.loadProject</C> and can be trimmed, split, reordered, transitioned and exported.
          </P>
          <CodeBlock
            language="typescript"
            code={`import { frameSequenceToProject } from '@elah/editor'

const project = frameSequenceToProject(orbit, {
  holdFrames: 6,                         // timeline frames per sequence frame (default 1)
  fps: 30,                               // default: the sequence's own fps
  stage: { width: 1080, height: 1920 },  // default 1920x1080
  trackName: 'Orbit',
  projectId: 'orbit-demo',
})

engine.loadProject(project)`}
          />
          <ul className="mt-4 mb-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-on-surface-variant">
            <li>
              With <C>holdFrames: 1</C>, timeline time and sequence index are the same number, which is what a scrubbed 360 degree viewer wants. Raising it holds each angle longer: 6 turns a 36-frame orbit into a 7.2 second slideshow at 30 fps.
            </li>
            <li>
              The stage is landscape (1920 by 1080) by default, not the engine&apos;s portrait default, because orbits and storyboards are usually landscape. It matches the CLI spec default.
            </li>
            <li>
              Each clip uses the frame&apos;s <C>src</C>. Responsive <C>sources</C> are not carried into the project.
            </li>
            <li>
              It is pure. It builds a <C>Project</C> and touches no engine, store or DOM, and it stamps the result with <C>PROJECT_VERSION</C>.
            </li>
          </ul>
        </section>

        {/* Export */}
        <section className="mb-10">
          <H2 id="export">Export</H2>
          <P>
            Because the result is a normal project, there is no special export path. Pass it to <C>exportVideo</C> (or <C>lazyExportVideo</C>) like any other composition, and see <Link href="/docs/export" className="text-on-surface underline decoration-primary underline-offset-4 hover:decoration-2">the Export page</Link> for the options, including how <C>outputHeight</C> is the short edge.
          </P>
          <CodeBlock
            language="typescript"
            code={`import { exportVideo, frameSequenceToProject } from '@elah/editor'

const project = frameSequenceToProject(orbit, { holdFrames: 2 })
const blob = await exportVideo(project, { outputHeight: 1080 })`}
          />
          <P>
            The same <C>Project</C> is plain data, so the headless runtime can render it too. <C>exportProject</C> in <Link href="/docs/cli#library-api" className="text-on-surface underline decoration-primary underline-offset-4 hover:decoration-2">@elah/cli</Link> takes a <C>Project</C> directly.
          </P>
        </section>
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
