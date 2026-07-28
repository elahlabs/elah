import type { Metadata } from 'next'
import { DocsToc } from '@/components/docs/DocsToc'
import { MermaidDiagram } from '@/components/docs/MermaidDiagram'

export const metadata: Metadata = {
  title: 'Architecture',
  description:
    'How elah works: the three-ring state model, the timeline engine and its one mutation funnel, the playback clock, and the rendering engine built on a pure resolver.',
  alternates: { canonical: '/docs/architecture' },
}

const toc = [
  { id: 'ring-states', title: 'Three-Ring State Model', level: 2 },
  { id: 'timeline-engine', title: 'Timeline Engine', level: 2 },
  { id: 'playback-clock', title: 'Playback Engine & Clock', level: 2 },
  { id: 'rendering-engine', title: 'Rendering Engine', level: 2 },
  { id: 'overview', title: 'Layer Reference', level: 2 },
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
    A(["play() / seek(frame)"]) --> B["Set anchorFrame + anchorTime\n= current frame + performance.now()"]
    B --> C["RAF tick"]
    C --> D["currentFrame =\nanchorFrame + (now − anchorTime) × fps × rate"]
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
      <article className="min-w-0 flex-1 max-w-3xl">
        <div className="mb-8 pb-6 border-b border-outline-variant">
          <div className="label-mono mb-2 text-2xs text-on-surface-variant opacity-90">Architecture</div>
          <h1 className="text-3xl font-semibold tracking-tight text-on-surface" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Architecture Overview
          </h1>
          <p className="mt-3 text-base leading-relaxed text-on-surface-variant">
            Four diagrams covering the state model, timeline mutations, the playback clock, and the GPU rendering pipeline.
          </p>
        </div>

        {/* ── Ring States ── */}
        <section className="mb-12">
          <h2 id="ring-states" className="mb-1 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Three-Ring State Model
          </h2>
          <p className="mb-5 text-sm leading-relaxed text-on-surface-variant">
            State lives in three concentric rings. Ring 0 is the single source of truth — a plain TypeScript class with no framework dependencies. Ring 1 mirrors it into Zustand so React can subscribe. Ring 2 holds ephemeral UI state (selection, drag) that never persists to history.
          </p>
          <MermaidDiagram chart={ringStatesDiagram} />
          <div className="mt-4 rounded-md border border-outline-variant bg-surface-low p-4">
            <p className="text-xs leading-relaxed text-on-surface-variant">
              <strong className="text-on-surface font-medium">Why keep Ring 0 framework-free?</strong> The engine runs in Node, Web Workers, or headless Chrome with no changes — <a href="/docs/cli" className="text-primary hover:underline">@elah/cli</a> ships exactly this, driving the same export pipeline server-side. Tests import it directly without mounting any React tree.
            </p>
          </div>
        </section>

        {/* ── Timeline Engine ── */}
        <section className="mb-12">
          <h2 id="timeline-engine" className="mb-1 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Timeline Engine
          </h2>
          <p className="mb-5 text-sm leading-relaxed text-on-surface-variant">
            All project mutations — adding clips, trimming, splitting, undo/redo — go through one method: <code className="rounded bg-surface-container px-1.5 py-0.5 font-mono">commit()</code>. Immer applies the draft, records a history entry, and emits a <code className="rounded bg-surface-container px-1.5 py-0.5 font-mono">&apos;change&apos;</code> event. Zustand listeners pick it up and React re-renders only the changed slices.
          </p>
          <MermaidDiagram chart={timelineEngineDiagram} />
          <div className="mt-4 rounded-md border border-outline-variant bg-surface-low p-4">
            <p className="text-xs leading-relaxed text-on-surface-variant">
              <strong className="text-on-surface font-medium">Single mutation funnel.</strong> There is no direct way to mutate the <code className="rounded bg-surface-container px-1.5 py-0.5 font-mono">Project</code> from outside the engine. Every edit automatically lands in the undo history and notifies all subscribers.
            </p>
          </div>
        </section>

        {/* ── Playback Clock ── */}
        <section className="mb-12">
          <h2 id="playback-clock" className="mb-1 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Playback Engine & Clock
          </h2>
          <p className="mb-5 text-sm leading-relaxed text-on-surface-variant">
            The clock uses an <em>anchor-and-integrate</em> model rather than a counter. On every <code className="rounded bg-surface-container px-1.5 py-0.5 font-mono">play()</code> or <code className="rounded bg-surface-container px-1.5 py-0.5 font-mono">seek()</code>, it records the current frame and wall-clock time. Each RAF tick derives the current frame from that anchor — no accumulated drift, and rate changes are instantaneous.
          </p>
          <MermaidDiagram chart={playbackClockDiagram} />
          <div className="mt-4 rounded-md border border-outline-variant bg-surface-low p-4">
            <p className="text-xs leading-relaxed text-on-surface-variant">
              <strong className="text-on-surface font-medium">Tab visibility.</strong> When the tab is hidden, the engine freezes the anchor frame so playback does not fast-forward on resume. Audio syncs to the same anchor so there is no A/V drift.
            </p>
          </div>
        </section>

        {/* ── Rendering Engine ── */}
        <section className="mb-12">
          <h2 id="rendering-engine" className="mb-1 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Rendering Engine
          </h2>
          <p className="mb-5 text-sm leading-relaxed text-on-surface-variant">
            The renderer receives a <code className="rounded bg-surface-container px-1.5 py-0.5 font-mono">Scene</code> — a plain list of active layers — and draws textured quads to a WebGL2 canvas. It knows nothing about the project, history, or React. Video frames are decoded asynchronously into a ring-buffer cache; the render call itself is synchronous and stays under 1 ms on the main thread.
          </p>
          <MermaidDiagram chart={renderingEngineDiagram} />
          <div className="mt-4 rounded-md border border-outline-variant bg-surface-low p-4">
            <p className="text-xs leading-relaxed text-on-surface-variant">
              <strong className="text-on-surface font-medium">Cache miss graceful degradation.</strong> On a seek or cold start the <code className="rounded bg-surface-container px-1.5 py-0.5 font-mono">FrameCache</code> may not have the target frame yet. The renderer shows the last cached frame while the async decoder catches up — no blank frames, no stalls.
            </p>
          </div>
        </section>

        {/* ── Layer Reference ── */}
        <section className="mb-12">
          <h2 id="overview" className="mb-1 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Layer Reference
          </h2>
          <p className="mb-5 text-sm leading-relaxed text-on-surface-variant">
            Six vertical layers. Each layer only talks to the one directly below it — the React UI never touches WebGL; the renderer never imports React.
          </p>

          <div className="overflow-hidden rounded-md border border-outline-variant text-xs">
            {[
              {
                label: 'React UI',
                color: '#b7102a',
                items: [
                  { name: 'Timeline', note: '@elah/timeline' },
                  { name: 'Preview', note: '' },
                  { name: 'AssetPanel', note: '' },
                  { name: 'Transform / Text Overlays', note: '' },
                ],
                desc: 'React components. All reads go through Zustand hooks — no direct engine calls from render.',
              },
              {
                label: 'Zustand Stores',
                color: '#485f84',
                items: [
                  { name: 'useTracksStore', note: 'tracks, clips, stage' },
                  { name: 'usePlaybackStore', note: 'currentFrame, isPlaying' },
                  { name: 'useSelectionStore', note: 'selectedClipIds' },
                  { name: 'useTransitionsStore', note: 'transitions[]' },
                ],
                desc: 'Thin reactive bridges. Populated by engine event subscribers — not owned by any component.',
              },
              {
                label: 'Engine Layer',
                color: '#006860',
                items: [
                  { name: 'TimelineEngine', note: 'Immer + history + events' },
                  { name: 'PlaybackEngine', note: 'anchor-integrate clock' },
                  { name: 'AudioPlaybackController', note: 'WebAudio scheduling' },
                ],
                desc: 'Framework-agnostic TypeScript. All mutations funnel through engine.commit(). No React imports.',
              },
              {
                label: 'Pure Resolver',
                color: '#6b21a8',
                items: [
                  { name: 'resolveTimeline(frame, project)', note: '→ Scene' },
                ],
                desc: 'A pure function. Given a frame number and the immutable Project, returns the exact Scene to render. Deterministic, side-effect-free, runnable in tests or workers.',
              },
              {
                label: 'Renderer',
                color: '#b45309',
                items: [
                  { name: 'GpuRenderer', note: 'WebGL2 — live preview' },
                  { name: 'RenderGraph', note: 'layer sort + blend' },
                  { name: 'VideoLayer / ImageLayer / TextLayer', note: '' },
                ],
                desc: 'Reads Scene, writes pixels. Knows nothing about the project, history, or React.',
              },
              {
                label: 'Media Pipeline',
                color: '#0f766e',
                items: [
                  { name: 'StreamingFrameProducer', note: 'per-clip orchestrator' },
                  { name: 'VideoDecoderManager', note: 'WebCodecs VideoDecoder' },
                  { name: 'FrameCache', note: 'ImageBitmap ring buffer' },
                  { name: 'mediabunny demuxer', note: 'MP4 / WebM container' },
                  { name: 'AudioPlaybackController', note: 'WebAudio AudioBuffer' },
                ],
                desc: 'Async decode pipeline feeding ImageBitmaps to the GPU textures and PCM chunks to WebAudio.',
              },
            ].map((layer, i) => (
              <div key={layer.label} className={`border-b border-outline-variant last:border-0 ${i % 2 === 0 ? 'bg-surface-lowest dark:bg-surface-container' : 'bg-surface-low dark:bg-surface-high'}`}>
                <div className="flex gap-0 sm:gap-4">
                  <div
                    className="flex w-8 shrink-0 items-stretch sm:w-28"
                    style={{ borderRight: `2px solid ${layer.color}22` }}
                  >
                    <div
                      className="flex w-1 shrink-0 sm:w-1.5"
                      style={{ backgroundColor: layer.color }}
                    />
                    <div className="hidden sm:flex items-center px-3 py-3">
                      <span
                        className="label-mono text-2xs font-semibold"
                        style={{ color: layer.color, writingMode: 'horizontal-tb' }}
                      >
                        {layer.label}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-1 flex-col gap-2 px-3 py-3 sm:flex-row sm:items-start sm:gap-6">
                    <div className="flex flex-1 flex-wrap gap-1">
                      {layer.items.map((item) => (
                        <div
                          key={item.name}
                          className="flex items-baseline gap-1 rounded border px-2 py-0.5"
                          style={{ borderColor: layer.color + '30', backgroundColor: layer.color + '08' }}
                        >
                          <span className="font-mono text-xs text-on-surface">{item.name}</span>
                          {item.note && (
                            <span className="text-2xs text-on-surface-variant opacity-90">{item.note}</span>
                          )}
                        </div>
                      ))}
                    </div>
                    <p className="w-full text-2xs leading-relaxed text-on-surface-variant sm:w-48 sm:shrink-0">
                      {layer.desc}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
