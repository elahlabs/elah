'use client'

import Link from 'next/link'
import { useConsent } from '@/components/ConsentProvider'
import { bottomBar } from '@/components/eb/bottomBar'

// Shown only until the visitor makes a choice, and never when Do-Not-Track is
// set (that already resolves to denied). Fixed to the bottom, above content.
// Styled by the shared bottom bar (components/eb/bottomBar.ts).
export function ConsentBanner() {
  const { consent, dnt, resolved, accept, decline } = useConsent()

  // Wait for the localStorage/DNT read on mount before rendering anything —
  // otherwise a returning visitor's already-resolved choice flashes as a
  // one-frame "unset" banner that immediately vanishes.
  if (!resolved || dnt || consent !== 'unset') return null

  return (
    <div role="dialog" aria-label="Analytics consent" className={bottomBar.root}>
      <div className={bottomBar.inner}>
        <div className={bottomBar.message}>
          <span aria-hidden className={bottomBar.marker} />
          <p className={bottomBar.text}>
            We use privacy-friendly product analytics and a Reddit pixel to understand usage. Nothing is loaded until
            you accept.{' '}
            <Link href="/docs/analytics" className={bottomBar.link}>
              Learn more
            </Link>
            .
          </p>
        </div>
        <div className={bottomBar.actions}>
          <button type="button" onClick={decline} className={bottomBar.secondary}>
            Decline
          </button>
          <button type="button" onClick={accept} className={bottomBar.primary}>
            Accept
          </button>
        </div>
      </div>
    </div>
  )
}
