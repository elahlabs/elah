import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { DocsToc } from '@/components/docs/DocsToc'
import { Code } from '@/components/docs/Code'
import { C, Callout, DocsPager, H2, H3, P, PropTable } from '@/components/docs/DocsKit'
import { PageHeader } from '@/components/site/PageHeader'
import { label } from '@/components/eb'

export const metadata: Metadata = {
  title: 'Export',
  description:
    'Export a timeline to MP4 entirely in the browser with exportVideo(): Web Worker rendering on OffscreenCanvas, the audio pipeline, progress tracking, and browser limits.',
  alternates: { canonical: '/docs/export' },
}

const toc = [
  { id: 'export-video', title: 'exportVideo()', level: 2 },
  { id: 'formats', title: 'Formats', level: 2 },
  { id: 'progress', title: 'Progress & cancelling', level: 2 },
  { id: 'worker', title: 'How it works', level: 2 },
  { id: 'audio', title: 'Audio', level: 2 },
  { id: 'limits', title: 'Browser support', level: 2 },
]

function Steps({ items }: { items: [string, ReactNode][] }) {
  return (
    <ol className="my-5 list-none space-y-0 border border-outline-variant p-0">
      {items.map(([where, t], i) => (
        <li key={i} className="flex gap-4 border-b border-outline-variant px-4 py-3 text-[15px] leading-[1.7] text-on-surface/85 last:border-b-0">
          <span className={`mt-[3px] flex h-5 w-5 shrink-0 items-center justify-center border border-on-surface text-[11px] text-on-surface ${label}`}>{i + 1}</span>
          <span className="flex-1">{t}</span>
          <span className={`mt-[3px] shrink-0 text-on-surface-variant ${label}`}>{where}</span>
        </li>
      ))}
    </ol>
  )
}

