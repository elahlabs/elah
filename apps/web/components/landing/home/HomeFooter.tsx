'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { footerColumns, GITHUB_URL } from '@/config/nav'
import { MARK, btnDark, btnSmall, outline, sans } from './ui'

function GitHubLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-current" aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.4-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
    </svg>
  )
}

/**
 * Footer (DESIGN.md section 6): the carousel colour hangs into the top edge
 * between two mirrored curves, dashed threads trace it, and the elah mark pops
 * out of the notch. Link columns come from `config/nav.ts`.
 */
export function HomeFooter({ stars = null }: { stars?: string | null }) {
  const ref = useRef<HTMLElement>(null)
  const [near, setNear] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { rootMargin: '0px 0px -60px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <footer ref={ref} className="relative w-full bg-[#5A1218]">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[55px]">
        <div className="absolute inset-x-0 top-0 h-[4px] bg-[#6A1A22]" />
        <div className="absolute left-[calc(50%-58px)] top-0 h-[51px] w-[116px] bg-[#6A1A22]" />
        {(['left', 'right'] as const).map((side) => (
          <svg
            key={side}
            viewBox="0 0 100 52"
            preserveAspectRatio="none"
            className={`absolute top-[3px] h-[52px] w-[calc(50%-58px)] ${side === 'left' ? 'left-0' : 'right-0 -scale-x-100'}`}
          >
            <path d="M0 0 L0 1 C 45 1, 62 48, 100 48 L100 0 Z" fill="#6A1A22" />
          </svg>
        ))}
      </div>

      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-[3px] h-[52px]">
        {(['left', 'right'] as const).map((side) => (
          <svg
            key={side}
            viewBox="0 0 100 52"
            preserveAspectRatio="none"
            className={`absolute top-0 h-[52px] w-[calc(50%-58px)] transition-[clip-path] duration-700 ease-out motion-reduce:transition-none ${
              side === 'left' ? 'left-0' : 'right-0 -scale-x-100'
            } ${near ? '[clip-path:inset(0_0_0_0)]' : '[clip-path:inset(0_100%_0_0)]'}`}
          >
            <path d="M0 1 C 45 1, 62 48, 100 48" fill="none" stroke="#C99A9A" strokeWidth="1.5" strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />
          </svg>
        ))}
      </div>
      <div className="pointer-events-none absolute left-1/2 top-[3px] -translate-x-1/2">
        <span
          aria-hidden="true"
          style={{ transitionDelay: near ? '250ms' : '0ms', backgroundImage: `url(${MARK})` }}
          className={`block h-[92px] w-[92px] origin-top rounded-[24px] bg-cover bg-center shadow-[0_14px_30px_-10px_rgba(27,20,22,0.45)] transition-[opacity,transform] duration-700 ease-[cubic-bezier(0.3,1.5,0.5,1)] motion-reduce:transition-none ${
            near ? 'translate-y-0 rotate-0 scale-100 opacity-100' : '-translate-y-6 -rotate-6 scale-50 opacity-0'
          }`}
        />
      </div>

      <div className="mx-auto flex w-full max-w-[1440px] flex-col items-center gap-10 px-4 pb-16 pt-[128px] sm:px-8 sm:pt-[136px] lg:px-[88px]">
       <div className={`flex w-full max-w-[1000px] flex-col items-center gap-10 rounded-[20px] bg-[#FFF5F3] p-6 sm:p-10 ${outline}`}>
        <nav aria-label="Footer" className="grid w-full max-w-[920px] grid-cols-1 gap-8 sm:grid-cols-3">
          {footerColumns.map((col) => (
            <div key={col.heading} className="flex flex-col gap-3">
              <p className={`m-0 text-[16px] font-semibold tracking-[-0.3px] text-[#1B1416] ${sans}`}>{col.heading}</p>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {col.links.map((l) => {
                  const external = !l.href.startsWith('/')
                  const cls = `text-[14px] text-[#1B1416] no-underline transition-colors hover:underline ${sans}`
                  return (
                    <li key={l.href}>
                      {external ? (
                        <a href={l.href} className={cls} {...(l.href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                          {l.label}
                        </a>
                      ) : (
                        <Link href={l.href} className={cls}>
                          {l.label}
                        </Link>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div
          style={{ transitionDelay: near ? '800ms' : '0ms' }}
          className={`transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1.2)] motion-reduce:transition-none ${
            near ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
          }`}
        >
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className={`group ${btnDark} ${btnSmall} gap-[10px] !py-[7px] !pl-4 !pr-[7px] [outline:1px_solid_#FFFFFF33] [outline-offset:-0.5px]`}>
            <GitHubLogo />
            Star us on GitHub
            <span className="inline-flex items-center gap-[5px] rounded-full bg-black/5 px-[10px] py-[3px] text-[13px] font-medium">
              <svg viewBox="0 0 24 24" className="h-[13px] w-[13px] fill-[#F0625A] transition-transform duration-300 group-hover:rotate-[72deg] group-hover:scale-125" aria-hidden="true">
                <path d="M12 2.5l2.94 5.96 6.56.95-4.75 4.63 1.12 6.54L12 17.5l-5.87 3.08 1.12-6.54L2.5 9.41l6.56-.95z" />
              </svg>
              {stars ?? 'Star'}
            </span>
          </a>
        </div>
        <p className={`m-0 text-[12px] text-[#1B1416] ${sans}`}>elah is open source under Apache-2.0.</p>
       </div>
      </div>
    </footer>
  )
}
