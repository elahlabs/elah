import type { Metadata } from 'next'
import { DocsToc } from '@/components/docs/DocsToc'
import { MermaidDiagram } from '@/components/docs/MermaidDiagram'
import { PageHeader } from '@/components/site/PageHeader'
import { C, Callout, DocsPager, H2, P, PropTable } from '@/components/docs/DocsKit'

export const metadata: Metadata = {
  title: 'Architecture',
  description:
    'How elah works: the three-ring state model, the timeline engine and its one mutation funnel, the playback clock, and the rendering engine built on a pure resolver.',
  alternates: { canonical: '/docs/architecture' },
}

const toc = [
  { id: 'invariants', title: 'Three rules', level: 2 },
  { id: 'ring-states', title: 'Where state lives', level: 2 },
  { id: 'timeline-engine', title: 'Timeline engine', level: 2 },
  { id: 'playback-clock', title: 'Playback clock', level: 2 },
  { id: 'rendering-engine', title: 'Rendering', level: 2 },
  { id: 'overview', title: 'Layer reference', level: 2 },
]

const ringStatesDiagram = `
flowchart TD
    subgraph R0["Ring 0 — Engine (Source of Truth)"]
        TE["TimelineEngine\nImmer · history · events"]
        PE["PlaybackEngine\nanchor-integrate clock"]
    end
    subgraph R1["Ring 1 — Zustand Stores (Reactive Mirror)"]
        TS[useTracksStore]
        PS[usePlaybackStore]
        SS[useSelectionStore]
    end
    subgraph R2["Ring 2 — React UI (Transient)"]
        UI["Timeline · Preview · AssetPanel"]
    end
    R0 -->|"emit 'change' event"| R1
    R1 -->|"selector subscriptions → re-render"| R2
    R2 -->|"engine.addClip() / seek() / …"| R0
`

const timelineEngineDiagram = `
sequenceDiagram
    participant UI as React UI
    participant TE as TimelineEngine
    participant ZS as Zustand Stores

    UI->>TE: engine.addClip() / updateClip()
    TE->>TE: commit() — Immer draft → new Project
    TE-->>ZS: emit 'change' event
    ZS-->>UI: setState — only subscribed slices re-render

    UI->>TE: engine.undo()
    TE->>TE: pop history stack → restore prior Project
    TE-->>ZS: emit 'change' event
    ZS-->>UI: setState — UI reflects previous state
`

const playbackClockDiagram = `
flowchart TD
    A(["play() / seek(frame)"]) --> B["Set anchorFrame + anchorTime\n= current frame + now()"]
    B --> C["RAF tick"]
    C --> D["currentFrame =\nanchorFrame + (now − anchorTime) × fps × rate\nnow = audio clock, else performance.now()"]
    D --> E{"integer frame\nchanged?"}
    E -->|no| C
    E -->|yes| F["Notify subscribers"]
    F --> G["usePlaybackStore.setState"]
    G --> H["resolveTimeline(frame, project) → Scene"]
    H --> I["GpuRenderer.render(scene)"]
    I --> C
`

const renderingEngineDiagram = `
flowchart LR
    Scene --> RG["RenderGraph\nsort layers by zIndex"]
    RG --> VL["VideoLayer"]
    RG --> IL["ImageLayer"]
    RG --> TL["TextLayer"]

    VL --> FC{"FrameCache\nhit?"}
    FC -->|yes| TX["Upload to GPU Texture"]
    FC -->|no| DEC["VideoDecoderManager\nWebCodecs async decode"]
    DEC --> FC

    IL --> TX
    TL -->|"Canvas 2D rasterize\n→ ImageBitmap"| TX

    TX --> WGL["gl.drawArrays() × N layers\nunit quad + opacity"]
    WGL --> OUT["canvas output"]
`

