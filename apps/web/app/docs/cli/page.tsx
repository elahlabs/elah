import type { Metadata } from 'next'
import { DocsToc } from '@/components/docs/DocsToc'
import { Code } from '@/components/docs/Code'
import { C, Callout, DocsPager, H2, H3, P, PropTable } from '@/components/docs/DocsKit'
import { PageHeader } from '@/components/site/PageHeader'

export const metadata: Metadata = {
  title: 'CLI & Server',
  description:
    'Run elah headlessly: the @elah/cli command line, the seconds-based build spec for AI-generated videos, and elah serve — a self-hosted HTTP render server that draws frames with the same code as the browser.',
  alternates: { canonical: '/docs/cli' },
}

const toc = [
  { id: 'install', title: 'Install', level: 2 },
  { id: 'commands', title: 'Commands', level: 2 },
  { id: 'build-spec', title: 'The build spec', level: 2 },
  { id: 'encoding', title: 'Formats & encoding', level: 2 },
  { id: 'serve', title: 'Serve mode', level: 2 },
  { id: 'rendering', title: 'How rendering works', level: 2 },
  { id: 'docker', title: 'Docker & self-hosting', level: 2 },
  { id: 'library-api', title: 'Library API', level: 2 },
]

const link = 'text-on-surface underline decoration-[#FF003C] underline-offset-4 hover:decoration-2'