export default function ExportPage() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
      <article className="min-w-0 max-w-3xl flex-1">
        <PageHeader
          variant="doc"
          eyebrow="Export"
          title="Export"
          lede="Render a project to a video file in the browser, with no server. Export draws every frame with the same code as the preview, so the file matches what you saw."
        />

        <H2 id="export-video">exportVideo()</H2>
        <P>
          Pass the project, get back a <C>Blob</C>. The frame rate comes from the project.
        </P>
        <Code
          highlight={[3]}
          code={`
import { exportVideo } from '@elah/editor'

const blob = await exportVideo(engine.getProject(), { outputHeight: 1080 })

const a = document.createElement('a')
a.href = URL.createObjectURL(blob)
a.download = 'export.mp4'
a.click()`}
        />
        <Callout title="Check support before showing an Export button">
          <C>detectExportSupport()</C> from <C>@elah/core</C> returns <C>{'{ ok, missing, message }'}</C>, so you can explain why export is unavailable instead of
          failing halfway through. See{' '}
          <a href="#limits" className="text-on-surface underline decoration-[#FF003C] underline-offset-4">
            browser support
          </a>
          .
        </Callout>

        <H3>Options</H3>
        <PropTable
          nameLabel="Option"
          rows={[
            { name: 'outputHeight', type: 'number', optional: true, desc: 'Size of the short edge in pixels, like "1080p". Default: the stage’s own size.' },
            { name: 'container', type: "'mp4' | 'webm' | 'gif' | 'png-sequence'", optional: true, desc: 'The file type. Default mp4. See Formats.' },
            { name: 'videoCodec', type: "'avc' | 'hevc' | 'av1' | 'vp9' | 'vp8'", optional: true, desc: 'Default avc (H.264). Others work where the browser can encode them.' },
            { name: 'audioCodec', type: "'aac' | 'opus'", optional: true, desc: 'The audio codec.' },
            { name: 'videoBitrate · audioBitrate', type: 'number', optional: true, desc: 'Bits per second. Defaults 8 Mbps and 128 kbps.' },
            { name: 'range', type: "'all' | 'inOut'", optional: true, desc: 'Default all. inOut exports only the marked in/out range.' },
            { name: 'transparent', type: 'boolean', optional: true, desc: 'Keep transparency. WebM only, and only where the browser verifies it works.' },
            { name: 'onProgress', type: '(p) => void', optional: true, desc: 'Called once per frame. See Progress.' },
            { name: 'signal', type: 'AbortSignal', optional: true, desc: 'Cancel the export.' },
            { name: 'sources', type: 'Record<src, Blob>', optional: true, desc: 'File contents you already hold, keyed by clip src, so local files are read directly instead of fetched.' },
          ]}
          footer="Also: gifFps, frameSink, audioResolver, onAudioIssue, fonts, onFontIssue and preDecoded, for the cases described below."
        />

        <H3>outputHeight is the short edge</H3>
        <P>
          Like &ldquo;1080p&rdquo;, it names the short side, so the same value works for landscape and portrait. The other side follows the
          stage&apos;s shape, rounded to an even number, which most codecs need.
        </P>
        <PropTable
          nameLabel="Stage"
          rows={[
            { name: '1920 × 1080', type: 'outputHeight 1080', desc: '1920 × 1080' },
            { name: '1080 × 1920', type: 'outputHeight 1080', desc: '1080 × 1920' },
            { name: '1920 × 1080', type: 'outputHeight 720', desc: '1280 × 720' },
            { name: '1080 × 1920', type: 'outputHeight 720', desc: '720 × 1280' },
            { name: '1080 × 1080', type: 'outputHeight 720', desc: '720 × 720' },
            { name: 'any', type: 'left out', desc: 'The stage size, not scaled.' },
          ]}
        />
        <Callout kind="warning" title="Upgrading from before 0.6.0 with a portrait project?">
          <C>outputHeight</C> used to scale the stage&apos;s height, so a 9:16 project asked for 1080 came out 608 × 1080. It now comes out
          1080 × 1920. The CLI&apos;s <C>--height</C> flag is the same option.
        </Callout>

        <H2 id="formats">Formats</H2>
        <PropTable
          nameLabel="container"
          rows={[
            { name: 'mp4', desc: 'The default. Video and audio.' },
            { name: 'webm', desc: <>Video and audio. The only format that can keep transparency, with <C>transparent: true</C>.</> },
            { name: 'gif', desc: <>No audio. Defaults to at most 15 fps (<C>gifFps</C>) and a 480-pixel short edge; at most 3000 frames.</> },
            { name: 'png-sequence', desc: <>One PNG per frame, returned as a ZIP (up to 128 MiB or 10,000 files). Pass a <C>frameSink</C> to write frames somewhere else instead.</> },
          ]}
        />
        <Callout kind="warning" title="With a frameSink, the returned Blob is empty">
          The frames went to your sink. Don&apos;t offer that Blob as a download.
        </Callout>

        <H2 id="progress">Progress &amp; cancelling</H2>
        <P>
          <C>onProgress</C> reports <C>{'{ frame, totalFrames }'}</C> for every frame. Pass an <C>AbortSignal</C> to stop an export; the promise
          rejects and the worker shuts down.
        </P>
        <Code
          highlight={[5, 8]}
          code={`
const controller = new AbortController()

const blob = await exportVideo(project, {
  signal: controller.signal,
  onProgress: ({ frame, totalFrames }) => setPercent(Math.round((frame / totalFrames) * 100)),
})

cancelButton.onclick = () => controller.abort()`}
        />

        <H2 id="worker">How it works</H2>
        <Steps
          items={[
            ['Main thread', <>Mixes the audio. The Web Audio API is not available in workers.</>],
            ['Worker', <>For each frame, calls <C>resolveTimeline(frame, project)</C>, the same function the preview uses, and draws the result on an <C>OffscreenCanvas</C>.</>],
            ['Worker', <>Encodes each frame with WebCodecs.</>],
            ['Worker', <>Muxes video and audio into the file with mediabunny, and sends it back as a <C>Blob</C>.</>],
          ]}
        />
        <P>
          Because preview and export share the same timeline maths, a frame in the file is the frame you saw. The audio and the finished file
          are handed between threads without copying.
        </P>
        <H3>Keep the export code out of your main bundle</H3>
        <Code
          code={`
import { lazyExportVideo } from '@elah/editor'

const blob = await lazyExportVideo(project, options) // same call, same result`}
        />
        <Callout title="lazyExportVideo only loads later">
          It downloads the export code, including mediabunny, the first time someone exports. The export itself is identical; it is not chunked
          or streamed.
        </Callout>

        <H2 id="audio">Audio</H2>
        <P>
          Every audible clip is decoded and mixed on the main thread before the video is rendered. A clip whose audio cannot be fetched or decoded
          is left out of the mix rather than failing the export.
        </P>
        <PropTable
          nameLabel="Option"
          rows={[
            { name: 'onAudioIssue', type: '(message, src) => void', optional: true, desc: 'Called for each clip that was left out of the mix, so you can tell the user.' },
            { name: 'audioResolver', type: '(src) => bytes', optional: true, desc: 'Fetch audio yourself, for a CDN, authentication or a proxy. Default: fetch(src).' },
          ]}
        />

        <H2 id="limits">Browser support</H2>
        <P>
          Export needs <C>VideoEncoder</C> and <C>VideoDecoder</C> (WebCodecs), a <C>Worker</C>, <C>OffscreenCanvas</C>, and WebGL2 on that
          canvas. It has been tested in recent Chrome and Edge; Safari and Firefox are untested.
        </P>
        <Code
          code={`
import { detectExportSupport } from '@elah/core'

const support = detectExportSupport()
if (!support.ok) showMessage(support.message) // support.missing lists what is absent`}
        />
        <PropTable
          nameLabel="Limit"
          rows={[
            { name: 'Memory', desc: 'The whole file is built in memory. Very long, high-bitrate exports can run out; lower outputHeight or videoBitrate, or export in parts with range.' },
            { name: 'Codecs', desc: 'avc (H.264) works widely. hevc, av1, vp9 and vp8 depend on what the browser can encode.' },
            { name: 'Transparency', desc: 'WebM only, and only after the browser passes a quick encode-and-decode check.' },
          ]}
        />

        <DocsPager href="/docs/export" />
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
