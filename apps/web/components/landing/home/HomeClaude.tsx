import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { siteConfig } from '@/config/site'
import { Section } from './Section'
import { MiniLanes, TRACK } from './MiniLanes'
import { btnSecondary, btnSmall, cardBody, cardLight, cardTitle, mono, outline } from './ui'

/**
 * elah in Claude teaser (brief section 5 item 6, section 7). "Coming soon"
 * until the flags in config/site.ts change. Copy comes from the plugin README
 * and the brief: no dates, no mocked chats, no logos.
 */
export function HomeClaude() {
  const { plugin, artifact } = siteConfig.claude
  const cards = [
    {
      title: 'Claude Code plugin',
      tag: plugin ? 'Available' : 'Coming soon',
      body: plugin
        ? 'Claude writes the video, the plugin validates it with the elah engine, and an artifact opens it for preview, editing and mp4 export.'
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
      bg="white"
      title={plugin ? 'Make a video from Claude Code.' : 'elah for Claude is coming soon.'}
      intro="Claude writes the video as data. elah turns it into a normal project on a timeline that you can open, edit and export as mp4 in your own browser."
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {cards.map((c) => (
          <article key={c.title} className={`${cardLight} min-w-0`}>
            <div className="flex flex-col gap-[10px]">
              <div className="flex items-center justify-between gap-3">
                <h3 className={cardTitle}>{c.title}</h3>
                <span className={`shrink-0 rounded-full bg-white px-3 py-[3px] text-[12px] text-[#77696B] ${mono} ${outline}`}>{c.tag}</span>
              </div>
              <p className={cardBody}>{c.body}</p>
            </div>
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
