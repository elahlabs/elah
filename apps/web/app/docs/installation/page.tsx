import type { Metadata } from 'next'
import { CodeBlock } from '@/components/docs/CodeBlock'
import { DocsToc } from '@/components/docs/DocsToc'

export const metadata: Metadata = { title: 'Installation' }

const toc = [
  { id: 'requirements', title: 'Requirements', level: 2 },
  { id: 'npm-install', title: 'npm install', level: 2 },
  { id: 'workspace-setup', title: 'Workspace Setup', level: 2 },
  { id: 'vite-config', title: 'Vite / Webpack Config', level: 2 },
  { id: 'tsconfig', title: 'TypeScript Config', level: 2 },
]

export default function InstallationPage() {
  return (
    <div className="flex gap-12">
      <article className="min-w-0 flex-1 max-w-3xl">
        <div className="mb-8 pb-6 border-b border-outline-variant">
          <div className="label-mono mb-2 text-2xs text-on-surface-variant opacity-60">Getting Started</div>
          <h1
            id="installation"
            className="text-3xl font-semibold tracking-tight text-on-surface"
            style={{ fontFamily: 'var(--font-inter), sans-serif' }}
          >
            Installation
          </h1>
          <p className="mt-3 text-base leading-relaxed text-on-surface-variant">
            Add Precision Studio to your React application. The SDK ships as an npm workspace package — set it up as a monorepo dependency or install directly.
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
              { dep: 'mediabunny', version: '≥ 0.x', note: 'Required peer dependency for video demux and MP4 export' },
            ].map((row, i) => (
              <div
                key={row.dep}
                className={`flex items-start gap-4 border-b border-outline-variant p-3 last:border-0 ${i % 2 === 0 ? 'bg-white' : 'bg-surface-lowest'}`}
              >
                <div className="w-28 shrink-0 font-mono text-xs font-medium text-on-surface">{row.dep}</div>
                <div className="w-24 shrink-0 font-mono text-xs text-on-surface-variant">{row.version}</div>
                <div className="text-xs text-on-surface-variant">{row.note}</div>
              </div>
            ))}
          </div>
        </section>

        {/* npm install */}
        <section className="mb-10">
          <h2 id="npm-install" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Install
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            Clone the repository and install dependencies from the monorepo root:
          </p>
          <CodeBlock
            language="bash"
            filename="terminal"
            code={`git clone https://github.com/your-org/precision-studio.git
cd precision-studio/video-editor
npm install`}
          />
          <p className="mt-4 mb-4 text-sm leading-relaxed text-on-surface-variant">
            Start the playground dev server:
          </p>
          <CodeBlock
            language="bash"
            filename="terminal"
            code={`npm run dev
# → http://localhost:5173`}
          />
          <p className="mt-4 text-sm leading-relaxed text-on-surface-variant">
            Or install <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">@elah/editor</code> as a workspace dependency in your own app:
          </p>
          <CodeBlock
            language="json"
            filename="your-app/package.json"
            code={`{
  "dependencies": {
    "@elah/editor": "*",
    "mediabunny": "^0.x",
    "react": "^18",
    "react-dom": "^18"
  }
}`}
          />
        </section>

        {/* Workspace setup */}
        <section className="mb-10">
          <h2 id="workspace-setup" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Workspace Setup
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            The monorepo uses npm workspaces. The root <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">package.json</code> declares the workspace layout:
          </p>
          <CodeBlock
            language="json"
            filename="video-editor/package.json"
            code={`{
  "name": "myeditor",
  "private": true,
  "workspaces": [
    "packages/*",
    "apps/*"
  ],
  "scripts": {
    "dev": "npm run dev --workspace=apps/playground",
    "build": "npm run build --workspace=packages/editor",
    "typecheck": "tsc --build",
    "test": "npm run test --workspace=packages/core --workspace=packages/timeline"
  }
}`}
          />
          <p className="mt-4 text-sm leading-relaxed text-on-surface-variant">
            Packages are resolved by npm workspaces — <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">@elah/editor</code>, <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">@elah/core</code>, and <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">@elah/timeline</code> are symlinked into <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">node_modules</code> automatically.
          </p>
        </section>

        {/* Vite config */}
        <section className="mb-10">
          <h2 id="vite-config" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Vite Configuration
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            The playground uses Vite. Key configuration for WebCodecs and Worker support:
          </p>
          <CodeBlock
            language="typescript"
            filename="vite.config.ts"
            code={`import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['mediabunny'],
  },
  server: {
    headers: {
      // Required for SharedArrayBuffer (used by mediabunny)
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})`}
          />
        </section>

        {/* TypeScript config */}
        <section className="mb-10">
          <h2 id="tsconfig" className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-20" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            TypeScript Config
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            Project references are used for incremental builds across packages:
          </p>
          <CodeBlock
            language="json"
            filename="video-editor/tsconfig.json"
            code={`{
  "files": [],
  "references": [
    { "path": "./packages/core" },
    { "path": "./packages/timeline" },
    { "path": "./packages/editor" },
    { "path": "./apps/playground" }
  ]
}`}
          />
          <p className="mt-4 mb-4 text-sm leading-relaxed text-on-surface-variant">
            Each package has its own <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">tsconfig.json</code> extending a shared base:
          </p>
          <CodeBlock
            language="json"
            filename="packages/editor/tsconfig.json"
            code={`{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "composite": true,
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src"],
  "references": [
    { "path": "../core" },
    { "path": "../timeline" }
  ]
}`}
          />
        </section>

        {/* Next */}
        <div className="rounded-md border border-outline-variant bg-surface-low p-5">
          <div className="label-mono mb-1 text-2xs text-on-surface-variant opacity-60">Up Next</div>
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
