import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { DocsToc } from '@/components/docs/DocsToc'
import { Code } from '@/components/docs/Code'
import { C, Callout, DocsPager, H2, H3, P, PropTable } from '@/components/docs/DocsKit'
import { PageHeader } from '@/components/site/PageHeader'
import { label } from '@/components/eb'

export const metadata: Metadata = {
  title: 'Frame Sequences',
  description:
    'Ordered image sets addressed by index: 360 degree orbits, generated sets and storyboards. createFrameSequence, FrameSequenceController, createFramePreloader and frameSequenceToProject.',
  alternates: { canonical: '/docs/frame-sequences' },
}

const toc = [
  { id: 'create', title: 'Create a sequence', level: 2 },
  { id: 'controller', title: 'FrameSequenceController', level: 2 },
  { id: 'preloading', title: 'Preloading', level: 2 },
  { id: 'to-project', title: 'To a project', level: 2 },
  { id: 'export', title: 'Export', level: 2 },
]

const link = 'text-on-surface underline decoration-[#FF003C] underline-offset-4 hover:decoration-2'

function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="my-4 list-none space-y-3 p-0 text-[15px] leading-[1.75] text-on-surface/85">
      {items.map((t, i) => (
        <li key={i} className="flex gap-3">
          <span aria-hidden className="mt-[11px] h-[5px] w-[5px] shrink-0 bg-on-surface" />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  )
}

/** One row of frame cells. `mark` cells are drawn solid: the frames the row is about. */
function Strip({ cells, mark = [] }: { cells: (number | string)[]; mark?: number[] }) {
  return (
    <div className="flex gap-1">
      {cells.map((c, i) => (
        <span
          key={i}
          className={`flex h-8 w-8 items-center justify-center border font-[family-name:var(--font-geist-mono),monospace] text-[12px] ${
            mark.includes(i) ? 'border-on-surface bg-on-surface text-surface' : 'border-outline-variant bg-surface-low text-on-surface'
          }`}
        >
          {c}
        </span>
      ))}
    </div>
  )
}

/** Where playback goes after the last frame of a 6-frame sequence, per loop mode. */
function LoopModes() {
  const rows: [string, string, number[]][] = [
    ['none', 'Stops on the last frame.', [3, 4, 5, 5, 5, 5]],
    ['wrap', 'The first frame follows the last.', [3, 4, 5, 0, 1, 2]],
    ['pingpong', 'Turns around at each end.', [3, 4, 5, 4, 3, 2]],
  ]
  return (
    <div className="my-6 border border-outline-variant">
      <div className={`border-b border-outline-variant bg-surface-low px-4 py-2 text-on-surface-variant ${label}`}>
        Frames 0–5. Solid: what plays after the last frame
      </div>
      {rows.map(([mode, desc, walk]) => (
        <div key={mode} className="flex flex-col gap-2 border-b border-outline-variant px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:gap-6">
          <div className="sm:w-48">
            <span className="font-[family-name:var(--font-geist-mono),monospace] text-[13px] font-medium text-on-surface">{mode}</span>
            <div className="text-[13px] text-on-surface-variant">{desc}</div>
          </div>
          <Strip cells={walk} mark={[3, 4, 5]} />
        </div>
      ))}
    </div>
  )
}

/** Load order around the frame on screen: nearest first, ties to the lower index. */
function PreloadOrder() {
  const count = 11
  const focus = 5
  const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => Math.abs(a - focus) - Math.abs(b - focus) || a - b)
  const rank = (i: number) => order.indexOf(i) + 1
  return (
    <div className="my-6 border border-outline-variant">
      <div className={`border-b border-outline-variant bg-surface-low px-4 py-2 text-on-surface-variant ${label}`}>
        Load order with frame 5 on screen
      </div>
      <div className="flex flex-col gap-2 px-4 py-4">
        <div className="flex gap-1">
          {Array.from({ length: count }, (_, i) => (
            <span key={i} className="w-8 text-center font-[family-name:var(--font-geist-mono),monospace] text-[11px] text-on-surface-variant">
              {i}
            </span>
          ))}
        </div>
        <div className="flex gap-1">
          {Array.from({ length: count }, (_, i) => {
            const r = rank(i)
            return (
              <span
                key={i}
                className={`flex h-8 w-8 items-center justify-center border font-[family-name:var(--font-geist-mono),monospace] text-[12px] ${
                  i === focus ? 'border-[#FF003C] bg-[#FF003C] text-[#0E0E10]' : 'border-outline-variant text-on-surface'
                }`}
                style={i === focus ? undefined : { backgroundColor: `color-mix(in srgb, var(--color-on-surface) ${Math.max(4, 34 - r * 3)}%, transparent)` }}
              >
                {r}
              </span>
            )
          })}
        </div>
        <span className="text-[13px] text-on-surface-variant">Darker loads sooner. Under wrap, distance is measured the short way round.</span>
      </div>
    </div>
  )
}

