'use client'

import Link from 'next/link'
import { useConsent } from '@/components/ConsentProvider'

// Shown only until the visitor makes a choice, and never when Do-Not-Track is
// set (that already resolves to denied). Fixed to the bottom, above content.
export function ConsentBanner() {
  const { consent, dnt, accept, decline } = useConsent()

  if (dnt || consent !== 'unset') return null

  return (
    <div
      role="dialog"
      aria-label="Analytics consent"
      className="fixed inset-x-0 bottom-0 z-[60] border-t border-outline-variant bg-surface-low/95 backdrop-blur-sm"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="text-sm leading-relaxed text-on-surface-variant">
          We use privacy-friendly product analytics and a Reddit pixel to understand usage. Nothing is
          loaded until you accept.{' '}
          <Link href="/docs/analytics" className="text-primary underline underline-offset-2">
            Learn more
          </Link>
          .
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={decline}
            className="btn-ghost"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={accept}
            className="btn-primary"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  )
}
