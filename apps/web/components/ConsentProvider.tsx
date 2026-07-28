'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import posthog from 'posthog-js'

export type Consent = 'granted' | 'denied' | 'unset'

const STORAGE_KEY = 'elah-analytics-consent'

interface ConsentValue {
  consent: Consent
  /** True when the browser signals Do-Not-Track — tracking is force-denied and the banner is suppressed. */
  dnt: boolean
  /** False until localStorage/DNT have been read on mount. The banner must wait for this — otherwise
   *  a returning visitor's already-resolved choice renders as a one-frame flash of `consent === 'unset'`
   *  before the effect corrects it. */
  resolved: boolean
  accept: () => void
  decline: () => void
}

const ConsentContext = createContext<ConsentValue>({
  consent: 'unset',
  dnt: false,
  resolved: false,
  accept: () => {},
  decline: () => {},
})

function detectDnt(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as Window & { doNotTrack?: string }
  const n = navigator as Navigator & { msDoNotTrack?: string }
  const signal = n.doNotTrack ?? w.doNotTrack ?? n.msDoNotTrack
  return signal === '1' || signal === 'yes'
}

// Reflect the choice into PostHog. init() runs opted-out by default
// (instrumentation-client.ts), so capturing only starts once granted.
function syncPosthog(consent: Consent) {
  try {
    if (consent === 'granted') posthog.opt_in_capturing()
    else posthog.opt_out_capturing()
  } catch {
    // posthog may be uninitialised (no token configured) — safe to ignore
  }
}

export function ConsentProvider({ children }: { children: React.ReactNode }) {
  const [consent, setConsent] = useState<Consent>('unset')
  const [dnt, setDnt] = useState(false)
  const [resolved, setResolved] = useState(false)

  useEffect(() => {
    const hasDnt = detectDnt()
    setDnt(hasDnt)
    if (hasDnt) {
      // Honour the browser signal without prompting or persisting.
      setConsent('denied')
      syncPosthog('denied')
      setResolved(true)
      return
    }
    const stored = localStorage.getItem(STORAGE_KEY)
    const initial: Consent = stored === 'granted' || stored === 'denied' ? stored : 'unset'
    setConsent(initial)
    if (initial !== 'unset') syncPosthog(initial)
    setResolved(true)
  }, [])

  function choose(next: 'granted' | 'denied') {
    setConsent(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // storage may be unavailable (private mode) — choice still applies this session
    }
    syncPosthog(next)
  }

  return (
    <ConsentContext.Provider
      value={{ consent, dnt, resolved, accept: () => choose('granted'), decline: () => choose('denied') }}
    >
      {children}
    </ConsentContext.Provider>
  )
}

export const useConsent = () => useContext(ConsentContext)
