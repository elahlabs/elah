'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { trackPlaygroundLaunch } from '@/lib/analytics'
import { playgrounds } from '../landingData'
import { Section } from './Section'
import { Sel } from './Sel'
import { MiniLanes, TRACK, type MiniClip } from './MiniLanes'
import { btnSecondary, btnSmall, cardBody, cardTitle, cardWhite, mono, outline } from './ui'

const LANES: Record<string, { lanes: MiniClip[][]; playhead: number }> = {
  Motion: {
    playhead: 34,
    lanes: [
      [{ left: 2, width: 52, color: TRACK.motion, label: 'title', keys: [10, 34] }, { left: 56, width: 40, color: TRACK.motion, label: 'bar', keys: [20] }],
      [{ left: 14, width: 60, color: TRACK.mint, label: 'caption', keys: [18] }],
    ],
  },
  'Full Editor': {
    playhead: 52,
    lanes: [
      [{ left: 2, width: 48, color: TRACK.motion, label: 'intro.mp4' }, { left: 52, width: 44, color: TRACK.motion, label: 'b-roll.mp4' }],
      [{ left: 16, width: 30, color: TRACK.mint, label: 'Launch day' }],
      [{ left: 2, width: 94, color: TRACK.amber, label: 'music.mp3' }],
    ],
  },
  'Timeline Only': {
    playhead: 66,
    lanes: [
      [{ left: 4, width: 38, color: TRACK.motion, label: 'clip a' }, { left: 46, width: 30, color: TRACK.motion, label: 'clip b' }],
      [{ left: 20, width: 56, color: TRACK.mint, label: 'voice' }],
    ],
  },
  'Full Editor Demo': {
    playhead: 22,
    lanes: [
      [{ left: 2, width: 60, color: TRACK.motion, label: 'sample.mp4' }],
      [{ left: 24, width: 34, color: TRACK.mint, label: 'title' }],
      [{ left: 2, width: 70, color: TRACK.amber, label: 'sample.mp3' }],
    ],
  },
}

/** Playgrounds (brief section 5, item 7): the motion playground first. */
export function HomePlaygrounds() {
  return (
    <Section n={5} scene="Play" kicker="Live deployments" id="playgrounds" title={<>Launch a <Sel>playground.</Sel></>} intro="Each playground is a live deployment of the elah engine, running in your browser.">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {playgrounds.map((p) => {
          const v = LANES[p.title] ?? LANES['Full Editor']
          return (
            <article key={p.title} className={`${cardWhite} min-w-0 !p-5`}>
              <div className="flex flex-col gap-[10px]">
                <span className={`self-start bg-[var(--lp-paper)] px-3 py-[3px] text-[11px] uppercase tracking-[0.14em] text-[var(--lp-muted)] ${mono} ${outline}`}>
                  {p.badge === 'live' ? 'Live' : 'Experimental'}
                </span>
                <h3 className={cardTitle}>{p.title}</h3>
                <p className={cardBody}>{p.body}</p>
              </div>
              <div className="mt-auto flex flex-col gap-4">
                <MiniLanes lanes={v.lanes} playhead={v.playhead} />
                <Link
                  href={p.href}
                  className={`${btnSecondary} ${btnSmall} self-start`}
                  onClick={() => trackPlaygroundLaunch({ source: 'landing_playgrounds', title: p.title, href: p.href, variant: p.variant, status: p.badge })}
                >
                  Launch playground
                  <ArrowRight size={16} strokeWidth={2} aria-hidden />
                </Link>
              </div>
            </article>
          )
        })}
      </div>
    </Section>
  )
}
