import type { Metadata } from 'next'
import { CodeBlock } from '@/components/docs/CodeBlock'
import { DocsToc } from '@/components/docs/DocsToc'

export const metadata: Metadata = {
  title: 'CLI & Server',
  description:
    'Run elah headlessly: the @elah/cli command line, the seconds-based build spec for AI-generated videos, and elah serve — a self-hosted HTTP render server whose output is bit-identical to the browser.',
  alternates: { canonical: '/docs/cli' },
}

const toc = [
  { id: 'install', title: 'Install', level: 2 },
  { id: 'commands', title: 'Commands', level: 2 },
  { id: 'build-spec', title: 'The Build Spec', level: 2 },
  { id: 'serve', title: 'Serve Mode', level: 2 },
  { id: 'rendering', title: 'How Rendering Works', level: 2 },
  { id: 'docker', title: 'Docker & Self-Hosting', level: 2 },
  { id: 'library-api', title: 'Library API', level: 2 },
]

const commands = [
  {
    cmd: 'elah split',
    usage: '--project <in.json> --clip <clipId> --at <frame|timecode> [--out <out.json>]',
    note: 'Pure Node, no browser. Prints project JSON to stdout unless --out is given.',
  },
  {
    cmd: 'elah trim',
    usage: '--project <in.json> --clip <clipId> [--start <frame|timecode>] [--duration <frames|timecode>] [--out <out.json>]',
    note: 'Pure Node, no browser.',
  },
  {
    cmd: 'elah export',
    usage: '--project <in.json> --out <file.mp4> [--codec avc|vp9|vp8] [--height <N>] [--video-bitrate <bps>] [--audio-bitrate <bps>] [--browser <path>] [--headed] [--timeout <s>]',
    note: 'Launches headless Chrome and runs the real exportVideo pipeline.',
  },
  {
    cmd: 'elah build',
    usage: '--spec <spec.json> [--out <project.json>] [--export <file.mp4>] [export options]',
    note: 'Builds a project from a seconds-based spec; optionally exports it.',
  },
  {
    cmd: 'elah serve',
    usage: '[--port 8080] [--host 127.0.0.1] [--concurrency 1] [--media-root <dir>] [--timeout 600] [--verbose] [export options]',
    note: 'Long-lived HTTP render server with a warm browser.',
  },
]

