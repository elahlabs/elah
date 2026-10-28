import type { Metadata } from 'next'
import { Navbar } from '@/components/marketing/Navbar'
import { Footer } from '@/components/marketing/Footer'
import { PageHeader } from '@/components/site/PageHeader'
import { CopyButton } from '@/components/landing/CopyButton'
import { siteConfig } from '@/config/site'
import { GITHUB_URL } from '@/config/nav'
import {
  Slate, btnSecondary, btnSmall, cardBody, cardLight, cardTitle, container, h2, label, lead, mono, outline, sectionY,
} from '@/components/eb'

export const metadata: Metadata = {
  title: 'Elah for Claude',
  description:
    'The Elah plugin for Claude Code turns a brief into a video you can preview, edit and export as MP4 in the browser. The claude.ai artifact is live. Both use the open-source Elah engine.',
  alternates: { canonical: '/claude' },
}

/**
 * Two states behind `siteConfig.claude` (brief section 7.2). Every sentence in
 * the plugin card comes from plugins/elah/README.md; nothing is added.
 */
const PLUGIN_INSTALL = ['/plugin marketplace add elahlabs/elah', '/plugin install elah@elah']

/**
 * Screen recording of the artifact inside claude.ai (preview, edit, export).
 * Encoded from the raw capture to 1280x844 H.264, no audio; muted and looping,
 * with controls so it can be paused (WCAG 2.2.2).
 */
const ARTIFACT_VIDEO = { src: '/assets/claude-artifact.mp4', poster: '/assets/claude-artifact.jpg', width: 1280, height: 844 }

const tagCls = `shrink-0 bg-surface px-3 py-[3px] text-on-surface-variant ${label} ${outline}`
const codeCls = `bg-surface px-1.5 py-0.5 text-[12px] text-on-surface ${mono} ${outline}`

function Card({ title, tag, children }: { title: string; tag: string; children: React.ReactNode }) {
  return (
    <section className={`${cardLight} min-w-0`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className={cardTitle}>{title}</h2>
        <span className={tagCls}>{tag}</span>
      </div>
      {children}
    </section>
  )
}

function Cmd({ command }: { command: string }) {
  return (
    <div className={`flex items-center gap-2 bg-surface px-4 py-3 text-[12px] leading-[20px] text-on-surface ${mono} ${outline}`}>
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

        <section className={`${container} pt-12 ${sectionY}`}>
          <Slate n={1} label="Claude" kicker="Claude Code · claude.ai" />
          <div className="grid grid-cols-1 gap-4 pt-10 lg:grid-cols-2">
          {pluginLive ? (
            <Card title="Claude Code plugin" tag="Available">
              <p className={cardBody}>
                Make a video or motion graphic from Claude Code. Claude writes a programmatic video (HTML + CSS motion), the plugin validates it with the Elah engine, and an Elah artifact opens it for preview, editing and MP4 export in the browser. The plugin never renders a video itself.
              </p>
              <div className="flex flex-col gap-2">
                {PLUGIN_INSTALL.map((c) => (
                  <Cmd key={c} command={c} />
                ))}
              </div>
              <ul className={`m-0 flex list-none flex-col gap-3 p-0 ${cardBody}`}>
                <li>
                  <code className={codeCls}>/elah:video</code>{' '}
                  plans the beats, writes the video as HTML + CSS motion (a VideoSpec of Elah components when the brief needs sound or supplied images and audio), validates it and publishes the artifact.
                </li>
                <li>
                  <code className={codeCls}>/elah:promo</code>{' '}
                  runs the same flow with a fixed 15 to 30 second launch structure: hook, problem, product, three features, call to action.
                </li>
              </ul>
              <p className={cardBody}>
                In the artifact: Preview, Edit (keyframes and curves), and Export MP4, rendered in your browser. Run <code className={codeCls}>/reload-plugins</code> if the skills do not show up after installing.
              </p>
              <p className={`m-0 text-on-surface-variant ${label}`}>
                An unofficial, open-source plugin from the Elah project. Not made or endorsed by Anthropic.
              </p>
            </Card>
          ) : (
            <Card title="Claude Code plugin" tag="Coming soon">
              <p className={cardBody}>
                The plugin will let Claude write scenes and project files, check them with the Elah engine, and open the result on a timeline.
              </p>
            </Card>
          )}

          <Card title="claude.ai artifact" tag={artifactLive ? 'Available' : 'Coming soon'}>
            <p className={cardBody}>
              Ask Claude for a video in a chat, see it on a timeline, and export the MP4 in your own browser. No server, nothing uploaded.
            </p>
            <video
              className={`h-auto w-full bg-surface ${outline}`}
              src={ARTIFACT_VIDEO.src}
              poster={ARTIFACT_VIDEO.poster}
              width={ARTIFACT_VIDEO.width}
              height={ARTIFACT_VIDEO.height}
              autoPlay
              muted
              loop
              playsInline
              controls
              preload="metadata"
              aria-label="The Elah artifact running in claude.ai: preview, edit and export MP4"
            />
          </Card>
          </div>
        </section>

        <section className={`${container} ${sectionY}`}>
          <Slate n={2} label="Project" kicker="Open source" />
          <div className="flex flex-col gap-8 pt-10">
            <div className="flex max-w-[900px] flex-col gap-5">
              <h2 className={h2}>A video made in Claude is a normal project</h2>
              <p className={`${lead} max-w-[640px]`}>
                Because the plugin and the artifact use the open-source engine, you can open what Claude made and keep editing it later. Export uses Chrome or Edge.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <a href={GITHUB_URL} className={`${btnSecondary} ${btnSmall}`}>
                View on GitHub
              </a>
              <a href="/playground/motion" className={`${btnSecondary} ${btnSmall}`}>
                Try the motion playground
              </a>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
