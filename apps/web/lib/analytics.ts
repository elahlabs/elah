import posthog from 'posthog-js'

declare global {
  interface Window {
    rdt?: {
      (...args: unknown[]): void
      callQueue: unknown[][]
      sendEvent?: (...args: unknown[]) => void
    }
  }
}

interface PlaygroundLaunchProps {
  /** Where the click happened, e.g. 'hero_live_playground', 'hero_library_card', 'landing_playgrounds', 'playground_card'. */
  source: string
  title: string
  href: string
  variant: string
  status?: string
}

// Fires the PostHog product event and the matching Reddit Ads conversion
// event from a single call site. window.rdt is undefined until the pixel
// script loads (post-consent, see RedditPixel.tsx), so this is a no-op
// pre-consent without any extra gating logic.
export function trackPlaygroundLaunch(props: PlaygroundLaunchProps) {
  posthog.capture('playground_launched', props)
  window.rdt?.('track', 'Lead', { source: props.source })
}