export default function CliPage() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
      <article className="min-w-0 max-w-3xl flex-1">
        <PageHeader
          variant="doc"
          id="cli"
          eyebrow="CLI &amp; Server"
          title="CLI &amp; Server"
          lede="Run the same engine on a server: build projects from JSON, export video files, or run an HTTP render server. The frames are drawn by the same code as the browser editor."
        />

        <H2 id="install">Install</H2>
        <Code
          lang="bash"
          code={`
npm install -g @elah/cli
elah serve

# or without installing
npx @elah/cli serve`}
        />
        <PropTable
          nameLabel="Requirement"
          rows={[
            { name: 'Node.js 18.17+', desc: 'For every command.' },
            { name: 'Google Chrome', desc: <>For <C>export</C>, <C>build --export</C> and <C>serve</C>, which draw frames in a headless browser. Point at one with <C>--browser &lt;path&gt;</C> or <C>ELAH_BROWSER</C>.</> },
            { name: 'FFmpeg 4.4+', type: 'recommended', desc: <>Encodes the file when found, and converts sources Chrome cannot read. See <a href="#encoding" className={link}>Formats &amp; encoding</a>.</> },
          ]}
        />

        <H2 id="commands">Commands</H2>
        <PropTable
          nameLabel="Command"
          rows={[
            { name: 'elah build --spec spec.json', desc: <>Build a project from a seconds-based spec. Add <C>--out project.json</C> to save it, or <C>--export out.mp4</C> to render it.</> },
            { name: 'elah export --project in.json --out out.mp4', desc: 'Render a project to a video file in headless Chrome.' },
            { name: 'elah serve', desc: 'Run an HTTP render server with a browser kept warm.' },
            { name: 'elah split --project in.json --clip <id> --at <time>', desc: 'Split a clip. Plain Node, no browser.' },
            { name: 'elah trim --project in.json --clip <id>', desc: <>Change a clip&apos;s <C>--start</C> or <C>--duration</C>. Plain Node, no browser.</> },
          ]}
        />
        <P>
          <C>split</C> and <C>trim</C> print the new project JSON unless you pass <C>--out</C>. Times can be frames or a timecode (
          <C>SS:FF</C>, <C>MM:SS:FF</C> or <C>HH:MM:SS:FF</C>) at the project&apos;s frame rate.
        </P>
        <H3>Export options</H3>
        <PropTable
          nameLabel="Flag"
          rows={[
            { name: '--container mp4|webm', desc: 'Default: from the output file extension, else MP4.' },
            { name: '--codec avc|hevc|av1|vp9|vp8', desc: 'Default avc for MP4, vp9 for WebM.' },
            { name: '--height <N>', desc: 'The short edge in pixels, like "1080p". Works for landscape and portrait.' },
            { name: '--video-bitrate · --audio-bitrate', desc: 'Bits per second. Defaults 8 Mbps and 128 kbps.' },
            { name: '--encoder auto|ffmpeg|chrome', desc: 'Who compresses the frames. Default auto.' },
            { name: '--browser · --ffmpeg <path>', desc: 'Use a specific Chrome or FFmpeg.' },
            { name: '--timeout <s> · --headed · --verbose', desc: 'Time limit, show the browser window, print browser logs.' },
          ]}
        />
        <PropTable
          nameLabel="Exit code"
          rows={[
            { name: '0', desc: 'Success.' },
            { name: '1', desc: 'Validation or runtime failure. Details go to stderr.' },
            { name: '2', desc: 'Usage error: a wrong or missing flag.' },
          ]}
        />

        <H2 id="build-spec">The build spec</H2>
        <P>
          A small JSON format for describing a video, with times in seconds. It is easy for a model to write, and every error names the exact
          field (<C>clips[2].duration must be …</C>) so a model can fix its own mistakes.
        </P>
        <Code
          lang="json"
          title="spec.json"
          highlight={[4, 9]}
          code={`
{
  "fps": 30,
  "stage": { "width": 1920, "height": 1080 },
  "assets": {
    "footage": "./media/clip.mp4",
    "music": "./media/song.mp3",
    "logo": "./media/logo.png"
  },
  "clips": [
    { "track": "video", "asset": "footage", "start": 0, "duration": 8, "sourceStart": 2, "volume": 0.8 },
    { "track": "text", "text": "Hello", "start": 0.5, "duration": 4, "fontSize": 96, "color": "#ffffff", "x": 0.5, "y": 0.15 },
    { "track": "image", "asset": "logo", "start": 1, "duration": 6, "x": 0.9, "y": 0.1, "scale": 0.3 },
    { "track": "audio", "asset": "music", "start": 0, "duration": 8, "volume": 0.5 }
  ]
}`}
        />
        <Code lang="bash" code={`elah build --spec spec.json --export final.mp4`} />
        <PropTable
          nameLabel="Rule"
          rows={[
            { name: 'Times', desc: <>Seconds, decimals allowed, turned into whole frames at <C>fps</C> (default 30). <C>stage</C> defaults to 1920 × 1080.</> },
            { name: 'assets', desc: 'Names mapped to file paths (relative to the spec) or http(s) URLs. Each file is probed for its real length.' },
            { name: 'x · y · scale', desc: 'Where the clip’s centre sits, as a fraction of the stage, and its size relative to the original.' },
          ]}
        />
        <Callout kind="warning" title="Video clips must not overlap">
          The spec puts every video clip on a single video track, so overlapping video clips are an error. Overlapping text, image and audio clips
          are moved to extra tracks automatically. (The engine itself supports several video tracks; the spec format does not yet.)
        </Callout>

        <H2 id="encoding">Formats &amp; encoding</H2>
        <PropTable
          nameLabel="Container"
          rows={[
            { name: 'MP4', desc: 'Video avc (default), hevc or av1, with AAC audio.' },
            { name: 'WebM', desc: 'Video vp9 (default), vp8 or av1, with Opus audio.' },
          ]}
        />
        <P>
          Chrome always draws the frames, so the picture matches the editor. <C>--encoder</C> decides who compresses them into the file:
        </P>
        <PropTable
          nameLabel="--encoder"
          rows={[
            { name: 'auto', desc: 'FFmpeg when it is found and can write the codec; otherwise Chrome, with a warning saying why. The default.' },
            { name: 'ffmpeg', desc: 'FFmpeg, or fail.' },
            { name: 'chrome', desc: 'Chrome’s own encoder. FFmpeg is never looked for.' },
          ]}
        />
        <P>
          FFmpeg is found through <C>--ffmpeg</C>, then <C>ELAH_FFMPEG</C>, then your <C>PATH</C>. It is a system program, never an npm dependency.
          The last line of output says which encoder ran, for example <C>encoded by ffmpeg (libx264)</C>.
        </P>
        <Callout title="FFmpeg is currently the slower path">
          5 seconds of 1080p30 took 8.8 s with FFmpeg against 3.5 s with Chrome on the machine it was measured on, because each frame is saved as a
          PNG before FFmpeg sees it.
        </Callout>
        <H3>Sources Chrome cannot read</H3>
        <P>
          Before exporting, the CLI asks Chrome whether it can decode each video and audio file. If not, and FFmpeg is installed, the file is
          converted first:
        </P>
        <PropTable
          nameLabel="Source"
          rows={[
            { name: 'ProRes .mov', desc: 'Video re-encoded, PCM audio converted to AAC.' },
            { name: 'HEVC without a decoder', desc: 'Most Linux and Chromium builds. Video re-encoded, AAC copied.' },
            { name: 'AVI · WMV · FLV', desc: 'Everything re-encoded.' },
            { name: '.mkv with AC-3 or DTS', desc: 'Video copied, audio converted.' },
            { name: 'MPEG-TS (.ts)', desc: 'Repackaged, not re-encoded.' },
          ]}
        />

        <H2 id="serve">Serve mode</H2>
        <P>
          <C>elah serve</C> keeps one browser running, so each render only opens a new tab instead of starting Chrome:
        </P>
        <Code lang="bash" code={`elah serve --port 8080 --concurrency 2 --media-root ./assets`} />
        <PropTable
          nameLabel="Flag"
          rows={[
            { name: '--port', desc: 'Default 8080.' },
            { name: '--host', desc: 'Default 127.0.0.1, so only this machine can reach it.' },
            { name: '--concurrency', desc: 'Renders at once. Default 1.' },
            { name: '--media-root', desc: 'Where relative asset paths are read from. Default: the current folder.' },
            { name: '--timeout', desc: 'Seconds per render. Default 600.' },
          ]}
        />
        <H3>Endpoints</H3>
        <PropTable
          nameLabel="Route"
          rows={[
            { name: 'POST /render', desc: 'Body: a build spec. Waits for the render and responds with the video bytes.' },
            { name: 'GET /healthz', desc: <><C>{'{ status: "ok", browser: "connected" | "disconnected" }'}</C></> },
            { name: 'GET /', desc: 'A small welcome page.' },
          ]}
        />
        <PropTable
          nameLabel="Status"
          rows={[
            { name: '200', desc: 'The video.' },
            { name: '422', desc: 'The spec is invalid. The error names the field.' },
            { name: '413', desc: 'The request body is over 5 MiB.' },
            { name: '503', desc: <>All render slots are busy. Retry after the <C>Retry-After</C> header (5 seconds).</> },
            { name: '500', desc: 'The render failed.' },
          ]}
        />
        <Code lang="bash" code={`curl -X POST --data-binary @spec.json http://127.0.0.1:8080/render -o out.mp4`} />
        <Callout title="No job queue">
          Each request waits for its own render. When the server is full it answers 503, and the client retries.
        </Callout>

        <H2 id="rendering">How rendering works</H2>
        <P>
          <C>export</C> and <C>serve</C> open Chrome headlessly and run the engine&apos;s real <C>exportVideo</C> inside it: the same worker and the
          same frame code as export in the browser editor. There is no separate server renderer that could drift.
        </P>
        <Callout title="Same frames; the file bytes depend on the encoder">
          Every frame is identical to the editor&apos;s. When FFmpeg encodes, the compressed file differs byte for byte from a browser export, but
          the picture is the same.
        </Callout>

        <H2 id="docker">Docker &amp; self-hosting</H2>
        <P>
          <C>packages/cli</C> has a Dockerfile that installs Chrome and fonts and runs <C>elah serve</C>:
        </P>
        <Code
          lang="bash"
          code={`
docker build -f packages/cli/Dockerfile -t elah-render .
docker run -p 8080:8080 elah-render`}
        />
        <Callout kind="warning" title="There is no built-in authentication">
          Keep the server on <C>127.0.0.1</C>, or put it behind a proxy that handles auth. See{' '}
          <a href="https://github.com/elahlabs/elah/blob/main/docs/deploy-render-server.md" target="_blank" rel="noopener noreferrer" className={link}>
            docs/deploy-render-server.md
          </a>{' '}
          for systemd, hardening and performance notes.
        </Callout>

        <H2 id="library-api">Library API</H2>
        <P>Everything the commands do is importable, so you don&apos;t need to shell out or parse stderr:</P>
        <Code
          highlight={[3, 4]}
          code={`
import { build, exportProject } from '@elah/cli'

const { project } = await build({ spec: mySpec, baseDir: '/path/to/assets' })
const { bytes } = await exportProject(
  { project, outPath: 'out.mp4' },
  { onProgress: ({ frame, totalFrames }) => console.log(\`\${frame}/\${totalFrames}\`) },
)`}
        />
        <P>
          For many renders, <C>createRenderSession()</C> keeps the browser open between them. It is what <C>elah serve</C> uses:
        </P>
        <Code
          code={`
import { createRenderSession } from '@elah/cli'

const session = createRenderSession()
await session.warmup()
const mp4 = await session.render(project, '/path/to/assets')
// more session.render() calls reuse the same browser
await session.close()`}
        />
        <PropTable
          nameLabel="Also exported"
          rows={[
            { name: 'startServe', desc: 'Start the HTTP server from code.' },
            { name: 'validateSpec · specToProject', desc: 'Check a build spec, or turn it into a project.' },
            { name: 'probeMedia', desc: 'Read a media file’s length and size.' },
            { name: 'CliError', desc: 'Thrown on failure. Its message is already the readable, field-named text.' },
          ]}
        />

        <DocsPager href="/docs/cli" />
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
