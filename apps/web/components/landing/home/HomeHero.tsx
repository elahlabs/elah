'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Check, Copy } from 'lucide-react'
import posthog from 'posthog-js'
import { LazyDemo } from '@/components/home/LazyDemo'
import { CropMarks, Sel, btnLarge, btnPrimary, btnSecondary, btnSmall, container, display, label, lead } from '@/components/eb'
import { creatorUrl } from '@/config/nav'

const INSTALL = 'npm install @elah/editor'
const CLAUDE = '/claude'
const CREATOR = creatorUrl('hero')
const FPS = 30

/**
 * A record timecode that runs from mount; frozen at zero for reduced motion.
 * Its own component so the ticking re-renders only this span, not the stage.
 */
function RecTimecode() {
  const [frames, setFrames] = useState(0)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const t0 = performance.now()
    let raf = 0
    const tick = (now: number) => {
      setFrames(Math.floor(((now - t0) / 1000) * FPS))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  const pad = (n: number) => String(n).padStart(2, '0')
  const s = Math.floor(frames / FPS)
  return <span className="tabular-nums">{`${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(frames % FPS)}`}</span>
}

/**
 * Hero: the headline sits in a viewfinder (crop marks, a centre cross, a
 * running REC timecode), and under it the program monitor plays the engine
 * itself: an 8 s loop with its timeline, keyframe diamonds and playhead.
 *
 * On desktop the headline and its padding scale with the viewport height, so
 * the viewfinder and the changelog strip fit in one screen between the sticky
 * nav and the scrub bar (148px type from about 830px tall, smaller below).
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
    <header data-scene="Open" className="pt-6 sm:pt-8 lg:pt-[clamp(8px,2svh,32px)]">
      <div className={container}>
        <div className={`flex items-center justify-between gap-4 py-3 text-[var(--lp-ink)] ${label}`}>
          <span className="flex items-center gap-2">
            <span aria-hidden className="h-[8px] w-[8px] animate-pulse bg-[#FF003C] motion-reduce:animate-none" />
            REC <RecTimecode />
          </span>
          <span className="hidden text-[var(--lp-muted)] sm:inline">Open source · Apache-2.0</span>
        </div>

        <div className="relative px-5 py-12 sm:px-10 sm:py-16 lg:py-[clamp(20px,4.5svh,80px)]">
          <CropMarks size={18} />
          <span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-[22px] w-px -translate-y-1/2 bg-[var(--lp-line)]" />
          <span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-px w-[22px] -translate-x-1/2 bg-[var(--lp-line)]" />

          <h1 className={`relative m-0 text-[64px] font-extrabold leading-[0.86] tracking-[-0.5px] text-[var(--lp-ink)] sm:text-[112px] lg:text-[clamp(72px,calc((100svh_-_440px)/2.6),148px)] ${display}`}>
            <span className="block">Write motion</span>
            <span className="block">
              as <Sel>code.</Sel>
            </span>
            <span className="block">It stays editable.</span>
          </h1>

          <div className="relative mt-10 flex flex-col gap-6 lg:mt-[clamp(16px,3.5svh,48px)] lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-col gap-3">
              <p className={`${lead} max-w-[440px]`}>Open source. Renders in the browser.</p>
              <p className={`m-0 text-[var(--lp-muted)] ${label}`}>New in 1.0: the motion layer.</p>
            </div>
            <div className="flex flex-col gap-4 lg:items-end">
              <div className="flex flex-wrap items-center gap-3">
                <a href={CREATOR} onClick={() => posthog.capture('creator_cta_clicked', { placement: 'hero' })} className={`${btnPrimary} ${btnLarge}`}>
                  Try Elah Creator
                  <ArrowRight size={15} strokeWidth={2} aria-hidden />
                </a>
                <Link href={CLAUDE} className={`${btnSecondary} ${btnLarge}`}>
                  Try the Claude plugin
                  <ArrowRight size={15} strokeWidth={2} aria-hidden />
                </Link>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className={`text-[var(--lp-muted)] ${label}`}>Building with code?</span>
                <button type="button" onClick={copy} aria-label={`Copy ${INSTALL}`} title={`Copy ${INSTALL}`} className={`${btnSecondary} ${btnSmall} !normal-case !tracking-normal`}>
                  <span aria-hidden>$</span>
                  {INSTALL}
                  {copied ? <Check size={13} strokeWidth={2} aria-hidden /> : <Copy size={13} strokeWidth={2} aria-hidden />}
                </button>
              </div>
            </div>
          </div>
        </div>

        <Link
          href="/changelog"
          className={`flex items-center justify-between gap-4 border-y border-[var(--lp-line)] py-3 text-[var(--lp-ink)] no-underline transition-colors hover:bg-[var(--lp-paper2)] ${label}`}
        >
          <span>elah 1.0 is out: the motion and programmatic layer.</span>
          <span className="shrink-0">Read the changelog →</span>
        </Link>

        <figure className="m-0 mt-10 bg-[var(--lp-stage)] [outline:1px_solid_var(--lp-stage-line)] sm:mt-12">
          <div className={`flex items-center justify-between gap-4 border-b border-[#2E2E33] px-4 py-3 text-[#9A9993] ${label}`}>
            <span>
              <span className="text-[#F0EFEA]">Program</span> · hero.json
            </span>
            <span className="hidden sm:inline">{FPS} fps · 8.0 s loop</span>
          </div>
          <div className="mx-auto w-full max-w-[880px]">
            <LazyDemo name="hero" label="Motion piece with its timeline" timelineHeight={300} minHeight={600} editableKeys />
          </div>
          <figcaption className={`border-t border-[#2E2E33] px-4 py-3 text-[#9A9993] ${label}`}>
            Rendered by the engine. The diamonds are the keyframes, and the playhead is the timeline playing.
          </figcaption>
        </figure>
      </div>
    </header>
  )
}
