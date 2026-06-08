import type { Metadata } from 'next'
import { CodeBlock } from '@/components/docs/CodeBlock'
import { DocsToc } from '@/components/docs/DocsToc'

export const metadata: Metadata = { title: 'Export' }

const toc = [
  { id: 'export-video', title: 'exportVideo()', level: 2 },
  { id: 'worker', title: 'Export Worker', level: 2 },
  { id: 'audio', title: 'Audio Pipeline', level: 2 },
  { id: 'progress', title: 'Progress Tracking', level: 2 },
  { id: 'limits', title: 'Browser Limits', level: 2 },
]

export default function ExportPage() {
  return (
    <div className="flex gap-12">
      <article className="min-w-0 flex-1 max-w-3xl">
        <div className="mb-8 pb-6 border-b border-outline-variant">
          <div className="label-mono mb-2 text-2xs text-on-surface-variant opacity-60">Export</div>
          <h1 className="text-3xl font-semibold tracking-tight text-on-surface" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Export Pipeline
          </h1>
          <p className="mt-3 text-base leading-relaxed text-on-surface-variant">
            The export pipeline runs frame-by-frame in a dedicated Web Worker, muxes MP4 with mediabunny, and never drifts from the live preview.
          </p>
        </div>

        {/* exportVideo */}
        <section className="mb-10">
          <h2 id="export-video" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            exportVideo()
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">exportVideo()</code> is the primary export entry point. It spins up the export worker, renders every frame to <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">OffscreenCanvas</code>, muxes the result, and resolves with an MP4 <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">Blob</code>:
          </p>
          <CodeBlock
            language="tsx"
            filename="ExportButton.tsx"
            code={`import {
  exportVideo,
  useTimelineEngine,
  createMediabunnyBackend,
  type ExportOptions,
  type ExportProgress,
} from '@elah/editor'
import * as mediabunny from 'mediabunny'
import { useState } from 'react'

const demuxerFactory = () =>
  createMediabunnyBackend(mediabunny, {
    blobResolver: (src) => fetch(src).then((r) => r.blob()),
  })

export function ExportButton() {
  const engine = useTimelineEngine()
  const [progress, setProgress] = useState<ExportProgress | null>(null)

  const handleExport = async () => {
    const project = engine.getProject()

    const options: ExportOptions = {
      fps: 30,
      demuxerFactory,
      videoCodec: 'avc',     // 'avc' | 'vp9' — default: 'avc'
      audioCodec: 'aac',     // 'aac' | 'opus' — default: 'aac'
      videoBitrate: 8_000_000, // 8 Mbps
      audioBitrate: 192_000,
      onProgress: (p) => setProgress(p),
    }

    try {
      const blob = await exportVideo(project, options)

      // Download the file
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'export.mp4'
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setProgress(null)
    }
  }

  return (
    <div>
      <button onClick={handleExport} disabled={!!progress}>
        {progress
          ? \`Exporting \${Math.round(progress.percent)}%\`
          : 'Export MP4'}
      </button>
      {progress && (
        <progress value={progress.percent} max={100} />
      )}
    </div>
  )
}`}
          />
        </section>

        {/* Worker */}
        <section className="mb-10">
          <h2 id="worker" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Export Worker
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            The export worker runs in a <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">Web Worker</code> with an <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">OffscreenCanvas</code>. It uses the exact same <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">resolveTimeline()</code> and placement math (<code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">resolveDrawRect</code>, <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">computeTextLayout</code>) as the live renderer — so preview and export never drift.
          </p>
          <div className="overflow-hidden rounded-md border border-outline-variant mb-4">
            {[
              { step: '1', label: 'Serialize project', desc: 'Main thread transfers the Project snapshot and source blobs to the worker' },
              { step: '2', label: 'Frame loop', desc: 'Worker calls resolveTimeline(frame, project) for each frame and draws to OffscreenCanvas' },
              { step: '3', label: 'VideoEncoder', desc: 'Each canvas frame is encoded via WebCodecs VideoEncoder with the configured codec/bitrate' },
              { step: '4', label: 'Audio mix', desc: 'Audio is decoded and mixed on the main thread (Web Audio not available in workers)' },
              { step: '5', label: 'MP4 mux', desc: 'mediabunny muxes video and audio tracks into a final MP4 Blob' },
            ].map((row, i) => (
              <div
                key={row.step}
                className={`flex items-start gap-4 border-b border-outline-variant p-3 last:border-0 ${i % 2 === 0 ? 'bg-white' : 'bg-surface-lowest'}`}
              >
                <span className="label-mono w-4 shrink-0 text-xs text-primary">{row.step}</span>
                <div className="w-32 shrink-0 text-xs font-medium text-on-surface">{row.label}</div>
                <div className="text-xs text-on-surface-variant">{row.desc}</div>
              </div>
            ))}
          </div>
          <p className="text-sm leading-relaxed text-on-surface-variant">
            If you need lower-level access, use <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">lazyExportVideo()</code> — same pipeline but returns an <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">AsyncIterator</code> of frame chunks for streaming mux:
          </p>
          <CodeBlock
            language="typescript"
            code={`import { lazyExportVideo } from '@elah/editor'

const iterator = lazyExportVideo(project, options)
for await (const chunk of iterator) {
  // chunk.type: 'video-chunk' | 'audio-chunk' | 'done'
  // chunk.data: EncodedVideoChunk | EncodedAudioChunk | undefined
  if (chunk.type === 'done') break
  muxer.addChunk(chunk)
}`}
          />
        </section>

        {/* Audio pipeline */}
        <section className="mb-10">
          <h2 id="audio" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Audio Pipeline
          </h2>
          <div className="mb-4 rounded-md border border-outline-variant bg-amber-50 p-4">
            <div className="label-mono mb-1 text-2xs text-amber-700">Important constraint</div>
            <p className="text-xs leading-relaxed text-amber-800">
              Web Audio API is not available in Web Workers. Audio is decoded and mixed on the <strong>main thread</strong> during export. For long projects this is acceptable; for very large projects consider chunking.
            </p>
          </div>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            During live playback, <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">AudioPlaybackController</code> reads <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">scene.audios</code> and schedules Web Audio nodes beside the renderer on the same <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">PlaybackEngine</code> clock:
          </p>
          <CodeBlock
            language="typescript"
            code={`// AudioPlaybackController is wired by EditorProvider automatically.
// To control audio from outside:
import { usePlaybackStore } from '@elah/editor'

// Enable/disable audio playback
const enableAudio = usePlaybackStore((s) => s.enableAudio)
const setEnableAudio = usePlaybackStore((s) => s.setEnableAudio)

// Or pass enableAudio prop to Preview (default: true)
<Preview demuxerFactory={demuxerFactory} enableAudio={false} />`}
          />
        </section>

        {/* Progress */}
        <section className="mb-10">
          <h2 id="progress" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Progress Tracking
          </h2>
          <CodeBlock
            language="typescript"
            code={`interface ExportProgress {
  frame: number        // current frame being rendered
  totalFrames: number  // total frames in the project
  percent: number      // 0..100
  phase: 'encoding' | 'muxing' | 'done'
}

// Usage
const blob = await exportVideo(project, {
  fps: 30,
  demuxerFactory,
  onProgress: (p) => {
    console.log(\`\${p.phase}: \${Math.round(p.percent)}% (\${p.frame}/\${p.totalFrames})\`)
  },
})`}
          />
        </section>

        {/* Browser limits */}
        <section className="mb-10">
          <h2 id="limits" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Browser Limits
          </h2>
          <div className="overflow-hidden rounded-md border border-outline-variant">
            {[
              { item: 'WebCodecs availability', detail: 'Chrome/Edge 108+. Firefox has partial support behind a flag. Safari: limited.' },
              { item: 'VideoEncoder hardware limits', detail: 'Simultaneous encoder count is hardware-dependent. Export creates one encoder per run.' },
              { item: 'Memory — frame cache', detail: 'Each decoded frame is an ImageBitmap. Long projects with many tracks will pressure heap. The copy-and-close pattern limits live pool size.' },
              { item: 'Audio in workers', detail: 'Web Audio API is unavailable in Web Workers. Audio decode + mix happens on the main thread.' },
              { item: 'COOP/COEP headers', detail: 'mediabunny requires SharedArrayBuffer. The server must send Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp.' },
              { item: 'Export file size', detail: 'Browsers have per-Blob memory limits. Very long high-bitrate exports may OOM. Use chunked streaming (lazyExportVideo) if you hit limits.' },
            ].map((row, i) => (
              <div
                key={row.item}
                className={`flex flex-col gap-1 border-b border-outline-variant p-3 last:border-0 sm:flex-row sm:gap-4 ${i % 2 === 0 ? 'bg-white' : 'bg-surface-lowest'}`}
              >
                <div className="w-48 shrink-0 text-xs font-medium text-on-surface">{row.item}</div>
                <div className="text-xs text-on-surface-variant">{row.detail}</div>
              </div>
            ))}
          </div>
        </section>
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
