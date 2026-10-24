'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Check, Copy } from 'lucide-react'
import posthog from 'posthog-js'
import { trackPlaygroundLaunch } from '@/lib/analytics'
import { LazyDemo } from '@/components/home/LazyDemo'
import { btnLarge, btnPrimary, btnSecondary, container, headingSans, leadOnDark, mono, outline } from './ui'

const INSTALL = 'npm install @elah/core'
const PLAYGROUND = '/playground/motion'

/**
 * Hero (brief section 5, item 1; DESIGN.md "Hero + stage"). The stage is the
 * engine itself: an 8 s loop with its timeline under it, keyframe diamonds on
 * the clips, the playhead moving. Not a screen recording.
 */
export function HomeHero() {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  function copy() {
    try {
      void navigator.clipboard.writeText(INSTALL)
    } catch {
      // clipboard may be unavailable (insecure context); still show feedback
    }
    posthog.capture('install_command_copied', { command: INSTALL, package: '@elah/core' })
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1400)
  }

  return (
    <header className="bg-[#5A1218] pt-12 sm:pt-16">
      <div className={`${container}`}>
        <div className={`mx-auto flex max-w-[860px] flex-col items-center gap-6 rounded-[20px] bg-[#FFF5F3] px-6 py-10 text-center sm:px-10 ${outline}`}>
        <h1
          className={`m-0 max-w-[820px] text-[34px] leading-[38px] font-semibold tracking-[-1.4px] text-balance sm:text-[48px] sm:leading-[52px] sm:tracking-[-2px] ${headingSans}`}
        >
          <span className="block text-[#1B1416]">Write motion as code.</span>
          <span className="block text-[#1B1416]">It stays editable.</span>
        </h1>
        <p className={`${leadOnDark} max-w-[560px]`}>Open source. Renders in the browser.</p>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href={PLAYGROUND}
            className={`${btnPrimary} ${btnLarge}`}
            onClick={() => trackPlaygroundLaunch({ source: 'hero_motion_playground', title: 'Motion playground', href: PLAYGROUND, variant: 'full' })}
          >
            Try the motion playground
            <ArrowRight size={16} strokeWidth={2} aria-hidden />
          </Link>
          <button
            type="button"
            onClick={copy}
            aria-label={`Copy ${INSTALL}`}
            title={`Copy ${INSTALL}`}
            className={`${btnSecondary} ${btnLarge} ${mono} !font-medium`}
          >
            <span>$</span>
            {INSTALL}
            {copied ? <Check size={16} strokeWidth={2} aria-hidden /> : <Copy size={16} strokeWidth={2} aria-hidden />}
          </button>
        </div>
        <p className={`m-0 text-[12px] text-[#1B1416] ${mono}`}>The motion layer is coming in 1.0.</p>
        <Link href="/changelog" className={`text-[14px] text-[#1B1416] no-underline transition-colors hover:underline ${mono}`}>
          Coming in 1.0: the motion and programmatic layer. Read the changelog →
        </Link>
      </div>

      </div>

      <div className={`${container} mt-10 sm:mt-12`}>
        <figure className={`m-0 overflow-hidden rounded-t-[20px] border border-b-0 border-[#7A2A31] bg-[#170F10]`}>
          <div className="mx-auto w-full max-w-[880px]">
            <LazyDemo name="hero" label="Motion piece with its timeline" timelineHeight={300} minHeight={560} />
          </div>
          <figcaption className={`border-t border-[#F3E2DF] bg-[#FFF5F3] px-4 py-3 text-[12px] text-[#1B1416] ${mono}`}>
            Rendered by the engine. The diamonds are the keyframes, and the playhead is the timeline playing.
          </figcaption>
        </figure>
      </div>
    </header>
  )
}
