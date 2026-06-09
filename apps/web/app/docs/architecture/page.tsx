import type { Metadata } from 'next'
import { DocsToc } from '@/components/docs/DocsToc'

export const metadata: Metadata = { title: 'Architecture' }

const toc = [
  { id: 'overview', title: 'System Overview', level: 2 },
  { id: 'core-to-ui', title: 'Core → UI Communication', level: 2 },
  { id: 'playback', title: 'Playback Pipeline', level: 2 },
]

export default function ArchitecturePage() {
  return (
    <div className="flex gap-12">
      <article className="min-w-0 flex-1 max-w-3xl">
        <div className="mb-8 pb-6 border-b border-outline-variant">
          <div className="label-mono mb-2 text-2xs text-on-surface-variant opacity-60">Architecture</div>
          <h1 className="text-3xl font-semibold tracking-tight text-on-surface" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Architecture
          </h1>
          <p className="mt-3 text-base leading-relaxed text-on-surface-variant">
            How the engine, stores, renderer, and media pipeline fit together. Three diagrams: system overview, core↔UI data flow, and the playback loop.
          </p>
        </div>

        {/* ── System Overview ── */}
        <section className="mb-12">
          <h2 id="overview" className="mb-1 text-xl font-semibold tracking-tight text-on-surface scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            System Overview
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
              <div key={layer.label} className={`border-b border-outline-variant last:border-0 ${i % 2 === 0 ? 'bg-white' : 'bg-surface-lowest'}`}>
                <div className="flex gap-0 sm:gap-4">
                  {/* Layer label column */}
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

                  {/* Content */}
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
                            <span className="text-2xs text-on-surface-variant opacity-60">{item.note}</span>
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

        {/* ── Core → UI Communication ── */}
        <section className="mb-12">
          <h2 id="core-to-ui" className="mb-1 text-xl font-semibold tracking-tight text-on-surface scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Core → UI Communication
          </h2>
          <p className="mb-5 text-sm leading-relaxed text-on-surface-variant">
            The engine is framework-agnostic — it emits typed events and never imports React or Zustand. Zustand stores are wired up once inside <code className="rounded bg-surface-container px-1.5 py-0.5 font-mono">EditorProvider</code> by subscribing to engine events. From there React's normal reactivity takes over.
          </p>

          {/* Mutation flow */}
          <div className="mb-6">
            <div className="label-mono mb-3 text-2xs text-on-surface-variant opacity-60">Mutation flow — e.g. engine.addClip()</div>
            <div className="flex flex-col gap-0 overflow-hidden rounded-md border border-outline-variant">
              {[
                {
                  step: '1',
                  who: 'React component',
                  what: 'User drags a clip or clicks a button',
                  detail: 'onClick, onDrop, keyboard handler',
                  color: '#b7102a',
                },
                {
                  step: '2',
                  who: 'TimelineEngine',
                  what: 'engine.addClip() / updateClip() / undo() / …',
                  detail: 'Any public engine method',
                  color: '#006860',
                },
                {
                  step: '3',
                  who: 'TimelineEngine.commit()',
                  what: 'Immer draft applied → new Project snapshot',
                  detail: 'Structural sharing — only changed nodes allocate',
                  color: '#006860',
                },
                {
                  step: '4',
                  who: 'TimelineEngine',
                  what: "Emits 'change' event with new Project",
                  detail: "engine.on('change', (project) => { … })",
                  color: '#006860',
                },
                {
                  step: '5',
                  who: 'Zustand stores',
                  what: 'useTracksStore, useTransitionsStore update',
                  detail: "Listeners wired once in EditorProvider's useEffect",
                  color: '#485f84',
                },
                {
                  step: '6',
                  who: 'React',
                  what: 'Only components subscribed to changed slices re-render',
                  detail: 'Zustand selector equality check prevents unnecessary renders',
                  color: '#b7102a',
                },
              ].map((row, i) => (
                <div
                  key={row.step}
                  className={`relative flex gap-4 border-b border-outline-variant p-3 last:border-0 ${i % 2 === 0 ? 'bg-white' : 'bg-surface-lowest'}`}
                >
                  <div
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-2xs font-bold text-white"
                    style={{ backgroundColor: row.color }}
                  >
                    {row.step}
                  </div>
                  <div className="flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="label-mono text-2xs font-semibold" style={{ color: row.color }}>{row.who}</span>
                      <span className="text-xs text-on-surface">{row.what}</span>
                    </div>
                    <div className="mt-0.5 font-mono text-2xs text-on-surface-variant opacity-70">{row.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Playback store update */}
          <div>
            <div className="label-mono mb-3 text-2xs text-on-surface-variant opacity-60">Playback store update — separate path via PlaybackEngine</div>
            <div className="flex flex-col gap-0 overflow-hidden rounded-md border border-outline-variant">
              {[
                {
                  step: '1',
                  who: 'React component',
                  what: 'Calls engine.play() / pause() / seek(frame)',
                  detail: 'toolbar button, keyboard Space key, timeline scrub',
                  color: '#b7102a',
                },
                {
                  step: '2',
                  who: 'PlaybackEngine',
                  what: 'Stores anchor frame + anchor time, starts RAF loop',
                  detail: 'requestAnimationFrame(() => tick())',
                  color: '#006860',
                },
                {
                  step: '3',
                  who: 'PlaybackEngine tick',
                  what: 'Notifies listeners on integer frame advance',
                  detail: 'listeners.forEach(cb) — only fires when frame number changes',
                  color: '#006860',
                },
                {
                  step: '4',
                  who: 'Timeline.tsx subscriber',
                  what: 'usePlaybackStore.setState({ currentFrame, isPlaying })',
                  detail: 'Wired once in Timeline component mount',
                  color: '#485f84',
                },
                {
                  step: '5',
                  who: 'Preview component',
                  what: 'usePlaybackStore(s => s.currentFrame) triggers re-render',
                  detail: 'Calls resolveTimeline(frame, project) → Scene → GpuRenderer.drawScene()',
                  color: '#b7102a',
                },
              ].map((row, i) => (
                <div
                  key={row.step}
                  className={`relative flex gap-4 border-b border-outline-variant p-3 last:border-0 ${i % 2 === 0 ? 'bg-white' : 'bg-surface-lowest'}`}
                >
                  <div
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-2xs font-bold text-white"
                    style={{ backgroundColor: row.color }}
                  >
                    {row.step}
                  </div>
                  <div className="flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="label-mono text-2xs font-semibold" style={{ color: row.color }}>{row.who}</span>
                      <span className="text-xs text-on-surface">{row.what}</span>
                    </div>
                    <div className="mt-0.5 font-mono text-2xs text-on-surface-variant opacity-70">{row.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 rounded-md border border-outline-variant bg-surface-low p-4">
            <p className="text-xs leading-relaxed text-on-surface-variant">
              <strong className="text-on-surface font-medium">Why two paths?</strong> Project mutations (clips, tracks, transitions) are infrequent and go through <code className="rounded bg-surface-container px-1.5 py-0.5 font-mono">TimelineEngine</code>. Frame ticks happen 30–60× per second — <code className="rounded bg-surface-container px-1.5 py-0.5 font-mono">PlaybackEngine</code> keeps that hot path completely separate so timeline mutations never block the RAF loop and vice versa.
            </p>
          </div>
        </section>

        {/* ── Playback Pipeline ── */}
        <section className="mb-12">
          <h2 id="playback" className="mb-1 text-xl font-semibold tracking-tight text-on-surface scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Playback Pipeline
          </h2>
          <p className="mb-5 text-sm leading-relaxed text-on-surface-variant">
            What happens between <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">play()</code> and a composited frame appearing on screen. Each RAF tick runs the full path in under 1 ms on the main thread; the heavy decode work is async and pre-buffered.
          </p>

          {/* RAF clock */}
          <div className="mb-6">
            <div className="label-mono mb-3 text-2xs text-on-surface-variant opacity-60">A — Clock integration (main thread, every RAF tick)</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {[
                {
                  title: 'Anchor-integrate',
                  body: 'currentFrame = anchorFrame + (now − anchorTime) × fps × rate',
                  note: 'performance.now() is the single time source. Floored to integer.',
                  color: '#006860',
                },
                {
                  title: 'Frame-change gate',
                  body: 'Only notifies listeners when the integer frame differs from last tick',
                  note: 'Prevents redundant resolveTimeline + draw calls at high frame rates.',
                  color: '#006860',
                },
                {
                  title: 'Visibility handling',
                  body: 'document.hidden → freeze anchor frame; visible → re-anchor time',
                  note: 'Prevents "time warp" catch-up when the tab is backgrounded.',
                  color: '#006860',
                },
              ].map((card) => (
                <div
                  key={card.title}
                  className="rounded-md border p-3"
                  style={{ borderColor: card.color + '30', backgroundColor: card.color + '06' }}
                >
                  <div className="mb-1 text-xs font-semibold text-on-surface">{card.title}</div>
                  <div className="mb-1 font-mono text-2xs leading-relaxed text-on-surface">{card.body}</div>
                  <div className="text-2xs leading-relaxed text-on-surface-variant opacity-70">{card.note}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Scene resolution + draw */}
          <div className="mb-6">
            <div className="label-mono mb-3 text-2xs text-on-surface-variant opacity-60">B — Scene resolution + GPU draw (triggered by frame tick)</div>
            <div className="flex flex-col gap-0 overflow-hidden rounded-md border border-outline-variant">
              {[
                {
                  node: 'resolveTimeline(frame, project)',
                  type: 'Pure function',
                  desc: 'Returns a Scene: an ordered list of layers active at this frame. Clips outside [startFrame, startFrame+duration) are excluded. Transition overlap frames get opacity weights.',
                  color: '#6b21a8',
                },
                {
                  node: 'RenderGraph.build(scene)',
                  type: 'GpuRenderer',
                  desc: 'Sorts layers by z-index, allocates or reuses TexturePool slots per clip ID. One WebGL draw call per layer.',
                  color: '#b45309',
                },
                {
                  node: 'VideoLayer',
                  type: 'Per video/image clip',
                  desc: 'Calls StreamingFrameProducer.getFrameSync(frame). If FrameCache has the ImageBitmap → upload to GPU texture immediately. If miss → returns last cached frame and schedules async decode.',
                  color: '#b45309',
                },
                {
                  node: 'TextLayer',
                  type: 'Per text clip',
                  desc: 'Rasterizes text to an OffscreenCanvas 2D context. Uploads the resulting ImageBitmap as a WebGL texture. Re-rasterizes only when text content or layout changes.',
                  color: '#b45309',
                },
                {
                  node: 'gl.drawArrays() × N',
                  type: 'WebGL2',
                  desc: 'Each layer draws a unit quad scaled/translated to the clip\'s resolved position. Fragment shader samples the texture and applies opacity from the Scene layer.',
                  color: '#b45309',
                },
              ].map((row, i) => (
                <div
                  key={row.node}
                  className={`flex gap-4 border-b border-outline-variant p-3 last:border-0 ${i % 2 === 0 ? 'bg-white' : 'bg-surface-lowest'}`}
                >
                  <div className="w-2 shrink-0 rounded-sm" style={{ backgroundColor: row.color + '60' }} />
                  <div className="flex-1">
                    <div className="flex flex-wrap items-baseline gap-2 mb-0.5">
                      <span className="font-mono text-xs font-medium text-on-surface">{row.node}</span>
                      <span
                        className="label-mono rounded px-1.5 py-0.5 text-2xs"
                        style={{ color: row.color, backgroundColor: row.color + '10' }}
                      >
                        {row.type}
                      </span>
                    </div>
                    <p className="text-2xs leading-relaxed text-on-surface-variant">{row.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Media pipeline async path */}
          <div>
            <div className="label-mono mb-3 text-2xs text-on-surface-variant opacity-60">C — Async media pipeline (StreamingFrameProducer, off the RAF path)</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[
                {
                  title: 'FrameCache (ring buffer)',
                  body: 'Stores decoded ImageBitmaps keyed by frame index. Evicts oldest entries when capacity is exceeded. Cache hits return synchronously to the GPU layer.',
                  color: '#0f766e',
                },
                {
                  title: 'VideoDecoderManager',
                  body: 'Manages a WebCodecs VideoDecoder per clip. Enqueues encoded chunks from the demuxer in decode order; resolves promises when the target frame is decoded.',
                  color: '#0f766e',
                },
                {
                  title: 'Look-ahead buffering',
                  body: 'StreamingFrameProducer pre-decodes several frames ahead of the current playhead so the FrameCache is warm before the RAF tick needs them.',
                  color: '#0f766e',
                },
                {
                  title: 'Seek recovery',
                  body: 'On a jump seek, the decoder flushes, re-seeks to the nearest keyframe in the demuxer, and re-primes the FrameCache. Stale frames are discarded.',
                  color: '#0f766e',
                },
              ].map((card) => (
                <div
                  key={card.title}
                  className="rounded-md border p-3"
                  style={{ borderColor: card.color + '30', backgroundColor: card.color + '06' }}
                >
                  <div className="mb-1 text-xs font-semibold text-on-surface">{card.title}</div>
                  <p className="text-2xs leading-relaxed text-on-surface-variant">{card.body}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-md border border-outline-variant bg-surface-low p-4">
              <p className="text-xs leading-relaxed text-on-surface-variant">
                <strong className="text-on-surface font-medium">Audio is parallel.</strong> <code className="rounded bg-surface-container px-1.5 py-0.5 font-mono">AudioPlaybackController</code> decodes audio tracks into <code className="rounded bg-surface-container px-1.5 py-0.5 font-mono">AudioBuffer</code>s and schedules them on a <code className="rounded bg-surface-container px-1.5 py-0.5 font-mono">WebAudio AudioContext</code>. It syncs to the same <code className="rounded bg-surface-container px-1.5 py-0.5 font-mono">PlaybackEngine</code> anchor, so audio and video advance from the same clock with no drift.
              </p>
            </div>
          </div>
        </section>
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
