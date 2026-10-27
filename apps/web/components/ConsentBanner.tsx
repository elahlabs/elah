'use client'

import Link from 'next/link'
import { useConsent } from '@/components/ConsentProvider'

const mono = 'font-[family-name:var(--font-geist-mono),ui-monospace,monospace]'
const btn = `inline-flex h-[36px] items-center justify-center px-4 text-[11px] font-medium uppercase tracking-[0.12em] transition-colors ${mono}`

// Shown only until the visitor makes a choice, and never when Do-Not-Track is
// set (that already resolves to denied). Fixed to the bottom, above content.
// Styled as an ink bar like the homepage scrub bar (landing DESIGN.md §0), so
// it reads the same on the homepage in either theme and on the dark-only pages.
export function ConsentBanner() {
  const { consent, dnt, resolved, accept, decline } = useConsent()

  // Wait for the localStorage/DNT read on mount before rendering anything —
  // otherwise a returning visitor's already-resolved choice flashes as a
  // one-frame "unset" banner that immediately vanishes.
  if (!resolved || dnt || consent !== 'unset') return null

  return (
    <div
      role="dialog"
      aria-label="Analytics consent"
      className="fixed inset-x-0 bottom-0 z-[70] border-t border-[#2E2E33] bg-[#0E0E10] text-[#F0EFEA]"
    >
      <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-[72px]">
        <div className="flex items-start gap-3">
          <span aria-hidden className="mt-[6px] h-[8px] w-[8px] shrink-0 bg-[#FF003C]" />
          <p className="m-0 text-[14px] leading-[22px] text-[#C9C8C2]">
            We use privacy-friendly product analytics and a Reddit pixel to understand usage. Nothing is loaded until
            you accept.{' '}
            <Link href="/docs/analytics" className="text-[#F0EFEA] underline underline-offset-4 hover:text-[#FF003C]">
              Learn more
            </Link>
            .
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={decline}
            className={`${btn} border border-[#F0EFEA] text-[#F0EFEA] hover:bg-[#F0EFEA] hover:text-[#0E0E10]`}
          >
            Decline
          </button>
          <button type="button" onClick={accept} className={`${btn} bg-[#FF003C] text-[#0E0E10] hover:bg-[#F0EFEA]`}>
            Accept
          </button>
        </div>
      </div>
    </div>
  )
}
