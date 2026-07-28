import posthog from 'posthog-js'
import { REDDIT_EVENT_MAP, type AnalyticsEventName, type EventProps } from '@/lib/analytics/events'

declare global {
  interface Window {
    rdt?: {
      (...args: unknown[]): void
      callQueue: unknown[][]
      sendEvent?: (...args: unknown[]) => void
    }
  }
}

interface AnalyticsProvider {
  name: string
  send: (event: AnalyticsEventName, props: EventProps) => void
}

// posthog is always init'd but opted-out (instrumentation-client.ts), so
// capture() is safe unconditionally and silently drops pre-consent.
const posthogProvider: AnalyticsProvider = {
  name: 'posthog',
  send: (event, props) => posthog.capture(event, props),
}

// window.rdt is undefined until the pixel script loads (post-consent, see
// RedditPixel.tsx), so the optional call is the whole pre-consent gate.
const redditProvider: AnalyticsProvider = {
  name: 'reddit',
  send: (event, props) => {
    const mapping = REDDIT_EVENT_MAP[event]
    if (!mapping) return
    const metadata = mapping.metadata?.(props) ?? {}
    if (mapping.event === 'Custom') {
      window.rdt?.('track', 'Custom', { ...metadata, customEventName: mapping.customEventName })
      return
    }
    window.rdt?.('track', mapping.event, metadata)
  },
}

const providers: AnalyticsProvider[] = [posthogProvider, redditProvider]

// Single entry point for product analytics. Fans one event out to every
// provider; add a new network by pushing another AnalyticsProvider above and
// (if it needs one) a name mapping in lib/analytics/events.ts — no call site
// changes required.
export function trackEvent(event: AnalyticsEventName, props: EventProps = {}) {
  // these run inside click handlers and effects; a thrown provider must never
  // take the interaction down with it, and one bad provider must not starve
  // the others. also guards SSR, where `window` doesn't exist.
  if (typeof window === 'undefined') return
  for (const provider of providers) {
    try {
      provider.send(event, props)
    } catch {
      // analytics is best-effort — swallow
    }
  }
}

// module scope, so this survives re-renders, App Router client navigation and
// React 19 StrictMode's double-invoked effects (same module instance). only a
// full document load resets it, which genuinely is a new impression.
const firedOnce = new Set<string>()

// trackEvent, but at most once per document lifetime for a given key.
export function trackEventOnce(key: string, event: AnalyticsEventName, props: EventProps = {}) {
  if (firedOnce.has(key)) return
  firedOnce.add(key)
  trackEvent(event, props)
}

interface PlaygroundLaunchProps {
  /** Where the click happened, e.g. 'hero_live_playground', 'hero_library_card', 'landing_playgrounds', 'playground_card'. */
  source: string
  title: string
  href: string
  variant: string
  status?: string
}

export function trackPlaygroundLaunch(props: PlaygroundLaunchProps) {
  trackEvent('playground_launched', { ...props })
}
