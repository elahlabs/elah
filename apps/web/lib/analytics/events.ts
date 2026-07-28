// reddit's pixel only understands its own fixed vocabulary of conversion
// events, so every posthog event name we care about has to be projected onto
// one of them. keeping the projection in a table (rather than at each call
// site) is what lets components call trackEvent() and nothing else.
export type RedditStandardEvent =
  | 'PageVisit'
  | 'ViewContent'
  | 'Search'
  | 'AddToCart'
  | 'AddToWishlist'
  | 'Purchase'
  | 'Lead'
  | 'SignUp'

export type EventProps = Record<string, unknown>

export interface RedditMapping {
  event: RedditStandardEvent | 'Custom'
  /** required by reddit when event is 'Custom' — it's the name shown in Events Manager. */
  customEventName?: string
  /** the pixel is an ad network, so we deliberately forward a curated subset
      of the posthog props rather than the whole object. */
  metadata?: (props: EventProps) => EventProps
}

// known product events. the `(string & {})` arm keeps editor autocomplete for
// these while still allowing any snake_case event to be sent posthog-only.
export type AnalyticsEventName =
  | 'playground_launched'
  | 'pwa_install_prompt_shown'
  | 'pwa_install_clicked'
  | 'pwa_installed'
  | 'pwa_install_dismissed'
  | (string & {})

const PWA = { feature: 'pwa_install' } as const

// events absent from this table are posthog-only by design — that's the
// default, and it keeps the reddit conversion feed clean enough to optimise on.
export const REDDIT_EVENT_MAP: Record<string, RedditMapping> = {
  playground_launched: {
    event: 'Lead',
    metadata: (props) => ({ source: props.source }),
  },
  pwa_install_prompt_shown: {
    event: 'ViewContent',
    metadata: () => ({ ...PWA, source: 'install_prompt' }),
  },
  pwa_install_clicked: {
    event: 'Lead',
    metadata: () => ({ ...PWA, action: 'install_clicked' }),
  },
  pwa_installed: {
    event: 'SignUp',
    metadata: () => ({ ...PWA, action: 'installed' }),
  },
  pwa_install_dismissed: {
    event: 'Custom',
    customEventName: 'pwa_install_dismissed',
    metadata: () => ({ ...PWA, action: 'dismissed' }),
  },
}
