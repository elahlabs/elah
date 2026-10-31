import type { Metadata } from 'next'
import { DocsToc } from '@/components/docs/DocsToc'
import { Code } from '@/components/docs/Code'
import { C, Callout, DocsPager, H2, H3, P, PropTable } from '@/components/docs/DocsKit'
import { PageHeader } from '@/components/site/PageHeader'

export const metadata: Metadata = {
  title: 'Plugins & Custom Renderers',
  description:
    'Extend elah with a custom renderer or a custom demuxer — the supported extension points of the engine — and what is not public yet.',
  alternates: { canonical: '/docs/plugins' },
}

const toc = [
  { id: 'overview', title: 'What you can replace', level: 2 },
  { id: 'custom-renderers', title: 'Custom renderers', level: 2 },
  { id: 'custom-demuxers', title: 'Custom demuxers', level: 2 },
  { id: 'custom-layers', title: 'Custom GPU layers', level: 2 },
]

export default function PluginsPage() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
      <article className="min-w-0 max-w-3xl flex-1">
        <PageHeader
          variant="doc"
          eyebrow="Plugins"
          title="Plugins & Custom Renderers"
          lede="Draw frames your own way, or read media formats the built-in demuxer cannot. Both plug in at clean boundaries, so the engine does not change."
        />

        <H2 id="overview">What you can replace</H2>
        <PropTable
          nameLabel="Extension point"
          rows={[
            { name: 'Renderer', type: 'public', desc: <>Anything implementing <C>Renderer</C> can draw a <C>Scene</C>: a 2D canvas, SVG, a terminal, a test recorder.</> },
            { name: 'DemuxerFactory', type: 'public', desc: <>Reads video containers for live playback. Pass your own to <C>Preview</C>.</> },
            { name: 'GPU layers', type: 'not public', desc: 'The built-in renderer’s per-clip-type layers. There is no registration API yet; see below.' },
          ]}
        />

        <H2 id="custom-renderers">Custom renderers</H2>
        <P>
          A renderer reads a <C>Scene</C> and writes pixels. It never sees the project, the engine or React, so it is the easiest part to swap.
          It implements five methods:
        </P>
        <PropTable
          nameLabel="Method"
          rows={[
            { name: 'mount(container)', desc: 'Attach to a DOM element, once. The renderer owns its own canvas.' },
            { name: 'resize(cssWidth, cssHeight, dpr?)', desc: 'The container changed size.' },
            { name: 'render(scene)', desc: 'Draw one frame. Must be synchronous: never await inside it.' },
            { name: 'prewarm?(scene)', desc: 'Optional: start loading what a coming frame needs.' },
            { name: 'dispose()', desc: 'Release everything.' },
          ]}
        />
        <Code
          title="CanvasRenderer.ts"
          highlight={[20, 21, 22]}
          code={`
import { type Renderer, type Scene, resolveDrawRect } from '@elah/core'

export class CanvasRenderer implements Renderer {
  private canvas = document.createElement('canvas')
  private ctx = this.canvas.getContext('2d')!

  mount(container: HTMLElement) {
    container.appendChild(this.canvas)
  }

  resize(cssWidth: number, cssHeight: number, dpr = 1) {
    this.canvas.width = Math.round(cssWidth * dpr)
    this.canvas.height = Math.round(cssHeight * dpr)
  }

  render(scene: Scene) {
    const { ctx, canvas } = this
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Each array is sorted on its own; merge and sort by zIndex to stack them correctly.
    const items = [...scene.videos, ...scene.images, ...scene.texts, ...scene.shapes]
    items.sort((a, b) => a.zIndex - b.zIndex)

    for (const item of items) {
      ctx.globalAlpha = item.opacity
      const rect = resolveDrawRect(item.transform, scene.stage.width, scene.stage.height)
      drawItem(ctx, item, rect) // your drawing: images, text, a decoded video frame…
    }
    ctx.globalAlpha = 1
  }

  dispose() {
    this.canvas.remove()
  }
}`}
        />
        <Callout kind="warning" title="Sort across types by zIndex">
          <C>scene.videos</C>, <C>scene.images</C> and the rest are each sorted back to front, but only within their own list. Draw them in
          list order and every image ends up above every video. Merge them and sort by <C>zIndex</C>, as above.
        </Callout>
        <P>
          <C>resolveDrawRect(transform, stageWidth, stageHeight, contentWidth?, contentHeight?, crop?)</C> is the same placement maths the
          built-in renderer uses. Pass the media&apos;s natural size when you know it, so off-shape media is fitted the same way.
        </P>

        <H3>Driving it</H3>
        <P>
          <C>Preview</C> always uses the built-in <C>GpuRenderer</C>. To use your own, drive it from the playback clock instead of rendering a{' '}
          <C>Preview</C>:
        </P>
        <Code
          highlight={[7, 8]}
          code={`
import { resolveTimeline } from '@elah/core'

const renderer = new CanvasRenderer()
renderer.mount(container)
renderer.resize(container.clientWidth, container.clientHeight, devicePixelRatio)

const unsubscribe = playback.subscribe(({ currentFrame }) => {
  renderer.render(resolveTimeline(currentFrame, engine.getProject()))
})`}
        />
        <Callout title="Video frames are yours to supply">
          A <C>Scene</C> says which source frame of which file is showing (<C>src</C>, <C>sourceFrame</C>), not the pixels. A custom renderer
          decodes video itself, for example with WebCodecs or a <C>&lt;video&gt;</C> element.
        </Callout>

        <H2 id="custom-demuxers">Custom demuxers</H2>
        <P>
          The live decode pipeline reads containers through a <C>DemuxerFactory</C>: a function that returns a <C>DemuxerBackend</C>. The built-in
          one uses mediabunny (<C>createDefaultDemuxerFactory()</C>). Provide your own to read other formats or fetch from your own storage.
        </P>
        <PropTable
          nameLabel="DemuxerBackend"
          rows={[
            { name: 'open(src)', type: '→ Promise<void>', desc: 'Open the source and get ready to read.' },
            { name: 'getConfig()', type: '→ VideoDecoderConfig', desc: 'The WebCodecs config used to set up the decoder.' },
            { name: 'packets([startSec, endSec])', type: '→ AsyncIterable<EncodedVideoChunk>', desc: 'The encoded chunks covering that time range.' },
            { name: 'seekToKeyframe(time)', type: '→ Promise<void>', desc: 'Move to the keyframe at or before a time, in seconds.' },
            { name: 'getRotation?()', type: '→ VideoRotation', desc: 'Optional: rotation stored in the file, for phone video.' },
            { name: 'dispose()', type: '→ void', desc: 'Release everything.' },
          ]}
        />
        <Code
          highlight={[3, 13]}
          code={`
import type { DemuxerFactory } from '@elah/core'

const myDemuxerFactory: DemuxerFactory = () => ({
  async open(src) {},
  getConfig: () => ({ codec: 'avc1.640028' /* … */ }),
  async *packets([startSec, endSec]) {
    // yield EncodedVideoChunk…
  },
  async seekToKeyframe(time) {},
  dispose() {},
})

<Preview demuxerFactory={myDemuxerFactory} />`}
        />
        <Callout kind="warning" title="Export does not use your demuxer">
          Export runs in its own worker and reads media with mediabunny directly, so <C>exportVideo</C> has no <C>demuxerFactory</C> option. A
          format only your demuxer can read will play in the preview but not export.
        </Callout>

        <H2 id="custom-layers">Custom GPU layers</H2>
        <Callout kind="warning" title="Not a public API yet">
          The built-in renderer draws each clip type with an internal layer (video, image, text, shape, generator…). They are registered inside{' '}
          <C>@elah/core</C>, and there is no exported way to add your own.
        </Callout>
        <P>For custom visuals today:</P>
        <PropTable
          nameLabel="Option"
          rows={[
            { name: 'Generator clips', desc: <>Procedural content (gradients, noise, shapes) from the built-in generators, as ordinary clips. <C>specVocabulary()</C> lists them.</> },
            { name: 'Effects', desc: <>GPU effects on a clip (<C>fx.*</C> keyframes) or on everything below an adjustment clip.</> },
            { name: 'Image or sequence clips', desc: 'Render your visuals elsewhere and bring them in as images or a frame sequence.' },
            { name: 'A custom renderer', desc: 'Full control, at the cost of drawing everything yourself.' },
          ]}
        />

        <DocsPager href="/docs/plugins" />
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
