import type { Metadata } from 'next'
import { CodeBlock } from '@/components/docs/CodeBlock'
import { DocsToc } from '@/components/docs/DocsToc'

export const metadata: Metadata = {
  title: 'Installation',
  description:
    'Install @elah/editor and its peer dependencies, and configure Next.js or Vite to run the elah video editor SDK.',
  alternates: { canonical: '/docs/installation' },
}

const toc = [
  { id: 'requirements', title: 'Requirements', level: 2 },
  { id: 'npm-install', title: 'Install', level: 2 },
  { id: 'peer-deps', title: 'Peer Dependencies', level: 2 },
  { id: 'nextjs-config', title: 'Next.js Setup', level: 2 },
  { id: 'vite-config', title: 'Vite Setup', level: 2 },
]

export default function InstallationPage() {
  return (
    <div className="flex gap-12">
      <article className="min-w-0 flex-1 max-w-3xl">
        <div className="mb-8 pb-6 border-b border-outline-variant">
          <div className="label-mono mb-2 text-2xs text-on-surface-variant opacity-90">Getting Started</div>
          <h1
            id="installation"
            className="text-3xl font-semibold tracking-tight text-on-surface"
            style={{ fontFamily: 'var(--font-inter), sans-serif' }}
          >
            Installation
          </h1>
          <p className="mt-3 text-base leading-relaxed text-on-surface-variant">
            Add elah to your React application. The SDK is published to npm as{' '}
            <code className="rounded bg-surface-container px-1.5 py-0.5 text-sm font-mono">@elah/editor</code> — install it with your package manager and wire it into Next.js or Vite.
          </p>
        </div>

        {/* Requirements */}
        <section className="mb-10">
          <h2 id="requirements" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Requirements
          </h2>
          <div className="overflow-hidden rounded-md border border-outline-variant">
            {[
              { dep: 'React', version: '≥ 18.0', note: 'Concurrent mode required for Zustand subscription performance' },
              { dep: 'TypeScript', version: '≥ 5.0', note: 'Strict mode recommended' },
              { dep: 'Node.js', version: '≥ 18.0', note: 'Required for build tooling' },
              { dep: 'Browser', version: 'Chromium 108+', note: 'WebCodecs + WebGL2 required; Firefox partial support' },
              { dep: 'mediabunny', version: 'bundled', note: 'Ships as a dependency of @elah/core — no separate install needed' },
            ].map((row, i) => (
              <div
                key={row.dep}
                className={`flex items-start gap-4 border-b border-outline-variant p-3 last:border-0 ${i % 2 === 0 ? 'bg-surface-low' : 'bg-surface-lowest'}`}
              >
                <div className="w-28 shrink-0 font-mono text-xs font-medium text-on-surface">{row.dep}</div>
                <div className="w-24 shrink-0 font-mono text-xs text-on-surface-variant">{row.version}</div>
                <div className="text-xs text-on-surface-variant">{row.note}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Install */}
        <section className="mb-10">
          <h2 id="npm-install" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Install
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            Install <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">@elah/editor</code>. The decode/export backend (<code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">mediabunny</code>) ships bundled — there's nothing else to add:
          </p>
          <CodeBlock
            language="bash"
            filename="npm"
            code={`npm install @elah/editor`}
          />
          <p className="mt-4 mb-4 text-sm leading-relaxed text-on-surface-variant">
            Using a different package manager:
          </p>
          <CodeBlock
            language="bash"
            filename="pnpm / yarn / bun"
            code={`pnpm add @elah/editor
yarn add @elah/editor
bun add @elah/editor`}
          />
        </section>

        {/* Peer dependencies */}
        <section className="mb-10">
          <h2 id="peer-deps" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Peer Dependencies
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">@elah/editor</code> only expects React to be provided by your app — <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">mediabunny</code> and the rest of the pipeline are pulled in transitively. A typical <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">package.json</code> looks like:
          </p>
          <CodeBlock
            language="json"
            filename="package.json"
            code={`{
  "dependencies": {
    "@elah/editor": "^0.2.0",
    "react": "^18 || ^19",
    "react-dom": "^18 || ^19"
  }
}`}
          />
          <p className="mt-4 text-sm leading-relaxed text-on-surface-variant">
            The package ships ESM with bundled TypeScript declarations — no separate{' '}
            <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">@types</code> install required.
          </p>
        </section>

        {/* Next.js setup */}
        <section className="mb-10">
          <h2 id="nextjs-config" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Next.js Setup
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            Add the SDK packages to <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">transpilePackages</code> so the bundler can resolve the export Web Worker that <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">@elah/core</code> spawns via <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">new URL('./ExportWorker.js', import.meta.url)</code>:
          </p>
          <CodeBlock
            language="javascript"
            filename="next.config.mjs"
            code={`/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @elah/editor (+ its @elah/core / @elah/timeline deps) and mediabunny
  // ship modern ESM that must be transpiled by the consuming app.
  transpilePackages: ['@elah/editor', '@elah/core', '@elah/timeline', 'mediabunny'],
}

export default nextConfig`}
          />
          <p className="mt-4 mb-4 text-sm leading-relaxed text-on-surface-variant">
            The editor touches browser-only APIs (Canvas, Web Audio, Workers), so render it client-side only with a dynamic import:
          </p>
          <CodeBlock
            language="tsx"
            filename="app/editor/page.tsx"
            code={`'use client'

import dynamic from 'next/dynamic'

// ssr: false keeps the editor out of the server bundle.
const Editor = dynamic(() => import('@/components/Editor'), {
  ssr: false,
})

export default function Page() {
  return <Editor />
}`}
          />
        </section>

        {/* Vite setup */}
        <section className="mb-10">
          <h2 id="vite-config" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Vite Setup
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            Serve the SDK packages from their real files (instead of esbuild's pre-bundle) so the <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">new URL(...)</code> worker reference inside <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">@elah/core</code> resolves correctly:
          </p>
          <CodeBlock
            language="typescript"
            filename="vite.config.ts"
            code={`import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  worker: {
    // @elah/core spawns the MP4 export worker as a module worker.
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['@elah/editor', '@elah/core', '@elah/timeline', 'mediabunny'],
  },
})`}
          />
        </section>

        {/* Next */}
        <div className="rounded-md border border-outline-variant bg-surface-low p-5">
          <div className="label-mono mb-1 text-2xs text-on-surface-variant opacity-90">Up Next</div>
          <div className="text-sm font-medium text-on-surface mb-1">Quick Start</div>
          <p className="text-xs leading-relaxed text-on-surface-variant mb-3">
            Build the full editor in under 20 lines — wire your demuxer, mount Preview, and add the Timeline.
          </p>
          <a href="/docs/getting-started" className="text-xs font-medium text-primary hover:underline">
            Continue to Quick Start →
          </a>
        </div>
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
