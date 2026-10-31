import type { Metadata } from 'next'
import { DocsToc } from '@/components/docs/DocsToc'
import { C, Callout, DocsPager, H2, H3, P, PropTable } from '@/components/docs/DocsKit'
import { PageHeader } from '@/components/site/PageHeader'

export const metadata: Metadata = {
  title: 'Analytics & Tracking',
  description:
    'What the elah.dev site tracks, the environment variables that enable it, and how consent, Do-Not-Track, and opt-out work.',
  alternates: { canonical: '/docs/analytics' },
}

const toc = [
  { id: 'what-we-track', title: 'What we track', level: 2 },
  { id: 'consent', title: 'Consent & Do-Not-Track', level: 2 },
  { id: 'opt-out', title: 'Changing your choice', level: 2 },
  { id: 'pwa', title: 'Install & offline', level: 2 },
  { id: 'env', title: 'Environment variables', level: 2 },
  { id: 'self-hosting', title: 'Self-hosting', level: 2 },
]

export default function AnalyticsDocsPage() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
      <article className="min-w-0 max-w-3xl flex-1">
        <PageHeader
          variant="doc"
          eyebrow="Privacy"
          title="Analytics &amp; Tracking"
          lede="What the elah.dev website measures, and how to say no. Nothing is sent until you accept the consent banner, and nothing at all if your browser sends Do-Not-Track."
        />
        <Callout title="The libraries have no telemetry">
          <C>@elah/core</C>, <C>@elah/editor</C> and the other packages send nothing anywhere. This page is only about the elah.dev website.
        </Callout>

        <H2 id="what-we-track">What we track</H2>
        <PropTable
          nameLabel="Tool"
          rows={[
            { name: 'PostHog', type: 'product analytics', desc: <>Page views, PostHog&apos;s automatic click capture, JavaScript errors, and the named events below. Sent through <C>/ingest</C> on this site rather than to PostHog directly.</> },
            { name: 'Reddit Pixel', type: 'ad measurement', desc: <>A <C>PageVisit</C> on each page, plus a few events mapped to Reddit&apos;s conversion types. Only a small, fixed set of fields is sent with each, never the PostHog properties.</> },
          ]}
        />

        <H3>Named events</H3>
        <PropTable
          nameLabel="Event"
          rows={[
            { name: 'install_command_copied', desc: 'Copying an npm install command.' },
            { name: 'creator_cta_clicked', desc: 'Clicking “Try Elah Creator”.' },
            { name: 'playground_launched', type: 'Reddit: Lead', desc: 'Opening a playground.' },
            { name: 'export_modal_opened · export_started · export_completed · export_failed', desc: 'The export flow in the editor.' },
            { name: 'aspect_ratio_changed · editor_panel_switched', desc: 'Editor interactions.' },
            { name: 'docs_ask_ai_clicked', desc: 'Using the Ask AI button on a docs page, with which tool and page.' },
            { name: 'discord_clicked', desc: 'Following the Discord link.' },
            { name: 'pwa_install_prompt_shown', type: 'Reddit: ViewContent', desc: 'The install banner appeared.' },
            { name: 'pwa_install_dismissed', type: 'Reddit: Custom', desc: '“Not now” on the install banner.' },
          ]}
          footer="Events without a Reddit type go to PostHog only."
        />

        <H2 id="consent">Consent &amp; Do-Not-Track</H2>
        <PropTable
          nameLabel="Your choice"
          rows={[
            { name: 'Not chosen yet', desc: 'PostHog is loaded but opted out, so it sends nothing. The Reddit script is not loaded at all.' },
            { name: 'Accept', desc: 'PostHog starts capturing and the Reddit pixel loads.' },
            { name: 'Decline', desc: 'Both stay off.' },
            { name: 'Do-Not-Track on', desc: 'Treated as decline. The banner never appears, and nothing is saved.' },
          ]}
        />
        <P>
          Your choice is saved in <C>localStorage</C> under <C>elah-analytics-consent</C> and remembered next time.
        </P>

        <H2 id="opt-out">Changing your choice</H2>
        <PropTable
          nameLabel="To…"
          rows={[
            { name: 'See the banner again', desc: <>Clear <C>elah-analytics-consent</C> from the site&apos;s storage (or all of it) and reload.</> },
            { name: 'Turn everything off now', desc: 'Enable Do-Not-Track in your browser.' },
            { name: 'Reset the install banner', desc: <>Clear <C>elah-pwa-install-dismissed-until</C> and <C>elah-pwa-installed</C>.</> },
          ]}
        />

        <H2 id="pwa">Install &amp; offline</H2>
        <P>
          elah.dev can be installed as an app in desktop and Android Chromium browsers. A small service worker at <C>/sw.js</C> registers for
          every visitor, whatever your analytics choice, because it is not tracking: it stores only an offline page and the site logo, never your
          pages, and sends nothing. Remove it any time in your browser&apos;s DevTools (Application → Service Workers → Unregister).
        </P>
        <PropTable
          nameLabel="Install banner"
          rows={[
            { name: 'When it shows', desc: 'Once you have made a consent choice, either way, on browsers that can install. Never on editor or playground pages.' },
            { name: 'What it sends', desc: 'An impression and a dismissal event, only if you accepted analytics. If you declined, it shows but sends nothing.' },
            { name: '“Not now”', desc: 'Hides it for 14 days.' },
          ]}
        />

        <H2 id="env">Environment variables</H2>
        <P>
          For anyone running the site. Each tool stays off unless its variable is set. They are read from the repo-root <C>.env</C> (see{' '}
          <C>.env.example</C>) and are <C>NEXT_PUBLIC_</C> because the browser SDKs need them.
        </P>
        <PropTable
          nameLabel="Variable"
          rows={[
            { name: 'NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN', desc: 'PostHog project token. Unset: no PostHog, in the browser or on the server.' },
            { name: 'NEXT_PUBLIC_POSTHOG_HOST', desc: <>PostHog host, for example <C>https://us.i.posthog.com</C>.</> },
            { name: 'NEXT_PUBLIC_REDDIT_PIXEL_ID', desc: 'Reddit pixel id. Unset: the pixel never loads.' },
            { name: 'NEXT_PUBLIC_ENABLE_SW', type: '1', desc: 'Register the service worker in development. It is on in production and off in dev by default.' },
            { name: 'NEXT_PUBLIC_DISABLE_SW', type: '1', desc: 'Kill switch: unregister any installed service worker instead of registering one.' },
          ]}
        />

        <H2 id="self-hosting">Self-hosting</H2>
        <P>Deploying your own copy? Leave the PostHog and Reddit variables unset and no analytics code runs.</P>
        <Callout kind="warning" title="One event is not covered by the consent banner">
          When the AI topics feature generates suggestions, the server records <C>ai_topics_generated</C> (just the number of options) in PostHog
          from <C>app/api/ai/topics/route.ts</C>. It runs on the server, so the browser&apos;s consent choice does not reach it. Unsetting the
          PostHog token turns it off.
        </Callout>

        <DocsPager href="/docs/analytics" />
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