export default function FrameSequencesPage() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
      <article className="min-w-0 max-w-3xl flex-1">
        <PageHeader
          variant="doc"
          eyebrow="Engine &amp; data"
          title="Frame Sequences"
          lede="An ordered set of images you move through by index: a 360° product orbit, a generated set, a storyboard. Play it, scrub it by dragging, or turn it into an editable project."
        />
        <Callout title="You draw the frames">
          There is no viewer component. A frame sequence is plain data plus a controller; your app renders the current frame, or turns the
          sequence into a project with <C>frameSequenceToProject</C>. It lives in <C>@elah/core</C> and is re-exported by <C>@elah/editor</C>.
        </Callout>

        <H2 id="create">Create a sequence</H2>
        <P>
          Pass a list of image URLs, or partial frames, to <C>createFrameSequence</C>. A plain manifest works.
        </P>
        <Code
          highlight={[4]}
          code={`
import { createFrameSequence } from '@elah/editor'

const orbit = createFrameSequence({
  frames: ['orbit-000.webp', 'orbit-001.webp', 'orbit-002.webp' /* ... */],
  seamless: true, // the last frame joins the first without a jump
  fps: 24,        // default 24
  label: 'Penthouse, living room',
  aspectRatio: 16 / 9,
})`}
        />

        <H3>Loop modes</H3>
        <P>
          <C>loop</C> decides what happens at the ends. If you leave it out it follows <C>seamless</C>: a closed orbit wraps, anything else
          turns around.
        </P>
        <LoopModes />
        <Callout title="Why seamless exists">
          A camera arc that stops at 200° looks broken when it wraps from the last frame to the first. Describe it with <C>seamless: false</C> and
          it plays back and forth instead.
        </Callout>

        <H3>Reading frames</H3>
        <PropTable
          nameLabel="Export"
          rows={[
            { name: 'frameCount(sequence)', desc: 'How many frames there are.' },
            { name: 'frameAt(sequence, index)', desc: 'The frame at an index, after normalizing it. Throws only on an empty sequence.' },
            { name: 'normalizeFrameIndex(sequence, index)', desc: <>Applies the loop mode. <C>-1</C> becomes the last frame under wrap. Drag, scrub, keys and playback all go through this one function, so they always agree about the ends.</> },
          ]}
        />
        <P>
          A frame can also list <C>sources</C>, several sizes or formats such as AVIF before WebP, for responsive loading. <C>frame.src</C> is always
          the fallback.
        </P>

        <H2 id="controller">FrameSequenceController</H2>
        <P>
          The controller plays a sequence and turns pointer drags into frame changes. Each controller is independent, so several sequences can
          run on one page. Its clock is the same <C>PlaybackEngine</C> the editor uses.
        </P>
        <Code
          code={`
import { FrameSequenceController } from '@elah/editor'

const controller = new FrameSequenceController({ sequence: orbit })
// options: fps, loop, initialIndex, dragSensitivity

controller.play()
controller.seek(12) // normalized by the loop mode`}
        />
        <PropTable
          nameLabel="Method"
          rows={[
            { name: 'play() · pause() · toggle()', desc: 'Start and stop playback.' },
            { name: 'seek(index) · next() · prev()', desc: 'Jump to a frame. Indices are normalized by the loop mode.' },
            { name: 'setLoop · setSequence · setDragSensitivity', desc: <>Change settings later. <C>setSequence(sequence, {'{ preserveIndex }'})</C> can keep the current frame.</> },
            { name: 'subscribe(fn) · getSnapshot()', desc: <>Listen for <C>{'{ index, isPlaying, isDragging, epoch }'}</C>.</> },
            { name: 'detach() · reattach()', desc: 'Release and restore the clock, for effect cleanup.' },
            { name: 'destroy()', desc: 'Shut it down for good.' },
          ]}
        />

        <H3>Drag to scrub</H3>
        <P>Tell it how wide the viewer is, then feed it pointer positions:</P>
        <Code
          highlight={[1]}
          code={`
controller.setViewportWidth(el.clientWidth)
el.onpointerdown = (e) => controller.beginDrag(e.clientX)
el.onpointermove = (e) => controller.drag(e.clientX)
el.onpointerup = () => controller.endDrag()`}
        />
        <Bullets
          items={[
            <>
              <strong className="font-semibold text-on-surface">One drag across the viewer = one trip through the sequence</strong>, on a phone or
              a 4K screen. Change that with <C>dragSensitivity</C> (default 1). Until the width is known, it uses 8 pixels per frame.
            </>,
            <>
              <strong className="font-semibold text-on-surface">Dragging pauses playback</strong>, and listeners only hear about it when the frame
              number actually changes, so a 120 Hz pointer does not cause 120 renders a second.
            </>,
          ]}
        />

        <H3>In React</H3>
        <P>
          <C>getSnapshot()</C> returns the same object until something changes, so it plugs straight into <C>useSyncExternalStore</C>:
        </P>
        <Code
          highlight={[3, 4]}
          code={`
const snap = useSyncExternalStore(
  (onChange) => controller.subscribe(onChange),
  () => controller.getSnapshot(),
)
return <img src={frameAt(orbit, snap.index).src} />`}
        />
        <Callout kind="warning" title="Wrap the methods; they are not bound">
          Passing <C>controller.subscribe</C> on its own loses <C>this</C>. Call it through an arrow function, as above.
        </Callout>
        <Callout kind="warning" title="Use detach in effect cleanup, not destroy">
          React StrictMode runs setup, cleanup, then setup again on the same controller. <C>detach()</C> can be undone by <C>reattach()</C>;{' '}
          <C>destroy()</C> cannot.
        </Callout>

        <H2 id="preloading">Preloading</H2>
        <P>
          A 36-frame orbit is 36 requests. Fire them all at once and the frame on screen waits; load lazily and every drag flashes.{' '}
          <C>createFramePreloader</C> loads outward from the current frame, a few at a time:
        </P>
        <PreloadOrder />
        <Code
          highlight={[10]}
          code={`
import { createFramePreloader } from '@elah/editor'

const preloader = createFramePreloader(orbit, {
  radius: 2,      // urgent frames either side of the focus (default 2)
  concurrency: 6, // loads at once (default 6)
  sizeHint: { widthCss: 960, dpr: window.devicePixelRatio },
  onProgress: ({ loaded, total, complete }) => {},
})

preloader.focus(controller.index) // cheap: call it on every frame change
preloader.isLoaded(12)
preloader.status() // { loaded, total, complete }
preloader.dispose()`}
        />
        <Bullets
          items={[
            'A frame that fails to load still counts as settled, so one broken image never blocks the rest.',
            'Images go through the engine’s shared cache: a frame preloaded here is the same decoded image the renderer uses if the sequence later goes on the timeline.',
            <>
              It warms the URL the browser will really request. <C>pickFrameSource(frame, sizeHint)</C> picks it: the first supported format, then
              the smallest size that still covers <C>widthCss × dpr</C>, else the largest, else <C>frame.src</C>.
            </>,
          ]}
        />

        <H2 id="to-project">To a project</H2>
        <P>
          <C>frameSequenceToProject</C> turns a sequence into an ordinary project: every frame becomes an image clip, end to end on one video track.
          Load it into the engine and it can be trimmed, split, reordered, given transitions and exported.
        </P>
        <Code
          highlight={[4]}
          code={`
import { frameSequenceToProject } from '@elah/editor'

const project = frameSequenceToProject(orbit, {
  holdFrames: 6,                        // timeline frames per image (default 1)
  fps: 30,                              // default: the sequence's fps
  stage: { width: 1080, height: 1920 }, // default 1920 × 1080
  trackName: 'Orbit',
  projectId: 'orbit-demo',
})

engine.loadProject(project)`}
        />
        <PropTable
          nameLabel="Option"
          rows={[
            { name: 'holdFrames', type: 'number', optional: true, desc: 'How long each image stays up. 1 makes timeline frame and image index the same number, right for a scrubbed 360° viewer. 6 turns a 36-frame orbit into a 7.2-second slideshow at 30 fps.' },
            { name: 'fps', type: 'number', optional: true, desc: 'Timeline frame rate. Defaults to the sequence’s.' },
            { name: 'stage', type: '{ width, height }', optional: true, desc: 'Defaults to landscape 1920 × 1080, because orbits and storyboards usually are. Matches the CLI spec default.' },
            { name: 'trackName · projectId', type: 'string', optional: true, desc: 'Names for the track and the project.' },
          ]}
        />
        <Callout title="Only frame.src is used">
          Responsive <C>sources</C> are not carried into the project. The function touches no engine, store or page, and stamps the project with{' '}
          <C>PROJECT_VERSION</C>.
        </Callout>

        <H2 id="export">Export</H2>
        <P>
          The result is a normal project, so it exports like any other. See{' '}
          <Link href="/docs/export" className={link}>
            Export
          </Link>{' '}
          for the options, including why <C>outputHeight</C> is the short edge.
        </P>
        <Code
          code={`
import { exportVideo, frameSequenceToProject } from '@elah/editor'

const project = frameSequenceToProject(orbit, { holdFrames: 2 })
const blob = await exportVideo(project, { outputHeight: 1080 })`}
        />
        <P>
          To render on a server instead, pass the same project to <C>exportProject</C> in{' '}
          <Link href="/docs/cli#library-api" className={link}>
            @elah/cli
          </Link>
          .
        </P>

        <DocsPager href="/docs/frame-sequences" />
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
