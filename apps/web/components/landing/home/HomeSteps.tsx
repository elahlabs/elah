'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Download } from 'lucide-react'
import { LoadOnView } from '@/components/motion/LoadOnView'
import { LazyDemo } from '@/components/home/LazyDemo'
import { getTitleCard } from '@/lib/motion/titleCard'
import { STARTERS } from '@/lib/motion/starters'
import type { Converted } from '@/lib/motion/convert'
import { Section } from './Section'
import { cardBody, cardTitle, cardWhite, mono, panel, sans } from './ui'

const TITLE_CARD = STARTERS[0]

function StepTimeline() {
  const [c, setC] = useState<Converted | null>(null)
  useEffect(() => {
    void getTitleCard().then(setC)
  }, [])
  if (!c) return <div aria-hidden className="min-h-[220px] bg-[#170F10]" />
  return <LazyDemo eager project={c.project} preview={false} timelineHeight={220} loop={false} label="The scene as clips and keys on a timeline" />
}

/** Write -> Timeline -> Export (brief section 5, item 3). */
export function HomeSteps() {
  return (
    <Section bg="blush" title="Write it like a web page, edit it like a timeline, render it in the browser.">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <article className={`${cardWhite} min-w-0`}>
          <div className="flex flex-col gap-[10px]">
            <p className={`m-0 text-[12px] text-[#77696B] ${mono}`}>1 · write</p>
            <h3 className={cardTitle}>An html scene</h3>
            <p className={cardBody}>
              The motion lives in a <code className={`text-[13px] text-[#1B1416] ${mono}`}>data-motion</code> attribute.
            </p>
          </div>
          <pre tabIndex={0} aria-label="Title card scene source" className={`${panel} m-0 max-h-[300px] flex-1 overflow-auto p-4 text-[12px] leading-[20px] text-[#1B1416] ${mono}`}>
            <code>{`${TITLE_CARD.html}\n\n${TITLE_CARD.css}`}</code>
          </pre>
        </article>

        <article className={`${cardWhite} min-w-0`}>
          <div className="flex flex-col gap-[10px]">
            <p className={`m-0 text-[12px] text-[#77696B] ${mono}`}>2 · timeline</p>
            <h3 className={cardTitle}>Clips and keys</h3>
            <p className={cardBody}>It lands as native clips and keyframes. Each key has an id, a frame, a value and an easing.</p>
          </div>
          <div className="flex-1 overflow-hidden ">
            <LoadOnView placeholder={<div aria-hidden className="min-h-[220px] bg-[#170F10]" />}>
              <StepTimeline />
            </LoadOnView>
          </div>
        </article>

        <article className={`${cardWhite} min-w-0`}>
          <div className="flex flex-col gap-[10px]">
            <p className={`m-0 text-[12px] text-[#77696B] ${mono}`}>3 · export</p>
            <h3 className={cardTitle}>Exported in your browser</h3>
            <p className={cardBody}>MP4 export runs on your own machine in Chrome or Edge. No render server, and nothing is uploaded.</p>
          </div>
          <div className="flex flex-1 flex-col justify-end gap-4">
            <div className={`${panel} flex items-center gap-3 p-4`}>
              <span className="grid h-10 w-10 shrink-0 place-items-center bg-[#FF003C] text-white">
                <Download size={18} strokeWidth={2} aria-hidden />
              </span>
              <div className="min-w-0">
                <div className={`text-[13px] text-[#1B1416] ${mono}`}>title-card.mp4</div>
                <div className={`text-[12px] text-[#77696B] ${sans}`}>Exported in your browser</div>
              </div>
            </div>
            <Link href="/playground/motion" className={`inline-flex items-center gap-2 text-[14px] font-semibold text-[#1B1416] no-underline transition-colors hover:text-[#FF003C] ${sans}`}>
              Try it in the playground
              <ArrowRight size={16} strokeWidth={2} aria-hidden />
            </Link>
          </div>
        </article>
      </div>
    </Section>
  )
}
