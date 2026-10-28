import type { Metadata } from 'next'
import { Navbar } from '@/components/marketing/Navbar'
import { Footer } from '@/components/marketing/Footer'
import { PageHeader } from '@/components/site/PageHeader'
import { CopyButton } from '@/components/landing/CopyButton'
import { siteConfig } from '@/config/site'
import { GITHUB_URL } from '@/config/nav'

export const metadata: Metadata = {
  title: 'Elah for Claude',
  description:
    'The Elah plugin for Claude Code turns a brief into a video you can preview, edit and export as MP4 in the browser. A standalone claude.ai artifact is coming soon. Both use the open-source Elah engine.',
  alternates: { canonical: '/claude' },
}

/**
 * Two states behind `siteConfig.claude` (brief section 7.2). Every sentence in
 * the plugin card comes from plugins/elah/README.md; nothing is added.
 */
const PLUGIN_INSTALL = ['/plugin marketplace add elahlabs/elah', '/plugin install elah@elah']

function Card({ title, tag, children }: { title: string; tag: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border border-outline-variant bg-surface-low p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight text-on-surface">{title}</h2>
        <span className="label-mono border border-outline-variant px-2 py-0.5 text-2xs text-on-surface-variant">
          {tag}
        </span>
      </div>
      {children}
    </section>
  )
}

function Cmd({ command }: { command: string }) {
  return (
    <div className="flex items-center gap-2 border border-outline-variant bg-surface-container px-3 py-2 font-mono text-xs text-on-surface">
      <span className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap">{command}</span>
      <CopyButton text={command} />
    </div>
  )
}

export default function ClaudePage() {
  const pluginLive = siteConfig.claude.plugin
  const artifactLive = siteConfig.claude.artifact

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <Navbar />
      <main id="main" className="flex-1">
        <PageHeader
          eyebrow="Elah for Claude"
          title={pluginLive ? 'Make a video from Claude Code' : 'Elah for Claude: coming soon'}
          lede={
            <>
              Claude writes the video as data. Elah turns it into an ordinary project on a timeline that you can open, edit and export as MP4 in your own browser. Both the plugin and the artifact use the same open-source engine.
            </>
          }
        />

        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-4 py-12 sm:px-6 lg:grid-cols-2">
          {pluginLive ? (
            <Card title="Claude Code plugin" tag="Available">
              <p className="text-sm leading-relaxed text-on-surface-variant">
                Make a video or motion graphic from Claude Code. Claude writes a programmatic video (HTML + CSS motion), the plugin validates it with the Elah engine, and an Elah artifact opens it for preview, editing and MP4 export in the browser. The plugin never renders a video itself.
              </p>
              <div className="flex flex-col gap-2">
                {PLUGIN_INSTALL.map((c) => (
                  <Cmd key={c} command={c} />
                ))}
              </div>
              <ul className="space-y-1.5 text-sm text-on-surface-variant">
                <li>
                  <code className="bg-surface-container px-1.5 py-0.5 font-mono text-xs">/elah:video</code>{' '}
                  plans the beats, writes the video as HTML + CSS motion (a VideoSpec of Elah components when the brief needs sound or supplied images and audio), validates it and publishes the artifact.
                </li>
                <li>
                  <code className="bg-surface-container px-1.5 py-0.5 font-mono text-xs">/elah:promo</code>{' '}
                  runs the same flow with a fixed 15 to 30 second launch structure: hook, problem, product, three features, call to action.
                </li>
              </ul>
              <p className="text-sm leading-relaxed text-on-surface-variant">
                In the artifact: Preview, Edit (keyframes and curves), and Export MP4, rendered in your browser. Run <code className="bg-surface-container px-1.5 py-0.5 font-mono text-xs">/reload-plugins</code> if the skills do not show up after installing.
              </p>
              <p className="text-xs text-on-surface-variant">
                An unofficial, open-source plugin from the Elah project. Not made or endorsed by Anthropic.
              </p>
            </Card>
          ) : (
            <Card title="Claude Code plugin" tag="Coming soon">
              <p className="text-sm leading-relaxed text-on-surface-variant">
                The plugin will let Claude write scenes and project files, check them with the Elah engine, and open the result on a timeline.
              </p>
            </Card>
          )}

          <Card title="claude.ai artifact" tag={artifactLive ? 'Available' : 'Coming soon'}>
            <p className="text-sm leading-relaxed text-on-surface-variant">
              The artifact will let you ask Claude for a video in a chat, see it on a timeline, and export the MP4 in your own browser. No server, nothing uploaded.
            </p>
          </Card>
        </div>

        <div className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
          <div className="border border-outline-variant bg-surface-low p-6">
            <h2 className="text-lg font-semibold tracking-tight text-on-surface">A video made in Claude is a normal project</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-on-surface-variant">
              Because the plugin and the artifact use the open-source engine, you can open what Claude made and keep editing it later. Export uses Chrome or Edge.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <a
                href={GITHUB_URL}
                className="border border-outline-variant px-5 py-2.5 text-sm font-medium text-on-surface hover:bg-surface-container"
              >
                View on GitHub
              </a>
              <a
                href="/playground/motion"
                className="border border-outline-variant px-5 py-2.5 text-sm font-medium text-on-surface hover:bg-surface-container"
              >
                Try the motion playground
              </a>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}
