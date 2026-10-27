import type { Metadata } from 'next'
import Link from 'next/link'
import { Github, Mail, MessageCircle, Check } from 'lucide-react'
import { Navbar } from '@/components/marketing/Navbar'
import { Footer } from '@/components/marketing/Footer'
import { siteConfig } from '@/config/site'
import { PageHeader } from '@/components/site/PageHeader'
import { Slate, btnPrimary, btnSecondary, btnSmall, cardBody, cardLight, cardTitle, container, label, outline, sectionY } from '@/components/eb'

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'elah is open source under Apache-2.0 and free to build on, embed, and self-host — including commercial and hosted products. Paid support is available — get in touch.',
  alternates: { canonical: '/pricing' },
  // Hidden from navigation, sitemap and the agents index; reachable by direct link only.
  robots: { index: false, follow: false },
}

const openSourceIncludes = [
  'The full engine, timeline, WebGL2 renderer, and MP4 export',
  'All five packages: @elah/core, @elah/react, @elah/timeline, @elah/editor, @elah/cli',
  'Every framework binding as it ships',
  'Self-hosted server-side rendering via @elah/cli — no license fee',
  'Community support on Discord and GitHub',
]

export default function PricingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <Navbar />

      <main className="flex-1">
        {/* Header */}
        <PageHeader
          eyebrow="Pricing"
          title="Open source. Support available on request."
          lede={
            <>
              elah is free to build on, embed, self-host, and ship in commercial
              products under Apache-2.0 — no license fee, no gated features. If you
              want dedicated support, priority help, or custom integration work,
              reach out — we&apos;ll work something out.
            </>
          }
        />

        {/* Cards */}
        <div className={`${container} pt-12 ${sectionY}`}>
          <Slate n={1} label="Plans" kicker="Apache-2.0" />
          <div className="grid grid-cols-1 gap-4 pt-10 md:grid-cols-2">
            {/* Open source */}
            <div className={`${cardLight} gap-0 p-7`}>
              <div className={`mb-3 text-on-surface-variant ${label}`}>
                Open source
              </div>
              <h2 className={`${cardTitle} text-[44px]`}>
                Free
              </h2>
              <p className={`${cardBody} mt-3`}>
                Everything you need to build a browser-native video editor, in
                the open. Install from npm and ship today.
              </p>

              <ul className="mt-6 space-y-3">
                {openSourceIncludes.map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-on-surface" />
                    <span className={cardBody}>{item}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/docs/getting-started"
                  className={`${btnPrimary} ${btnSmall}`}
                >
                  Get started
                </Link>
                <a
                  href="https://github.com/elahlabs/elah"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${btnSecondary} ${btnSmall}`}
                >
                  <Github className="h-3.5 w-3.5" />
                  GitHub
                </a>
              </div>
            </div>

            {/* Support / contact */}
            <div className={`${cardLight} gap-0 p-7`}>
              <div className={`mb-3 text-on-surface-variant ${label}`}>
                Support &amp; services
              </div>
              <h2 className={`${cardTitle} text-[44px]`}>
                Let&apos;s talk
              </h2>
              <p className={`${cardBody} mt-3`}>
                For priority support, custom integration help, or production
                deployment (including self-hosted @elah/cli render infrastructure),
                get in touch. No forms, no sales funnel — just email or Discord.
              </p>

              <div className="mt-6 space-y-3">
                <a
                  href="mailto:paul@elah.dev"
                  className={`flex items-center gap-3 bg-surface p-4 transition-colors hover:bg-surface-container ${outline}`}
                >
                  <Mail className="h-4 w-4 shrink-0 text-on-surface" />
                  <span className={`text-on-surface ${label}`}>paul@elah.dev</span>
                </a>
                <a
                  href={siteConfig.links.discord}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex items-center gap-3 bg-surface p-4 transition-colors hover:bg-surface-container ${outline}`}
                >
                  <MessageCircle className="h-4 w-4 shrink-0 text-on-surface" />
                  <span className={`text-on-surface ${label}`}>Join the Discord</span>
                </a>
              </div>

              <p className="mt-6 text-[13px] leading-[20px] text-on-surface-variant">
                See the{' '}
                <a
                  href="https://github.com/elahlabs/elah/blob/main/LICENSE"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-on-surface underline decoration-primary underline-offset-4"
                >
                  LICENSE
                </a>{' '}
                for the open-source terms.
              </p>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
