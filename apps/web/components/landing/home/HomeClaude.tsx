import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { siteConfig } from '@/config/site'
import { Section } from './Section'
import { Sel, btnSecondary, btnSmall, cardBody, cardLight, cardTitle, mono, outline } from '@/components/eb'
import { MiniLanes, TRACK } from './MiniLanes'

const PLUGIN_INSTALL = ['/plugin marketplace add elahlabs/elah', '/plugin install elah@elah']

/**
 * elah for Claude (brief section 5 item 6, section 7). Each card's state comes
 * from the flags in config/site.ts. Copy comes from plugins/elah/README.md and
 * the brief: no dates, no mocked chats, no logos.
 */
export function HomeClaude() {
  const { plugin, artifact } = siteConfig.claude
  const cards: { title: string; tag: string; body: string; install?: string[] }[] = [
    {
      title: 'Claude Code plugin',
      install: plugin ? PLUGIN_INSTALL : undefined,
      tag: plugin ? 'Available' : 'Coming soon',
      body: plugin
        ? 'Run /elah:video or /elah:promo with a short brief. Claude writes the video, the plugin validates it with the elah engine, and an artifact opens it for preview, editing and mp4 export.'
        : 'Claude will write scenes and project files, check them, and open the result on a timeline.',
    },
    {
      title: 'claude.ai artifact',
      tag: artifact ? 'Available' : 'Coming soon',
      body: 'Ask Claude for a video in a chat, see it on a timeline, and export the mp4 in your own browser. No server, nothing uploaded.',
    },
  ]
  return (
    <Section
      n={4} scene="Claude" kicker="Claude Code · claude.ai"
      title={plugin ? <>Make a video from <Sel>Claude Code.</Sel></> : <>elah for Claude is coming <Sel>soon.</Sel></>}
      intro={plugin ? 'Install the plugin, describe the video, and Claude writes it as HTML and CSS motion. elah turns it into a normal project on a timeline that you can open, edit and export as mp4 in your own browser.' : 'Claude writes the video as data. elah turns it into a normal project on a timeline that you can open, edit and export as mp4 in your own browser.'}
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {cards.map((c) => (
          <article key={c.title} className={`${cardLight} min-w-0`}>
            <div className="flex flex-col gap-[10px]">
              <div className="flex items-center justify-between gap-3">
                <h3 className={cardTitle}>{c.title}</h3>
                <span className={`shrink-0 bg-[var(--lp-card)] px-3 py-[3px] text-[11px] uppercase tracking-[0.14em] text-[var(--lp-muted)] ${mono} ${outline}`}>{c.tag}</span>
              </div>
              <p className={cardBody}>{c.body}</p>
            </div>
            {c.install ? (
              <pre className={`m-0 overflow-x-auto bg-[var(--lp-paper)] px-4 py-3 text-[12px] leading-[20px] text-[var(--lp-ink)] ${mono} ${outline}`}>
                <code>{c.install.join('\n')}</code>
              </pre>
            ) : null}
            <MiniLanes
              playhead={38}
              lanes={[
                [{ left: 2, width: 46, color: TRACK.motion, label: 'title', keys: [8, 30] }, { left: 50, width: 46, color: TRACK.motion, label: 'scene', keys: [60] }],
                [{ left: 12, width: 60, color: TRACK.mint, label: 'caption' }],
              ]}
            />
          </article>
        ))}
      </div>
      <div>
        <Link href="/claude" className={`${btnSecondary} ${btnSmall}`}>
          More on elah for Claude
          <ArrowRight size={16} strokeWidth={2} aria-hidden />
        </Link>
      </div>
    </Section>
  )
}