export default function CliPage() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
      <article className="min-w-0 flex-1 max-w-3xl">
        <div className="mb-8 pb-6 border-b border-outline-variant">
          <div className="label-mono mb-2 text-2xs text-on-surface-variant opacity-90">CLI &amp; Server</div>
          <h1
            id="cli"
            className="text-3xl font-semibold tracking-tight text-on-surface"
            style={{ fontFamily: 'var(--font-inter), sans-serif' }}
          >
            CLI &amp; Server
          </h1>
          <p className="mt-3 text-base leading-relaxed text-on-surface-variant">
            The same engine that powers the in-browser editor runs headlessly on your
            server. <code className="rounded bg-surface-container px-1.5 py-0.5 text-sm font-mono">@elah/cli</code>{' '}
            is a thin consumer of <code className="rounded bg-surface-container px-1.5 py-0.5 text-sm font-mono">@elah/core</code>&apos;s
            public APIs — build projects from JSON specs, export MP4s, or run a
            long-lived HTTP render server.
          </p>
        </div>

        {/* Install */}
        <section className="mb-10">
          <h2 id="install" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Install
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            Install globally, or run without installing via <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">npx</code>:
          </p>
          <CodeBlock
            language="bash"
            filename="npm"
            code={`npm install -g @elah/cli
elah serve

# or, zero-install:
npx @elah/cli serve`}
          />
          <p className="mt-4 text-sm leading-relaxed text-on-surface-variant">
            Requires Node.js ≥ 18. <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">export</code> and{' '}
            <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">serve</code> also require a{' '}
            branded Chrome or Edge on the host — Playwright&apos;s bundled Chromium
            lacks H.264/AAC codec support. Point at a specific browser with{' '}
            <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">--browser &lt;path&gt;</code> or the{' '}
            <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">ELAH_BROWSER</code> env var.
          </p>
        </section>

        {/* Commands */}
        <section className="mb-10">
          <h2 id="commands" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Commands
          </h2>
          <div className="overflow-hidden rounded-md border border-outline-variant">
            {commands.map((row, i) => (
              <div
                key={row.cmd}
                className={`flex flex-col gap-1 border-b border-outline-variant p-3 last:border-0 ${i % 2 === 0 ? 'bg-surface-low' : 'bg-surface-lowest'}`}
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-xs font-medium text-primary">{row.cmd}</span>
                  <span className="break-all font-mono text-xs text-on-surface-variant">{row.usage}</span>
                </div>
                <div className="text-xs text-on-surface-variant">{row.note}</div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm leading-relaxed text-on-surface-variant">
            Exit codes: <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">0</code> success,{' '}
            <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">1</code> validation/runtime
            failure, <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">2</code> usage
            error. Diagnostics go to stderr.
          </p>
        </section>

        {/* Build spec */}
        <section className="mb-10">
          <h2 id="build-spec" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            The Build Spec
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">elah build</code> consumes a
            seconds-based spec, probes each media asset&apos;s real duration, and constructs
            the project through <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">TimelineEngine</code>,
            so overlaps, track caps, and source bounds are all validated with precise,
            path-addressed errors (<code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">clips[2].duration must be …</code>)
            that a generating model can self-correct from.
          </p>
          <CodeBlock
            language="json"
            filename="spec.json"
            code={`{
  "fps": 30,
  "stage": { "width": 1920, "height": 1080 },
  "assets": {
    "footage": "./media/clip.mp4",
    "music": "./media/song.mp3",
    "logo": "./media/logo.png"
  },
  "clips": [
    { "track": "video", "asset": "footage", "start": 0, "duration": 8, "sourceStart": 2, "volume": 0.8 },
    { "track": "text",  "text": "Hello", "start": 0.5, "duration": 4,
      "fontSize": 96, "color": "#ffffff", "fontFamily": "Arial", "fontWeight": "bold",
      "align": "center", "x": 0.5, "y": 0.15 },
    { "track": "image", "asset": "logo", "start": 1, "duration": 6, "x": 0.9, "y": 0.1, "scale": 0.3, "opacity": 0.8 },
    { "track": "audio", "asset": "music", "start": 0, "duration": 8, "volume": 0.5 }
  ]
}`}
          />
          <p className="mt-4 mb-2 text-sm leading-relaxed text-on-surface-variant">
            Rules worth knowing:
          </p>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-on-surface-variant">
            <li><strong className="text-on-surface">Times are seconds</strong> (floats fine), converted to integer frames at <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">fps</code> (default 30). <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">stage</code> defaults to 1920×1080.</li>
            <li><strong className="text-on-surface">assets</strong> maps names to paths relative to the spec file, or <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">http(s)</code> URLs.</li>
            <li><strong className="text-on-surface">x</strong>/<strong className="text-on-surface">y</strong> are the normalized (0..1) stage position of the clip&apos;s center; <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">scale</code> is relative to native size.</li>
            <li><strong className="text-on-surface">Overlaps</strong>: video clips must not overlap (single video track, engine-enforced); overlapping text/image/audio clips are automatically placed on additional tracks.</li>
          </ul>
          <p className="mt-4 mb-4 text-sm leading-relaxed text-on-surface-variant">
            Then build and export in one step:
          </p>
          <CodeBlock
            language="bash"
            code={`elah build --spec spec.json --export final.mp4`}
          />
        </section>

        {/* Serve */}
        <section className="mb-10">
          <h2 id="serve" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Serve Mode
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">elah serve</code> runs a
            long-lived HTTP render server with a warm browser, so each request only pays
            for a new browser tab instead of a fresh Chrome process:
          </p>
          <CodeBlock
            language="bash"
            code={`elah serve --port 8080 --concurrency 2 --media-root ./assets`}
          />
          <div className="mt-4 overflow-hidden rounded-md border border-outline-variant">
            <div className="flex flex-col gap-1 border-b border-outline-variant bg-surface-low p-3 sm:flex-row sm:items-start sm:gap-4">
              <div className="font-mono text-xs font-medium text-on-surface sm:w-32 sm:shrink-0">GET /healthz</div>
              <div className="text-xs text-on-surface-variant">
                <code className="rounded bg-surface-container px-1.5 py-0.5 text-2xs font-mono">200 {'{'} status, browser: &quot;connected&quot; | &quot;disconnected&quot; {'}'}</code>
              </div>
            </div>
            <div className="flex flex-col gap-1 bg-surface-lowest p-3 sm:flex-row sm:items-start sm:gap-4">
              <div className="font-mono text-xs font-medium text-on-surface sm:w-32 sm:shrink-0">POST /render</div>
              <div className="text-xs text-on-surface-variant">
                Body = a build spec JSON document; blocks until the render finishes and
                returns the MP4 bytes. <code className="rounded bg-surface-container px-1.5 py-0.5 text-2xs font-mono">422</code> on
                validation errors, <code className="rounded bg-surface-container px-1.5 py-0.5 text-2xs font-mono">503</code> +{' '}
                <code className="rounded bg-surface-container px-1.5 py-0.5 text-2xs font-mono">Retry-After</code> when at
                capacity (<code className="rounded bg-surface-container px-1.5 py-0.5 text-2xs font-mono">--concurrency</code>),{' '}
                <code className="rounded bg-surface-container px-1.5 py-0.5 text-2xs font-mono">500</code> on render
                failure.
              </div>
            </div>
          </div>
          <p className="mt-4 mb-4 text-sm leading-relaxed text-on-surface-variant">
            There is no job queue — this is a synchronous, retry-on-503 contract:
          </p>
          <CodeBlock
            language="bash"
            code={`curl -X POST --data-binary @spec.json http://127.0.0.1:8080/render -o out.mp4`}
          />
        </section>

        {/* How rendering works */}
        <section className="mb-10">
          <h2 id="rendering" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            How Rendering Works
          </h2>
          <p className="text-sm leading-relaxed text-on-surface-variant">
            <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">export</code> and{' '}
            <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">serve</code> launch a branded
            Chrome headlessly (via Playwright) and run core&apos;s real{' '}
            <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">exportVideo</code> pipeline
            inside it — the same worker + OffscreenCanvas code path the browser editor
            uses. Output is <strong className="text-on-surface">bit-identical to browser export by
            construction</strong>, not by approximation: there is no separate server-side
            renderer to drift out of sync.
          </p>
        </section>

        {/* Docker */}
        <section className="mb-10">
          <h2 id="docker" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Docker &amp; Self-Hosting
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            The <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">packages/cli</code> repo
            ships a Dockerfile that installs branded Chrome and fonts, then runs{' '}
            <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">elah serve</code>:
          </p>
          <CodeBlock
            language="bash"
            code={`docker build -f packages/cli/Dockerfile -t elah-render .
docker run -p 8080:8080 elah-render`}
          />
          <p className="mt-4 text-sm leading-relaxed text-on-surface-variant">
            The render server ships with no built-in authentication — bind it to{' '}
            <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">127.0.0.1</code> or put it
            behind a proxy that handles auth. See{' '}
            <a
              href="https://github.com/elahlabs/elah/blob/main/docs/deploy-render-server.md"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              docs/deploy-render-server.md
            </a>{' '}
            for systemd setup, security hardening, and GPU/performance notes.
          </p>
        </section>

        {/* Library API */}
        <section className="mb-10">
          <h2 id="library-api" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Library API
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">@elah/cli</code> is also
            importable — no shelling out, no stderr parsing:
          </p>
          <CodeBlock
            language="typescript"
            code={`import { build, exportProject } from '@elah/cli'

const { project } = await build({ spec: mySpecObject, baseDir: '/path/to/assets' })

const { bytes } = await exportProject(
  { project, outPath: 'out.mp4' },
  { onProgress: ({ frame, totalFrames }) => console.log(\`\${frame}/\${totalFrames}\`) }
)`}
          />
          <p className="mt-4 mb-4 text-sm leading-relaxed text-on-surface-variant">
            For repeated renders, <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">createRenderSession()</code> keeps
            a browser warm across calls instead of launching Chrome per export — this is
            what <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">elah serve</code> uses
            internally:
          </p>
          <CodeBlock
            language="typescript"
            code={`import { createRenderSession } from '@elah/cli'

const session = createRenderSession()
await session.warmup()
const mp4 = await session.render(project, '/path/to/assets')
// ... more session.render() calls reuse the same browser ...
await session.close()`}
          />
          <p className="mt-4 text-sm leading-relaxed text-on-surface-variant">
            Also exported: <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">startServe</code>,{' '}
            <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">validateSpec</code>,{' '}
            <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">probeMedia</code>. Errors
            throw <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">CliError</code> with a{' '}
            <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">.message</code> that is
            already the human-readable, path-addressed text.
          </p>
        </section>

        {/* Next */}
        <div className="rounded-md border border-outline-variant bg-surface-low p-5">
          <div className="label-mono mb-1 text-2xs text-on-surface-variant opacity-90">Up Next</div>
          <div className="text-sm font-medium text-on-surface mb-1">API Reference</div>
          <p className="text-xs leading-relaxed text-on-surface-variant mb-3">
            See the full public API across @elah/core, @elah/timeline, and @elah/editor.
          </p>
          <a href="/docs/api" className="text-xs font-medium text-primary hover:underline">
            Continue to API Reference →
          </a>
        </div>
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
