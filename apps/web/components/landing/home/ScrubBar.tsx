'use client'

import { useEffect, useRef, useState } from 'react'
import { label, mono } from '@/components/eb'

const FPS = 30
/** The whole page plays as one minute of "footage". */
const PAGE_SECONDS = 60

interface Clip {
  name: string
  start: number
  end: number
  el: HTMLElement
}

function timecode(progress: number) {
  const f = Math.round(Math.min(1, Math.max(0, progress)) * PAGE_SECONDS * FPS)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `00:${pad(Math.floor(f / FPS / 60))}:${pad(Math.floor(f / FPS) % 60)}:${pad(f % FPS)}`
}

/**
 * A transport bar fixed to the bottom of the viewport: scrolling the page
 * scrubs it. Each `[data-scene]` section is a clip sized by its height, a
 * diamond marks where it starts, and a red playhead follows the scroll.
 * Clicking a clip jumps to its section.
 */
export function ScrubBar() {
  const [clips, setClips] = useState<Clip[]>([])
  const [progress, setProgress] = useState(0)
  const [head, setHead] = useState(0)
  const frame = useRef(0)

  useEffect(() => {
    function measure() {
      const total = document.documentElement.scrollHeight
      const els = [...document.querySelectorAll<HTMLElement>('[data-scene]')]
      setClips(
        els.map((el) => {
          const top = el.getBoundingClientRect().top + window.scrollY
          return { name: el.dataset.scene ?? '', start: top / total, end: (top + el.offsetHeight) / total, el }
        }),
      )
    }
    function onScroll() {
      cancelAnimationFrame(frame.current)
      frame.current = requestAnimationFrame(() => {
        const total = document.documentElement.scrollHeight
        const max = total - window.innerHeight
        setProgress(max > 0 ? window.scrollY / max : 0)
        // The playhead marks the reading line, 40% down the viewport, in page terms.
        setHead((window.scrollY + window.innerHeight * 0.4) / total)
      })
    }
    measure()
    onScroll()
    const ro = new ResizeObserver(measure)
    ro.observe(document.body)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      ro.disconnect()
      window.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame.current)
    }
  }, [])

  const active = clips.findIndex((c) => head >= c.start && head < c.end)

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] h-[44px] border-t border-[#2E2E33] bg-[#0E0E10] text-[#F0EFEA]">
      <div className="flex h-full items-stretch">
        <div className={`flex shrink-0 items-center gap-2 border-r border-[#2E2E33] px-4 ${label}`}>
          <span aria-hidden className="h-[8px] w-[8px] bg-[#FF003C]" />
          <span className="tabular-nums" aria-label="Page timecode">
            {timecode(progress)}
          </span>
        </div>
        <nav aria-label="Page sections" className="relative hidden flex-1 md:block">
          {clips.map((c, i) => (
            <button
              key={c.name}
              type="button"
              onClick={() => c.el.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className={`absolute bottom-[8px] top-[8px] overflow-hidden whitespace-nowrap border-r border-[#0E0E10] px-2 text-left text-[10px] uppercase tracking-[0.1em] transition-colors ${mono} ${
                i === active ? 'bg-[#FF003C] text-[#0E0E10]' : 'bg-[#242428] text-[#9A9993] hover:bg-[#2E2E33] hover:text-[#F0EFEA]'
              }`}
              style={{ left: `${c.start * 100}%`, width: `${(c.end - c.start) * 100}%` }}
            >
              <span aria-hidden className="absolute left-[3px] top-1/2 h-[6px] w-[6px] -translate-y-1/2 rotate-45 bg-current opacity-80" />
              <span className="pl-3">{c.name}</span>
            </button>
          ))}
          <div aria-hidden className="pointer-events-none absolute bottom-0 top-0 w-[2px] bg-[#FF003C]" style={{ left: `${head * 100}%` }}>
            <span className="absolute -left-[4px] top-0 h-0 w-0 border-x-[5px] border-t-[6px] border-x-transparent border-t-[#FF003C]" />
          </div>
        </nav>
        <div className="relative flex-1 md:hidden" aria-hidden>
          <div className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 bg-[#242428]" />
          <div className="absolute left-0 top-1/2 h-[2px] -translate-y-1/2 bg-[#FF003C]" style={{ width: `${progress * 100}%` }} />
        </div>
        <div className={`hidden shrink-0 items-center border-l border-[#2E2E33] px-4 text-[#9A9993] lg:flex ${label}`}>{FPS} FPS</div>
      </div>
    </div>
  )
}
