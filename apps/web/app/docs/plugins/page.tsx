import type { Metadata } from 'next'
import { CodeBlock } from '@/components/docs/CodeBlock'
import { DocsToc } from '@/components/docs/DocsToc'

export const metadata: Metadata = {
  title: 'Plugins & Custom Renderers',
  description:
    'Extend elah with custom renderers, custom layers, and custom demuxers — the supported extension points of the engine.',
  alternates: { canonical: '/docs/plugins' },
}

const toc = [
  { id: 'custom-renderers', title: 'Custom Renderers', level: 2 },
  { id: 'custom-layers', title: 'Custom Layers', level: 2 },
  { id: 'custom-demuxers', title: 'Custom Demuxers', level: 2 },
]

export default function PluginsPage() {
  return (
    <div className="flex gap-12">
      <article className="min-w-0 flex-1 max-w-3xl">
        <div className="mb-8 pb-6 border-b border-outline-variant">
          <div className="label-mono mb-2 text-2xs text-on-surface-variant opacity-90">Plugins</div>
          <h1 className="text-3xl font-semibold tracking-tight text-on-surface" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Plugins & Custom Renderers
          </h1>
          <p className="mt-3 text-base leading-relaxed text-on-surface-variant">
            Swap the renderer, add custom GPU layers, or bring your own media demuxer.
          </p>
        </div>

        <section className="mb-10">
          <h2 id="custom-renderers" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Custom Renderers
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            Any object that implements the <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">Renderer</code> interface can replace the built-in <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">GpuRenderer</code>. The renderer receives a <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">Scene</code> each tick and is responsible for writing pixels:
          </p>
          <CodeBlock
            language="typescript"
            filename="MyRenderer.ts"
            code={`import { type Renderer, type Scene, resolveDrawRect } from '@elah/core'

export class CanvasRenderer implements Renderer {
  private canvas!: HTMLCanvasElement
  private ctx!: CanvasRenderingContext2D

  // Attach to the host container once. The renderer owns its canvas.
  mount(container: HTMLElement): void {
    this.canvas = document.createElement('canvas')
    this.ctx = this.canvas.getContext('2d')!
    container.appendChild(this.canvas)
  }

  // Update the backing-store size when the container resizes.
  resize(cssWidth: number, cssHeight: number, dpr = 1): void {
    this.canvas.width = Math.round(cssWidth * dpr)
    this.canvas.height = Math.round(cssHeight * dpr)
  }

  render(scene: Scene): void {
    const { ctx } = this
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)

    // Arrays are already sorted back-to-front; last element wins.
    const allClips = [...scene.videos, ...scene.images, ...scene.texts]

    for (const clip of allClips) {
      ctx.globalAlpha = clip.opacity

      if ('src' in clip) {
        // Compute placement yourself — drawRect is NOT on the Scene clip.
        // resolveDrawRect(transform, stageW, stageH, contentW?, contentH?)
        const { width: sw, height: sh } = scene.stage
        const rect = resolveDrawRect(clip.transform, sw, sh)
        const frame = getFrame(clip.src, scene.frame)
        if (frame) ctx.drawImage(frame, rect.x, rect.y, rect.width, rect.height)
      }
    }

    ctx.globalAlpha = 1
  }

  dispose(): void {
    this.canvas.remove()
  }
}`}
          />
        </section>

        <section className="mb-10">
          <h2 id="custom-layers" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Custom GPU Layers
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            The <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">GpuRenderer</code> uses a layer registry. Each layer type (VideoLayer, ImageLayer, TextLayer) is a class that handles setup, texture upload, and draw calls for its clip type.
          </p>
          <CodeBlock
            language="typescript"
            code={`// Layers are registered on the renderer.
// To add a custom layer, extend GpuLayer (internal class):

// 1. Create a new layer class
class GradientLayer {
  setup(gl: WebGL2RenderingContext): void { /* shader setup */ }
  draw(gl: WebGL2RenderingContext, clip: ActiveVideoClip): void { /* draw call */ }
  destroy(): void { /* cleanup */ }
}

// 2. Register on the renderer (internal API — subject to change)
renderer.registerLayer('gradient', GradientLayer)

// 3. Scene clips with matching type are routed to your layer`}
          />
        </section>

        <section className="mb-10">
          <h2 id="custom-demuxers" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Custom Demuxers
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            The decode pipeline is fully pluggable via the <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">DemuxerFactory</code> interface. The built-in implementation uses mediabunny, but you can swap in any demuxer that implements the interface:
          </p>
          <CodeBlock
            language="typescript"
            code={`import { type DemuxerFactory, type DemuxerBackend } from '@elah/core'

// A DemuxerFactory is just () => DemuxerBackend.
const myDemuxerFactory: DemuxerFactory = () => {
  return {
    // Open the source and prepare to read packets.
    async open(src: string): Promise<void> {},
    // Return the WebCodecs config used to configure the VideoDecoder.
    getConfig(): VideoDecoderConfig {
      return { codec: 'avc1.640028' /* ... */ }
    },
    // Yield EncodedVideoChunks covering [startSec, endSec].
    async *packets(timeRange: [number, number]): AsyncIterable<EncodedVideoChunk> {
      // yield chunk
    },
    // Seek the reader to the keyframe at/just before the given time (seconds).
    async seekToKeyframe(time: number): Promise<void> {},
    dispose(): void {},
  }
}

// Pass your factory to Preview to drive live playback decode:
<Preview demuxerFactory={myDemuxerFactory} />

// Note: export runs in a dedicated worker that uses mediabunny directly,
// so exportVideo() does not accept a demuxerFactory.
await exportVideo(project)`}
          />
        </section>
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