export default function ArchitecturePage() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
      <article className="min-w-0 max-w-3xl flex-1">
        <PageHeader
          variant="doc"
          eyebrow="Architecture"
          title="Architecture"
          lede="How the engine is put together: where state lives, how an edit flows, how the clock keeps time, and how a frame reaches the screen."
        />

        <H2 id="invariants">Three rules</H2>
        <P>Everything else on this page follows from three rules that hold across every package:</P>
        <PropTable
          nameLabel="Rule"
          rows={[
            { name: 'Time is whole frames', desc: <>Positions and lengths are integer frame counts, never seconds. Convert at the edges with <C>secondsToFrames</C> and <C>framesToSeconds</C>. A whole class of floating-point drift bugs cannot happen.</> },
            { name: 'One way to change a project', desc: <>Every edit goes through <C>TimelineEngine</C>. The stores are read-only copies; writing to them breaks undo.</> },
            { name: 'The resolver is pure', desc: <><C>resolveTimeline(frame, project)</C> returns a <C>Scene</C> with no side effects. Renderers read the Scene and nothing else.</> },
          ]}
        />

        <H2 id="ring-states">Where state lives</H2>
        <P>
          State sits in three rings. The engine is the truth, the stores mirror it for React, and components hold only short-lived state such as
          a drag in progress.
        </P>
        <MermaidDiagram chart={ringStatesDiagram} />
        <PropTable
          nameLabel="Ring"
          rows={[
            { name: '0 · Engines', desc: <><C>TimelineEngine</C> and <C>PlaybackEngine</C>. Plain TypeScript, no framework. The only source of truth.</> },
            { name: '1 · Stores', desc: <>Zustand stores that mirror the engines so React can subscribe. Selection also lives here; it is UI state and never enters undo history.</> },
            { name: '2 · Components', desc: 'Timeline, Preview, panels. They read stores and call the engine directly to make changes.' },
          ]}
        />
        <Callout title="Why the engine has no framework">
          The same engine runs in Node, Web Workers and headless Chrome unchanged. That is how{' '}
          <a href="/docs/cli" className="text-on-surface underline decoration-[#FF003C] underline-offset-4">
            @elah/cli
          </a>{' '}
          renders on a server, and why tests can use it without mounting React. A test enforces that <C>@elah/core</C> never imports React.
        </Callout>

        <H2 id="timeline-engine">Timeline engine</H2>
        <P>
          Every public edit method (<C>addClip</C>, <C>trimClip</C>, <C>undo</C>…) ends in one private <C>commit()</C>. It applies the change
          with Immer, which produces a new immutable project and shares every unchanged part with the old one; records an undo step; and emits{' '}
          <C>change</C>. The stores pick that up and only components subscribed to the changed part re-render.
        </P>
        <MermaidDiagram chart={timelineEngineDiagram} />
        <Callout title="Every edit is undoable by construction">
          Because there is no other way to change a project, every edit lands in history and every subscriber hears about it. Drags use{' '}
          <C>previewClip</C> and <C>commitInteraction</C> so a whole drag is one undo step.
        </Callout>

        <H2 id="playback-clock">Playback clock</H2>
        <P>
          The clock does not count ticks. On every <C>play()</C> or <C>seek()</C> it records an anchor: the current frame and the current time.
          Each animation frame it works out the position from that anchor, so error never builds up and a rate change takes effect at once.
        </P>
        <MermaidDiagram chart={playbackClockDiagram} />
        <PropTable
          nameLabel="Detail"
          rows={[
            { name: 'Audio clock first', desc: <>While audio is running, &ldquo;now&rdquo; is the sound card&apos;s clock (<C>AudioContext.currentTime</C>), not <C>performance.now()</C>. Picture follows sound, so they cannot drift apart.</> },
            { name: 'Hidden tab', desc: 'When the tab is hidden the position freezes; when it comes back the clock restarts from there instead of jumping ahead.' },
            { name: 'Whole-frame updates', desc: 'Subscribers hear about it only when the integer frame changes, not on every animation frame.' },
          ]}
        />

        <H2 id="rendering-engine">Rendering</H2>
        <P>
          The renderer gets a <C>Scene</C>, a plain list of what is visible, and draws it as textured quads on a WebGL2 canvas. It knows nothing
          about the project, history or React. <C>render()</C> is synchronous and never waits: video frames are decoded in the background into a
          cache, and the render call takes whatever is ready.
        </P>
        <MermaidDiagram chart={renderingEngineDiagram} />
        <Callout title="A missing frame never flashes black">
          If the frame is not decoded yet, after a seek or at a cold start, the layer keeps its last uploaded picture until the decoder catches
          up. At a direct cut between two videos, the outgoing clip&apos;s last frame is held for a few frames while the new one starts decoding.
        </Callout>
        <P>
          Export uses the same <C>resolveTimeline</C> in a worker, which is why a file matches the preview. See{' '}
          <a href="/docs/export#worker" className="text-on-surface underline decoration-[#FF003C] underline-offset-4">
            Export: how it works
          </a>
          .
        </P>

        <H2 id="overview">Layer reference</H2>
        <PropTable
          nameLabel="Layer"
          rows={[
            { name: 'React UI', type: 'Timeline · Preview · AssetPanel · overlays', desc: 'Reads stores through hooks; calls the engine to change things.' },
            { name: 'Stores', type: 'tracks · playback · selection · transitions', desc: 'Mirrors filled by engine events. Not owned by any component.' },
            { name: 'Engines', type: 'TimelineEngine · PlaybackEngine · AudioPlaybackController', desc: 'Plain TypeScript. All edits go through commit().' },
            { name: 'Resolver', type: 'resolveTimeline(frame, project) → Scene', desc: 'Pure and deterministic. Runs in tests, workers and export.' },
            { name: 'Renderer', type: 'GpuRenderer · RenderGraph · one layer per clip type', desc: 'Reads a Scene, writes pixels.' },
            { name: 'Media', type: 'StreamingFrameProducer · VideoDecoderManager · FrameCache · mediabunny', desc: 'Background decode (WebCodecs) into a bounded cache of ImageBitmaps.' },
          ]}
        />
        <P>
          Each subsystem has a longer write-up next to its code, for example <C>packages/core/src/renderer/architecture.md</C> and{' '}
          <C>packages/core/src/export/Architecture.md</C>.
        </P>

        <DocsPager href="/docs/architecture" />
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
