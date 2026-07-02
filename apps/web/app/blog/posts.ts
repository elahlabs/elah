// Single source of truth for blog posts — consumed by the listing (`/blog`) and
// the article route (`/blog/[slug]`). Article bodies are structured as block
// arrays so the detail page can render them and derive a table of contents.

export type Block =
  | { type: 'p'; text: string }
  | { type: 'h2'; id: string; text: string }
  | { type: 'code'; language?: string; filename?: string; code: string }
  | { type: 'note'; title?: string; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'quote'; text: string }

export interface Post {
  slug: string
  date: string
  category: 'Architecture' | 'Design' | 'Implementation'
  title: string
  excerpt: string
  readingTime: string
  content: Block[]
}

export const posts: Post[] = [
  {
    slug: 'webcodecs-frame-pool-exhaustion',
    date: '2026-06-07',
    category: 'Architecture',
    title: 'Solving WebCodecs Frame Pool Exhaustion',
    excerpt:
      "When the hardware output pool fills up, WebCodecs VideoDecoder stalls silently. Here's how we found it, why the copy-and-close pattern fixes it, and what to watch for in your own decode pipeline.",
    readingTime: '8 min read',
    content: [
      {
        type: 'p',
        text: 'Playback would run for a fraction of a second — about 18 frames — and then freeze. No error, no exception, no rejected promise. The decoder simply went silent and our `flush()` waited forever for an output that never came. This is the story of a bug that hides in the lifetime semantics of a single object: the WebCodecs `VideoFrame`.',
      },
      {
        type: 'h2',
        id: 'a-videoframe-is-borrowed',
        text: 'A VideoFrame is a borrowed library book, not a photo',
      },
      {
        type: 'p',
        text: 'The hardware video decoder is a tiny library with a fixed shelf of roughly 16 books — its internal frame pool. Each time it decodes a picture it hands you one book: a `VideoFrame`. Crucially, a `VideoFrame` is not a copy of the pixels. It is a borrowed handle to one shelf slot inside the decoder.',
      },
      {
        type: 'p',
        text: "The library's rule is strict: you may read the book (upload it to the GPU), but you must return it by calling `frame.close()` so the slot frees up. If you keep books, the shelf empties. And with an empty shelf the librarian — the decoder — cannot make new books. It does not crash. It just stops.",
      },
      {
        type: 'code',
        language: 'text',
        code: `Decoder's shelf (~16 slots):
[B][B][B][B][B][B][B][B][B][B][B][B][B][B][ ][ ]
 every B = one VideoFrame you are still holding open
 keep ~16 open  ->  shelf full  ->  decoder can't decode  ->  FREEZE`,
      },
      {
        type: 'h2',
        id: 'the-bug',
        text: 'The bug: a cache that never gave the books back',
      },
      {
        type: 'p',
        text: 'Our `FrameCache` stored the raw `VideoFrame` and only closed it much later, on eviction. That sounds fine until you look at the numbers: the cache was sized at 30 entries, but a short clip only ever decodes around 14 frames. Eviction never fired. No frame was ever closed. The shelf filled to ~16, the decoder went silent, and the next `flush()` hung waiting for a slot that would never come back.',
      },
      {
        type: 'p',
        text: 'The breaking line was `cache.put(frame)` — the cache held the book itself. Everything downstream was correct; the ownership model was the defect.',
      },
      {
        type: 'h2',
        id: 'copy-and-close',
        text: 'The fix: photocopy the book, return the original immediately',
      },
      {
        type: 'p',
        text: '`createImageBitmap(frame)` makes a photocopy on plain paper. The `ImageBitmap` is yours forever and costs the decoder nothing — it holds no pool slot. So the instant a frame arrives we copy it, hand the book straight back with `frame.close()`, and then cache the photocopy.',
      },
      {
        type: 'code',
        language: 'ts',
        filename: 'StreamingFrameProducer.ts',
        code: `// onFrame fires from VideoDecoder.output for every decoded frame
private async _copyAndCache(frame: VideoFrame, index: number) {
  // 1. Photocopy: an ImageBitmap holds no decoder pool slot
  const bitmap = await createImageBitmap(frame)
  // 2. Return the book NOW — the slot is free again immediately
  frame.close()
  // 3. Cache the copy; the cache is its sole owner
  this.cache.put(index, bitmap)
}`,
      },
      {
        type: 'p',
        text: 'The result: the shelf is almost always empty, the decoder never starves, and playback is smooth. Both `VideoFrame` and `ImageBitmap` are valid `TexImageSource`, so the copy uploads to the GPU exactly like the original would have.',
      },
      {
        type: 'h2',
        id: 'single-owner',
        text: 'The knock-on simplification: one owner, one closer',
      },
      {
        type: 'p',
        text: "Before the fix, `VideoLayer.draw` called `frame.clone()` before uploading, because two owners both believed they had to close the frame: the cache and the texture upload's `finally` block. Cloning was a smell that said nobody had agreed who owns this. Once the cache held a photocopy that only it owned, the clone disappeared and upload became a pure borrow. The whole pipeline collapsed to one sentence:",
      },
      {
        type: 'quote',
        text: 'The FrameCache owns every cached frame and is the only thing that closes it. Everyone else borrows and never closes.',
      },
      {
        type: 'note',
        title: 'A second benefit: context-loss safety',
        text: 'Because the cache holds plain-memory copies rather than GPU objects, it survives a WebGL context loss (driver reset, tab backgrounded, alt-tab). When the GPU comes back, the next render re-uploads from the surviving cache — no re-decode, no stutter. A photocopy is just as re-uploadable as the original book.',
      },
      {
        type: 'p',
        text: 'The lesson generalizes beyond video: any time you cache a borrowed, pool-backed resource, decide who owns it and who closes it before you store it. The instant two code paths both think they own it, you have either a leak or a freeze — you just have not hit it yet.',
      },
    ],
  },
  {
    slug: 'renderer-agnostic-core',
    date: '2026-06-04',
    category: 'Architecture',
    title: 'Why the Core Has No Renderer Imports',
    excerpt:
      "A renderer-agnostic core means resolveTimeline() runs identically in the browser, in a worker, and in tests. Here's the interface boundary we drew and how it keeps preview and export in sync.",
    readingTime: '6 min read',
    content: [
      {
        type: 'p',
        text: 'The single most important rule in the engine is also the most boring to state: a renderer takes a `Scene` and produces pixels, and it knows nothing else. It does not ask the engine what time it is. It does not look up clips by id. It does not know what a `Project` is. Everything a renderer needs is in the `Scene` it receives.',
      },
      {
        type: 'p',
        text: 'That constraint sounds like an inconvenience. It is actually the thing that makes the whole system testable, exportable, and future-proof.',
      },
      {
        type: 'h2',
        id: 'the-interface',
        text: 'Four methods, nothing else',
      },
      {
        type: 'code',
        language: 'ts',
        filename: 'core/renderer/types.ts',
        code: `interface Renderer {
  mount(container: HTMLElement): void
  resize(cssWidth: number, cssHeight: number, dpr?: number): void
  render(scene: Scene): void
  dispose(): void
}`,
      },
      {
        type: 'p',
        text: '`render(scene)` is synchronous and idempotent on equal references — if `scene === lastScene`, it is a no-op. The renderer reads only the `Scene`; it never imports `Project`, `Clip`, the engines, the stores, or React. Any async decode or upload work happens out-of-band on subsequent ticks, never inside the render call.',
      },
      {
        type: 'h2',
        id: 'the-pure-function',
        text: 'The pure function in the middle',
      },
      {
        type: 'p',
        text: 'The bridge between mutable editor state and a dumb renderer is one pure function:',
      },
      {
        type: 'code',
        language: 'ts',
        code: `function resolveTimeline(frame: number, project: Project): Scene`,
      },
      {
        type: 'p',
        text: 'Given the same `(frame, project)`, it always produces a structurally-equal `Scene`. No DOM access, no React, no Zustand, no side effects. It decides what is visible and audible at a given frame and returns plain data: `videos`, `audios`, `texts`, `images`, and `transitions`. Callers do the side effects; the resolver only computes.',
      },
      {
        type: 'note',
        title: 'Why purity pays off',
        text: 'Because resolveTimeline is pure, it is unit-testable without a DOM, safe to run inside a Web Worker, and memoizable by (frame, project) reference equality. It runs 60 times per second — bugs there are invisible without tests, so the test suite is the spec.',
      },
      {
        type: 'h2',
        id: 'preview-and-export',
        text: 'How this keeps preview and export in sync',
      },
      {
        type: 'p',
        text: 'Export is not a `Renderer`. The export worker draws to a 2D `OffscreenCanvas` rather than instantiating the WebGL renderer. So what stops preview and export from drifting apart? They consume the same `resolveTimeline` output and reuse the same pure placement helpers — `resolveDrawRect`, `computeTextLayout`. It is the shared resolution, not a shared draw call, that guarantees identical geometry.',
      },
      {
        type: 'p',
        text: 'This is the payoff of the boundary. The live preview runs WebGL2 on the main thread; export runs Canvas2D in a worker with no GPU context at all. Two completely different draw paths, one source of truth for what to draw and where. They cannot drift because the math that decides geometry lives in one place that both import.',
      },
      {
        type: 'h2',
        id: 'future-renderers',
        text: 'What this buys for the future',
      },
      {
        type: 'p',
        text: 'A WebGPU backend — for shader effects and richer transitions — would implement the same four-method `Renderer` interface and consume the same `Scene`. No change to the engine, the resolver, or the React layer. The same is true for a hypothetical DOM or server-side renderer. The contract is the `Scene`, and the `Scene` is small.',
      },
      {
        type: 'quote',
        text: 'The renderer that knows about the project is the renderer you cannot test, cannot move to a worker, and cannot replace. Draw the line at the Scene and never cross it.',
      },
    ],
  },
  {
    slug: 'integer-frames',
    date: '2026-05-28',
    category: 'Design',
    title: 'Frames as the Primitive Unit of Time',
    excerpt:
      'Every NLE that uses floating-point seconds eventually ships a subtle drift bug. Using integer frames eliminates an entire class of problems at the cost of one invariant every developer needs to know.',
    readingTime: '5 min read',
    content: [
      {
        type: 'p',
        text: 'Here is a bug that has shipped in more video editors than anyone wants to admit: two clips that should be perfectly flush end up 0.0000003 seconds apart. At the join frame, the renderer has to pick which clip wins, and it picks arbitrarily. Sometimes you get a one-frame flash of the wrong clip. Sometimes a gap. It is intermittent, it is data-dependent, and it is miserable to reproduce.',
      },
      {
        type: 'p',
        text: 'The root cause is always the same: time was stored as floating-point seconds, and floating-point addition is not associative. Split a clip, move it, trim it, and the rounding errors compound until flush is no longer flush.',
      },
      {
        type: 'h2',
        id: 'the-decision',
        text: 'The decision: integer frames everywhere',
      },
      {
        type: 'p',
        text: 'In this engine, `currentFrame` is an integer, and so is everything that describes time. Clips carry `startFrame`, `durationFrames`, `sourceStartFrame`, and `sourceDurationFrames` — all integers. Seconds exist at exactly one place: the rendering boundary, when we set `videoEl.currentTime = sourceFrame / fps`. Nowhere else.',
      },
      {
        type: 'code',
        language: 'ts',
        code: `// Bad — floating seconds compound rounding on every edit
clip.start = 1.5
clip.duration = 3.2
currentTime = 4.7

// Good — integer frames are exact, forever
clip.startFrame = 45
clip.durationFrames = 96
currentFrame = 141`,
      },
      {
        type: 'p',
        text: 'Integer math is exact. Adjacent clips are flush when `clipA.startFrame + clipA.durationFrames === clipB.startFrame`, and that equality never decays no matter how many times you split, slip, or move.',
      },
      {
        type: 'h2',
        id: 'the-half-open-interval',
        text: 'The one invariant: the half-open interval',
      },
      {
        type: 'p',
        text: 'Integers remove rounding, but you still need one rule to decide which clip is active at a seam. A clip is active if and only if `startFrame <= frame < startFrame + durationFrames`. The interval is half-open: the start frame is included, the end frame is not.',
      },
      {
        type: 'p',
        text: 'This is the single most important thing to internalize. It means adjacent clips never both fire on the same frame — clip A ends exactly where clip B begins, and frame B-start belongs unambiguously to B. Source mapping then becomes pure arithmetic:',
      },
      {
        type: 'code',
        language: 'ts',
        code: `// The only place trim semantics live
sourceFrame = (frame - clip.startFrame) + clip.sourceStartFrame`,
      },
      {
        type: 'h2',
        id: 'two-coordinate-systems',
        text: 'Why two frame coordinate systems',
      },
      {
        type: 'p',
        text: 'There are two kinds of frames in the model, and keeping them distinct is what makes non-destructive editing possible:',
      },
      {
        type: 'list',
        items: [
          'Timeline frame — where on the timeline the clip lives (startFrame).',
          'Source frame — what part of the source media plays (sourceStartFrame).',
        ],
      },
      {
        type: 'p',
        text: 'A split is then trivially correct: create two clips with the same `src`, adjust their `startFrame` and `sourceStartFrame`, and no media is re-encoded. Trims and slips are likewise just integer adjustments to those two windows.',
      },
      {
        type: 'note',
        title: 'The clock follows the same rule',
        text: 'The PlaybackEngine integrates a float frame position internally for sub-frame seeking, but the store and UI consume Math.floor(getFrameAt()). Float lives at the boundary; integers are the contract.',
      },
      {
        type: 'p',
        text: 'The cost of all this is one invariant every contributor must know — the half-open interval. That is a cheap price for permanently deleting an entire category of drift bugs.',
      },
    ],
  },
  {
    slug: 'transition-architecture',
    date: '2026-06-01',
    category: 'Implementation',
    title: 'Snapshot-Overlay Transitions: Preview and Export in Sync',
    excerpt:
      'GPU crossfade is the obvious approach. It is also the wrong one for a renderer-agnostic system. Here is the snapshot-overlay architecture that keeps CSS preview and OffscreenCanvas export using the same resolver output.',
    readingTime: '7 min read',
    content: [
      {
        type: 'p',
        text: 'When you set out to build a crossfade, the obvious move is to do it on the GPU: render both clips to textures, blend them in a shader with a time-varying alpha, done. It works beautifully — in the preview. Then you go to export, where there is no GPU context in the worker, and you have to reimplement the entire blend a second way. Now you own two crossfade implementations that must produce pixel-identical results, and they will drift.',
      },
      {
        type: 'p',
        text: 'For a renderer-agnostic system, the GPU-crossfade is the wrong primitive. The right one keeps the transition logic out of the renderer entirely.',
      },
      {
        type: 'h2',
        id: 'the-resolver-decides',
        text: 'The resolver decides opacity, not the renderer',
      },
      {
        type: 'p',
        text: 'In a fade, the resolver does the work that matters. During the overlap window it sets the outgoing clip to `opacity = 0` and the incoming clip to `opacity = 1`, and emits the transition descriptor on `Scene.transitions`. The renderer never learns the word "fade" — it just draws clips at the opacities it is handed.',
      },
      {
        type: 'code',
        language: 'ts',
        code: `interface Scene {
  frame: number
  videos: ActiveVideoClip[]
  audios: ActiveAudioClip[]
  texts: ActiveTextClip[]
  images: ActiveImageClip[]
  transitions: SceneTransition[]   // describes the fade; renderer ignores semantics
}`,
      },
      {
        type: 'h2',
        id: 'snapshot-overlay',
        text: 'The snapshot-overlay trick in preview',
      },
      {
        type: 'p',
        text: 'Here is the part that keeps preview simple: instead of blending two live clips, the preview freezes a canvas snapshot of the outgoing frame and fades that snapshot out over the top of the incoming clip using plain CSS opacity. One frozen image, one CSS transition. No second live decode, no shader blend, no per-frame compositing math on the hot path.',
      },
      {
        type: 'p',
        text: 'A `TransitionOverlay` component owns the snapshot and its CSS fade. The underlying renderer just keeps drawing the incoming clip at full opacity. The crossfade you see is the snapshot dissolving away on top.',
      },
      {
        type: 'h2',
        id: 'export-mirrors',
        text: 'Export mirrors it with one line of canvas math',
      },
      {
        type: 'p',
        text: 'Export cannot use CSS, but it does not need the snapshot trick either — it has every frame available deterministically. It mirrors the same fade by drawing the outgoing content with a time-varying global alpha:',
      },
      {
        type: 'code',
        language: 'ts',
        code: `// Export worker, per transition frame at progress t in [0, 1]
ctx.globalAlpha = 1 - t
drawOutgoing(ctx, scene)
ctx.globalAlpha = 1
drawIncoming(ctx, scene)`,
      },
      {
        type: 'p',
        text: 'Both paths are driven by the same resolver output — the same opacities, the same transition descriptor, the same timing. Preview fades a frozen snapshot with CSS; export composites with `globalAlpha`. Two mechanisms, one source of truth, no drift.',
      },
      {
        type: 'note',
        title: 'Status',
        text: 'The snapshot-overlay architecture is in place and fade is fully implemented in both preview and export. Slide and wipe transitions reuse the same Scene.transitions plumbing; only fade is shipped so far.',
      },
      {
        type: 'h2',
        id: 'the-principle',
        text: 'The principle underneath',
      },
      {
        type: 'p',
        text: 'The reason this works is the same reason the whole engine works: the renderer stays dumb. The moment a transition becomes "a thing the renderer knows how to do," you have coupled visual effects to a specific draw backend, and every new backend owes you a reimplementation. Keep the semantics in the resolver, hand the renderer plain opacities, and let each output path realize the fade with whatever primitive it has — CSS here, `globalAlpha` there.',
      },
      {
        type: 'quote',
        text: 'A transition is not something a renderer does. It is something the resolver describes and every renderer happens to obey.',
      },
    ],
  },
  {
    slug: 'webgl2-gpu-renderer',
    date: '2026-05-20',
    category: 'Implementation',
    title: 'Building a WebGL2 Renderer for an NLE',
    excerpt:
      'Textured quads, zIndex sorting, context-loss recovery, and the 2D-canvas-to-texture pipeline for text. A walkthrough of the GpuRenderer architecture.',
    readingTime: '10 min read',
    content: [
      {
        type: 'p',
        text: 'The GpuRenderer has exactly one job: turn a `Scene` into a sorted list of textured-quad draw calls, using GPU memory that is pooled and async work that never blocks the render path. Everything under the `gpu/` folder collaborates around that single idea. This is a walkthrough of how the pieces fit.',
      },
      {
        type: 'h2',
        id: 'everything-is-a-quad',
        text: 'Everything is a textured quad',
      },
      {
        type: 'p',
        text: 'There is no per-element shader zoo. Video frames, static images, and text all become the same primitive: a textured quad drawn with one shared quad shader. Three layers feed it — `VideoLayer` pulls frames from the decode pipeline, `ImageLayer` loads static bitmaps, and `TextLayer` rasterizes glyphs to a 2D canvas and uploads that as a texture. Once a layer has a texture, the draw path is identical for all three.',
      },
      {
        type: 'p',
        text: 'Placement math — object-fit contain, per-clip transforms, text layout — lives in pure helpers (`drawRect.ts`, `objectFit.ts`, `textLayout.ts`) that the export path reuses verbatim. The renderer does not invent geometry; it consumes it.',
      },
      {
        type: 'h2',
        id: 'rendergraph',
        text: 'RenderGraph: diff, acquire, release, sort',
      },
      {
        type: 'p',
        text: 'On each tick, the `RenderGraph` diffs the active clips in the new `Scene` against the previous one. Clips that left are released (their textures returned to the pool); clips that entered are acquired (a fresh texture allocated). Then it builds one global draw list and sorts it by `zIndex` ascending, so the last element drawn lands on top.',
      },
      {
        type: 'code',
        language: 'ts',
        code: `// zIndex comes from the resolver, derived from track order:
// zIndex = (maxOrder - track.order) * 1000
// track.order 0 (topmost in UI) -> highest zIndex -> front-most on screen.
// The * 1000 reserves room for sub-layer offsets (e.g. text +100 later).
drawList.sort((a, b) => a.zIndex - b.zIndex)`,
      },
      {
        type: 'h2',
        id: 'the-render-tick',
        text: 'The render tick is strictly synchronous',
      },
      {
        type: 'p',
        text: 'Called once per RAF tick, `render(scene)` runs top to bottom with no awaits. If `scene === lastScene` or the context is lost, it is a no-op. Otherwise it clears, asks the RenderGraph to execute, and for each draw entry the layer pulls its current frame and uploads it:',
      },
      {
        type: 'code',
        language: 'ts',
        code: `// VideoLayer.draw, per clip, inside the synchronous tick
provider.setPlayhead(sourceFrame)        // fire-and-forget; drives decode out-of-band
const frame = provider.getCurrent(sourceFrame)  // synchronous cache read
if (frame) {
  videoTexture.upload(gl, frame)         // borrow; never closes the frame
} else {
  // cache miss: keep the last texture content -> no flicker
}`,
      },
      {
        type: 'p',
        text: 'Two invariants this enforces: `render()` never awaits, and `render()` never throws on a missed frame — on a cache miss it simply draws the last upload, so a decoder that is still warming up produces a held frame rather than a black flash.',
      },
      {
        type: 'h2',
        id: 'out-of-band-decode',
        text: 'Decode happens out-of-band, push-based',
      },
      {
        type: 'p',
        text: 'The frame provider is the boundary between the synchronous render thread and the asynchronous decode work. The contract is push-based: `VideoLayer` calls `setPlayhead(N)` before `getCurrent(N)` on every tick, and the provider drives decoding internally. The render path never schedules individual frame requests.',
      },
      {
        type: 'p',
        text: 'A contiguous advance (|delta| <= 1) feeds only the new tail to the decoder, which stays warm — there is no per-frame `flush()`. A discontinuity (a seek, |delta| > 1, or the first call) triggers a `reset()` to the nearest keyframe and re-feeds the window. The decoder is reset only when the playhead actually jumps.',
      },
      {
        type: 'note',
        title: 'Frame ownership, one rule',
        text: 'The FrameCache is the single owner and only closer of every cached frame. On the real decode path the cache holds ImageBitmap copies; the decoded VideoFrame is closed in onFrame the instant the copy exists. VideoTexture.upload borrows and never closes. Violate this and you either leak GPU memory or freeze playback.',
      },
      {
        type: 'h2',
        id: 'the-gl-free-line',
        text: 'The GL-free line and context-loss recovery',
      },
      {
        type: 'p',
        text: 'A WebGL context can be lost at any moment — driver reset, laptop sleep, a tab backgrounded too long. When it happens, every GPU object is instantly dead: textures, shaders, the pool. Plain JavaScript memory is untouched. So the system draws a hard line: everything above it (VideoTexture, ShaderProgram, TexturePool) is rebuildable; everything below it (StreamingFrameProducer, VideoDecoderManager, demuxer, FrameCache) holds no GL and keeps running.',
      },
      {
        type: 'code',
        language: 'text',
        code: `GPU ZONE  — wiped on context loss
  VideoTexture · ShaderProgram · TexturePool      -> rebuilt on restore
=================== GL-free line ===================
SAFE MEMORY ZONE — survives a GPU reset
  StreamingFrameProducer · VideoDecoderManager
  Demuxer · FrameCache (ImageBitmap)              -> keeps running`,
      },
      {
        type: 'p',
        text: 'On `webglcontextlost` the renderer nulls its GL handles, releases all active items, and sets `lastScene = null`. On `webglcontextrestored` it re-acquires the context and re-runs GL state init. The next `render()` treats every clip as entering, rebuilds the shader program and VAO, and re-uploads from the surviving frame cache — no re-decode, no stutter. This is the second reason the copy-and-close fix matters: an ImageBitmap is just as re-uploadable to a brand-new context as the original VideoFrame.',
      },
      {
        type: 'h2',
        id: 'construction-order',
        text: 'Construction and disposal order is load-bearing',
      },
      {
        type: 'p',
        text: 'Dispose runs in reverse of construction for a reason: tearing down the texture pool before the render graph would leak acquired textures. So mount builds context, then pool, then layers, then graph; dispose releases the graph first (returning textures to the pool free-list), then deletes every pooled texture, then loses the context. Order is not stylistic here — it is correctness.',
      },
      {
        type: 'quote',
        text: 'A good renderer is mostly bookkeeping: who owns this texture, is this frame still borrowed, did the context just die. Get the ownership rules right and the pixels take care of themselves.',
      },
    ],
  },
  {
    slug: 'immer-timeline-engine',
    date: '2026-05-15',
    category: 'Architecture',
    title: 'One Mutation Funnel: TimelineEngine with Immer',
    excerpt:
      'All edits go through one commit path. Structural sharing, batching, typed events, and a redo stack that does not bloat memory — how the TimelineEngine is designed.',
    readingTime: '6 min read',
    content: [
      {
        type: 'p',
        text: 'The fastest way to make an editor unmaintainable is to scatter its mutations. Project data in one store, history in a class, the current frame in a hook, and a dozen components all writing wherever is convenient. Three sources of truth, one nominal truth, and infinite bugs. The `TimelineEngine` exists to make that impossible.',
      },
      {
        type: 'h2',
        id: 'one-funnel',
        text: 'Every change goes through commit()',
      },
      {
        type: 'p',
        text: 'There is exactly one place project state changes: `TimelineEngine.commit()`. Visitors — `add`, `remove`, `update`, `split`, `clone` — apply Immer drafts. `commit` records history, fires events, and swaps the project reference. There are no side-channel writes. A component cannot reach in and mutate a clip; it calls an engine method, and that method funnels through commit like everything else.',
      },
      {
        type: 'code',
        language: 'ts',
        code: `// A visitor describes the change as an Immer draft mutation...
engine.addClip({ trackId, type: 'video', startFrame: 0, durationFrames: 90 })

// ...and commit() does the rest, atomically:
//   1. produce() the next immutable project (structural sharing)
//   2. push a history entry
//   3. emit('change', project) and emit('history:change')`,
      },
      {
        type: 'h2',
        id: 'immer-structural-sharing',
        text: 'Why Immer: structural sharing for free',
      },
      {
        type: 'p',
        text: 'Immer lets visitors write code that looks like mutation — `draft.clips[trackId].push(clip)` — while producing a new immutable project under the hood. Unchanged subtrees are shared by reference between versions. That matters for two reasons: history snapshots are cheap (they share everything that did not change), and React consumers can use reference equality to skip re-renders for the parts of the tree that did not move.',
      },
      {
        type: 'note',
        title: 'The redo stack stays small',
        text: 'Because each commit produces a structurally-shared snapshot rather than a deep copy, the history and redo stacks do not bloat memory — two adjacent versions differ only by the nodes that actually changed.',
      },
      {
        type: 'h2',
        id: 'three-rings',
        text: 'The three-ring state model',
      },
      {
        type: 'p',
        text: 'The engine is Ring 0 — the immutable source of truth, owned by classes. Ring 1 is the reactive mirror: Zustand stores (`useTracksStore`, `usePlaybackStore`, `useMediaLibraryStore`) that sync from Ring 0 when the engine emits. Ring 2 is throwaway UI state — selection, drag handles, panel toggles. The rule is one-directional: outer rings read inner rings, never the reverse.',
      },
      {
        type: 'list',
        items: [
          'Ring 0 owns history, batching, and events. Replays are deterministic.',
          'Ring 1 is the React boundary. Components subscribe with granular selectors; one engine event triggers one sync().',
          'Ring 2 is transient. Selection and drag state never pollute the project history.',
        ],
      },
      {
        type: 'p',
        text: 'The forbidden patterns fall straight out of this: components must not write to Ring 0, Ring 0 must not read Ring 1 or Ring 2, and engine state must never live in `useState` or `useRef` instead of the engine.',
      },
      {
        type: 'h2',
        id: 'batching',
        text: 'Batching: many edits, one undo',
      },
      {
        type: 'p',
        text: 'Some user actions are logically one change but mechanically several mutations — dropping a video that has audio adds both a video clip and an audio clip. Those should undo together. `engine.batch()` wraps multiple mutations into a single commit and a single history entry:',
      },
      {
        type: 'code',
        language: 'ts',
        code: `engine.batch(() => {
  engine.addClip({ trackId, type: 'video', ...videoOpts })
  engine.addClip({ trackId: audioTrackId, type: 'audio', ...audioOpts })
}, 'Add video + audio')   // one undo entry`,
      },
      {
        type: 'h2',
        id: 'invariants',
        text: 'Invariants live inside the engine',
      },
      {
        type: 'p',
        text: 'Because every mutation funnels through one place, the engine is also the one place to enforce the data-model invariants: clips within a track are always sorted by `startFrame` and never overlap; `startFrame >= 0` and `durationFrames >= 1`; for media clips the trim window stays within the source. `moveClip` and `trimClip` enforce these as part of their commit. There is no other code path that could violate them, because there is no other code path at all.',
      },
      {
        type: 'quote',
        text: 'A single source of truth is not a diagram you draw. It is a mutation funnel you enforce — one commit(), no back doors.',
      },
    ],
  },
]

export function getPost(slug: string): Post | undefined {
  return posts.find((p) => p.slug === slug)
}

// Theme-aware category badge styles: flat filled chips (no border — tinted
// borders rendered as a muddy outline). Using the secondary/tertiary tokens
// (which flip per theme) keeps all three consistent in light and dark mode.
export const categoryColors: Record<Post['category'], string> = {
  Architecture: 'text-secondary bg-secondary/10',
  Design: 'text-tertiary bg-tertiary/10',
  Implementation: 'text-on-surface-variant bg-surface-high',
}
