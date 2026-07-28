import type { Metadata } from 'next'
import { DocsToc } from '@/components/docs/DocsToc'

export const metadata: Metadata = {
  title: 'Analytics & Tracking',
  description:
    'What the elah.dev site tracks, the environment variables that enable it, and how consent, Do-Not-Track, and opt-out work.',
  alternates: { canonical: '/docs/analytics' },
}

const toc = [
  { id: 'what-we-track', title: 'What we track', level: 2 },
  { id: 'env', title: 'Environment variables', level: 2 },
  { id: 'consent', title: 'Consent & Do-Not-Track', level: 2 },
  { id: 'opt-out', title: 'Changing your choice', level: 2 },
  { id: 'self-hosting', title: 'Self-hosting', level: 2 },
]

const mono = 'rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono'

export default function AnalyticsDocsPage() {
  return (
    <div className="flex gap-12">
      <article className="min-w-0 max-w-3xl flex-1">
        <div className="mb-8 border-b border-outline-variant pb-6">
          <div className="label-mono mb-2 text-2xs text-on-surface-variant opacity-90">Privacy</div>
          <h1
            className="text-3xl font-semibold tracking-tight text-on-surface"
            style={{ fontFamily: 'var(--font-inter), sans-serif' }}
          >
            Analytics &amp; Tracking
          </h1>
          <p className="mt-3 text-base leading-relaxed text-on-surface-variant">
            The elah.dev website uses two analytics tools. Both are opt-in: nothing loads or sends data until
            you accept the consent banner, and neither runs if your browser sends a Do-Not-Track signal. The
            elah libraries themselves (<code className={mono}>@elah/core</code> and the rest) contain no
            telemetry — this applies only to the marketing site.
          </p>
        </div>

        <section className="mb-10">
          <h2 id="what-we-track" className="mb-4 scroll-mt-20 text-xl font-semibold tracking-tight text-on-surface" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            What we track
          </h2>
          <ul className="space-y-3 text-sm leading-relaxed text-on-surface-variant">
            <li>
              <strong className="text-on-surface">PostHog</strong> — privacy-friendly product analytics:
              page views and a few interaction events (install-command copies, playground launches, export
              flow). Reverse-proxied through <code className={mono}>/ingest</code> so it is resilient to
              ad-blockers.
            </li>
            <li>
              <strong className="text-on-surface">Reddit Pixel</strong> — fires a{' '}
              <code className={mono}>PageVisit</code> event on load and on client-side route changes, used to
              measure Reddit ad campaigns.
            </li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 id="env" className="mb-4 scroll-mt-20 text-xl font-semibold tracking-tight text-on-surface" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Environment variables
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            Each tool is inert unless its variable is set. All are <code className={mono}>NEXT_PUBLIC_</code>{' '}
            (exposed to the browser, as the client SDKs require) and are read from the repo-root{' '}
            <code className={mono}>.env</code> — see <code className={mono}>.env.example</code>.
          </p>
          <ul className="space-y-2 text-sm leading-relaxed text-on-surface-variant">
            <li>
              <code className={mono}>NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN</code> — PostHog project token.
            </li>
            <li>
              <code className={mono}>NEXT_PUBLIC_POSTHOG_HOST</code> — PostHog host (e.g.{' '}
              <code className={mono}>https://us.i.posthog.com</code>).
            </li>
            <li>
              <code className={mono}>NEXT_PUBLIC_REDDIT_PIXEL_ID</code> — Reddit advertiser pixel id.
            </li>
          </ul>
          <p className="mt-4 text-sm leading-relaxed text-on-surface-variant">
            Leave any of them unset and that tool is never loaded — a clean way to run the site with no
            tracking at all.
          </p>
        </section>

        <section className="mb-10">
          <h2 id="consent" className="mb-4 scroll-mt-20 text-xl font-semibold tracking-tight text-on-surface" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Consent &amp; Do-Not-Track
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">
            On first visit a banner asks to accept or decline. Until you choose, PostHog is initialised{' '}
            <em>opted-out</em> and the Reddit pixel script is never injected — so no analytics network request
            happens pre-consent. Accepting opts PostHog in and loads the pixel; declining keeps both off. Your
            choice is stored in <code className={mono}>localStorage</code> (<code className={mono}>elah-analytics-consent</code>) and remembered on return.
          </p>
          <p className="text-sm leading-relaxed text-on-surface-variant">
            If your browser sends <strong className="text-on-surface">Do-Not-Track</strong>, both tools stay
            off and the banner never appears — the signal is treated as a decline.
          </p>
        </section>

        <section className="mb-10">
          <h2 id="opt-out" className="mb-4 scroll-mt-20 text-xl font-semibold tracking-tight text-on-surface" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Changing your choice
          </h2>
          <p className="text-sm leading-relaxed text-on-surface-variant">
            Clearing the site&apos;s <code className={mono}>localStorage</code> (or the{' '}
            <code className={mono}>elah-analytics-consent</code> key) resets the banner on next load. Enabling
            Do-Not-Track in your browser disables both tools immediately.
          </p>
        </section>

        <section className="mb-10">
          <h2 id="self-hosting" className="mb-4 scroll-mt-20 text-xl font-semibold tracking-tight text-on-surface" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
            Self-hosting
          </h2>
          <p className="text-sm leading-relaxed text-on-surface-variant">
            If you deploy your own copy of the site, simply omit the three variables above and no analytics
            code runs. One known gap: PostHog capture in the AI topics API route
            (<code className={mono}>app/api/ai/topics/route.ts</code>) is server-side and fires on that explicit
            action; it is not covered by the client consent gate.
          </p>
        </section>
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
