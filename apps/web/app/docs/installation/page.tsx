import type { Metadata } from 'next'
import Link from 'next/link'
import { DocsToc } from '@/components/docs/DocsToc'
import { Code } from '@/components/docs/Code'
import { C, Callout, DocsPager, H2, P, PropTable } from '@/components/docs/DocsKit'
import { currentVersion } from '@/config/changelog'
import { PageHeader } from '@/components/site/PageHeader'

export const metadata: Metadata = {
  title: 'Installation',
  description:
    'Install @elah/editor and its peer dependencies, import the three stylesheets, and configure Next.js or Vite to run the elah video editor SDK.',
  alternates: { canonical: '/docs/installation' },
}

const toc = [
  { id: 'requirements', title: 'Requirements', level: 2 },
  { id: 'npm-install', title: 'Install', level: 2 },
  { id: 'stylesheets', title: 'Stylesheets', level: 2 },
  { id: 'nextjs-config', title: 'Next.js setup', level: 2 },
  { id: 'vite-config', title: 'Vite setup', level: 2 },
  { id: 'peer-deps', title: 'Packages & peer dependencies', level: 2 },
  { id: 'cli-install', title: 'CLI (optional)', level: 2 },
]

const link = 'text-on-surface underline decoration-[#FF003C] underline-offset-4 hover:decoration-2'

