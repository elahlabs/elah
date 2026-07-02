import type { Metadata } from 'next'
import { CodeBlock } from '@/components/docs/CodeBlock'
import { DocsToc } from '@/components/docs/DocsToc'

export const metadata: Metadata = { title: 'Plugins & Custom Renderers' }

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
          <div className="label-mono mb-2 text-2xs text-on-surface-variant opacity-60">Plugins</div>
          <h1
            className="text-3xl font-semibold tracking-tight text-on-surface"
            style={{ fontFamily: 'var(--font-inter), sans-serif' }}
          >
            Plugins & Custom Renderers
          </h1>
          <p className="mt-3 text-base leading-relaxed text-on-surface-variant">
            Swap the renderer, add custom GPU layers, or bring your own media demuxer.
          </p>
        </div>

        <section className="mb-10">
          <h2
            id="custom-renderers"
            className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-20"
            style={{ fontFamily: 'var(--font-inter), sans-serif' }}
          >
            Custom Renderers
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            Any object that implements the{' '}
            <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">
              Renderer
            </code>{' '}
            interface can replace the built-in{' '}
            <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">
              GpuRenderer
            </code>
            . The renderer receives a{' '}
            <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">
              Scene
            </code>{' '}
            each tick and is responsible for writing pixels:
          </p>
          <CodeBlock
            language="typescript"
            filename="MyRenderer.ts"
            code={`import { type Renderer, type Scene } from '@elah/core'

export class CanvasRenderer implements Renderer {
  private ctx: CanvasRenderingContext2D

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!
  }

  render(scene: Scene): void {
    const { ctx } = this
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)

    // Render in zIndex order
    const allClips = [
      ...scene.videos,
      ...scene.images,
      ...scene.texts,
    ].sort((a, b) => a.zIndex - b.zIndex)

    for (const clip of allClips) {
      ctx.globalAlpha = clip.opacity

      if ('src' in clip) {
        // draw image/video frame
        const frame = getFrame(clip.src, scene.frame)
        if (frame) ctx.drawImage(frame, clip.drawRect.x, clip.drawRect.y,
                                        clip.drawRect.width, clip.drawRect.height)
      }
    }

    ctx.globalAlpha = 1
  }

  destroy(): void {
    // cleanup
  }
}`}
          />
        </section>

        <section className="mb-10">
          <h2
            id="custom-layers"
            className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-20"
            style={{ fontFamily: 'var(--font-inter), sans-serif' }}
          >
            Custom GPU Layers
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            The{' '}
            <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">
              GpuRenderer
            </code>{' '}
            uses a layer registry. Each layer type (VideoLayer, ImageLayer, TextLayer) is a class
            that handles setup, texture upload, and draw calls for its clip type.
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
          <h2
            id="custom-demuxers"
            className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-20"
            style={{ fontFamily: 'var(--font-inter), sans-serif' }}
          >
            Custom Demuxers
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            The decode pipeline is fully pluggable via the{' '}
            <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">
              DemuxerFactory
            </code>{' '}
            interface. The built-in implementation uses mediabunny, but you can swap in any demuxer
            that implements the interface:
          </p>
          <CodeBlock
            language="typescript"
            code={`import { type DemuxerFactory, type DemuxerBackend } from '@elah/core'

const myDemuxerFactory: DemuxerFactory = () => {
  // Return a DemuxerBackend implementation
  return {
    async probe(src: string): Promise<MediaInfo> {
      // Return video dimensions, duration, track info
    },
    async demux(
      src: string,
      options: DemuxOptions,
      onChunk: (chunk: EncodedVideoChunk) => void
    ): Promise<void> {
      // Feed EncodedVideoChunks to the WebCodecs decoder
    },
    destroy(): void {},
  }
}

// Pass your factory to Preview and exportVideo
<Preview demuxerFactory={myDemuxerFactory} />

await exportVideo(project, {
  fps: 30,
  demuxerFactory: myDemuxerFactory,
})`}
          />
        </section>
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