export default function InstallationPage() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
      <article className="min-w-0 max-w-3xl flex-1">
        <PageHeader
          variant="doc"
          id="installation"
          eyebrow="Getting Started"
          title="Installation"
          lede="Three steps: install the package, import its stylesheets, and add two lines of bundler config for the export worker."
        />

        <H2 id="requirements">Requirements</H2>
        <PropTable
          nameLabel="Need"
          rows={[
            { name: 'React', type: '18 or newer', desc: 'With react-dom. React 19 works.' },
            { name: 'A bundler', type: 'Vite or Next.js', desc: 'Both are covered below. Others work if they handle module workers.' },
            { name: 'Browser', type: 'Chromium 108+', desc: 'Chrome, Edge, Arc, Brave. Needs WebGL2, WebCodecs, Web Workers and OffscreenCanvas. Firefox: the preview works, export depends on codecs.' },
          ]}
        />
        <P>
          The packages ship ESM with their own TypeScript types, so there is no <C>@types</C> package to add.
        </P>

        <H2 id="npm-install">Install</H2>
        <Code lang="bash" code={`npm install @elah/editor lucide-react`} />
        <P>
          <C>@elah/editor</C> brings in <C>@elah/core</C>, <C>@elah/react</C>, <C>@elah/timeline</C> and the media library <C>mediabunny</C>.{' '}
          <C>lucide-react</C> supplies the timeline&apos;s icons.
        </P>
        <Code
          lang="bash"
          title="pnpm / yarn / bun"
          code={`
pnpm add @elah/editor lucide-react
yarn add @elah/editor lucide-react
bun add @elah/editor lucide-react`}
        />
        <Callout kind="warning" title="Always install lucide-react yourself">
          It is a peer dependency. npm adds peers automatically, so leaving it out can seem to work, but pnpm, yarn and most AI app builders do
          not, and the build then fails.
        </Callout>

        <H2 id="stylesheets">Stylesheets</H2>
        <P>Import all three, once, at your app&apos;s root, in this order:</P>
        <Code
          code={`
import '@elah/timeline/styles.css'      // ruler, tracks, clips, playhead
import '@elah/editor/styles.css'        // Preview and the panels
import '@elah/editor/styles/tokens.css' // the --elah-* colours both read
import './app.css'                      // yours last, so it wins`}
        />
        <P>Then wrap the editor in an element with the <C>elah-root</C> class, which is where those colours apply:</P>
        <Code
          highlight={[2]}
          code={`
<EditorProvider fps={30}>
  <div className="elah-root" style={{ height: '100vh' }}>
    {/* Preview, Timeline, AssetPanel… */}
  </div>
</EditorProvider>`}
        />
        <Callout kind="warning" title="The most common setup mistake">
          Each package&apos;s stylesheet only covers its own components. Importing just <C>@elah/editor/styles.css</C> leaves the timeline
          half-styled with missing colours. The stylesheets are plain CSS, so you do not need Tailwind. To change colours, see{' '}
          <Link href="/docs/theming" className={link}>
            Theming
          </Link>
          .
        </Callout>

        <H2 id="nextjs-config">Next.js setup</H2>
        <P>
          List the packages in <C>transpilePackages</C>. Without it the build fails, and Next.js cannot bundle the export worker that{' '}
          <C>@elah/core</C> starts.
        </P>
        <Code
          lang="js"
          title="next.config.mjs"
          highlight={[3]}
          code={`
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@elah/editor', '@elah/core', '@elah/react', '@elah/timeline', 'mediabunny'],
}

export default nextConfig`}
        />
        <P>The editor uses browser-only APIs, so load it on the client only:</P>
        <Code
          title="app/editor/page.tsx"
          highlight={[5]}
          code={`
'use client'

import dynamic from 'next/dynamic'

const Editor = dynamic(() => import('@/components/Editor'), { ssr: false })

export default function Page() {
  return <Editor />
}`}
        />

        <H2 id="vite-config">Vite setup</H2>
        <Code
          lang="ts"
          title="vite.config.ts"
          highlight={[6, 8]}
          code={`
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  optimizeDeps: {
    exclude: ['@elah/editor', '@elah/core', '@elah/react', '@elah/timeline', 'mediabunny'],
  },
})`}
        />
        <PropTable
          nameLabel="Setting"
          rows={[
            { name: "worker.format: 'es'", desc: 'The export runs in a module worker. Vite’s default worker format cannot use imports, so export crashes without this.' },
            { name: 'optimizeDeps.exclude', desc: 'Vite’s pre-bundling rewrites the worker’s file reference. Excluding the packages keeps it intact.' },
          ]}
        />
        <Callout kind="warning" title="Both settings are required">
          Leave either out and the editor still runs, but MP4 export fails when someone tries it.
        </Callout>
        <Callout title="Working copies of all of this">
          The repo&apos;s{' '}
          <Link href="/examples" className={link}>
            examples
          </Link>{' '}
          apply every setting on this page: a minimal Vite starter, a full Vite editor, and a Next.js version.
        </Callout>

        <H2 id="peer-deps">Packages &amp; peer dependencies</H2>
        <Code
          lang="json"
          title="package.json"
          code={`
{
  "dependencies": {
    "@elah/editor": "^${currentVersion}",
    "lucide-react": "^0.400.0",
    "react": "^18 || ^19",
    "react-dom": "^18 || ^19"
  }
}`}
        />
        <PropTable
          nameLabel="Package"
          rows={[
            { name: '@elah/editor', desc: 'The full SDK: EditorProvider, Preview, panels, and everything below re-exported. Start here.' },
            { name: '@elah/react', desc: <>Only the hooks, for your own UI on the engine. See <Link href="/docs/react" className={link}>@elah/react</Link>.</> },
            { name: '@elah/core', desc: 'The engine, renderer and export. No React.' },
            { name: '@elah/timeline', desc: 'The Timeline component on its own.' },
          ]}
        />
        <P>
          <C>@elah/core</C>, <C>@elah/react</C>, <C>@elah/timeline</C> and <C>@elah/editor</C> are released together and share a version.
        </P>

        <H2 id="cli-install">CLI (optional)</H2>
        <P>To render video on a server, install the CLI. It draws every frame with the same code as the editor:</P>
        <Code lang="bash" code={`npm install -g @elah/cli`} />
        <P>
          It needs Node.js 18.17 or newer and Google Chrome. See{' '}
          <Link href="/docs/cli" className={link}>
            CLI &amp; Server
          </Link>
          .
        </P>

        <DocsPager href="/docs/installation" />
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
