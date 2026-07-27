import type { Metadata } from 'next'
import Link from 'next/link'
import { Github, Mail, MessageCircle, Check } from 'lucide-react'
import { Navbar } from '@/components/marketing/Navbar'
import { Footer } from '@/components/marketing/Footer'

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'elah is open source under Apache-2.0 and free to build on, embed, and self-host — including commercial and hosted products. Paid support is available — get in touch.',
  alternates: { canonical: '/pricing' },
}

const openSourceIncludes = [
  'The full engine, timeline, WebGL2 renderer, and MP4 export',
  'All four packages: @elah/core, @elah/timeline, @elah/editor, @elah/cli',
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
        <div className="border-b border-outline-variant bg-surface py-14">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="label-mono mb-3 text-2xs text-on-surface-variant opacity-90">
              Pricing
            </div>
            <h1
              className="text-3xl font-semibold tracking-tight text-on-surface md:text-4xl"
              style={{ fontFamily: 'var(--font-inter), sans-serif' }}
            >
              Open source. Support available on request.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-on-surface-variant">
              elah is free to build on, embed, self-host, and ship in commercial
              products under Apache-2.0 — no license fee, no gated features. If you
              want dedicated support, priority help, or custom integration work,
              reach out — we&apos;ll work something out.
            </p>
          </div>
        </div>

        {/* Cards */}
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Open source */}
            <div className="flex flex-col rounded-lg border border-outline-variant bg-surface-container p-7">
              <div className="label-mono mb-2 text-2xs text-on-surface-variant opacity-90">
                Open source
              </div>
              <h2
                className="text-2xl font-semibold tracking-tight text-on-surface"
                style={{ fontFamily: 'var(--font-inter), sans-serif' }}
              >
                Free
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
                Everything you need to build a browser-native video editor, in
                the open. Install from npm and ship today.
              </p>

              <ul className="mt-6 space-y-3">
                {openSourceIncludes.map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-tertiary" />
                    <span className="text-sm leading-relaxed text-on-surface-variant">{item}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/docs/getting-started"
                  className="inline-flex items-center justify-center gap-2 rounded bg-primary px-5 py-2.5 text-sm font-medium text-on-primary transition-colors hover:bg-primary-hover"
                >
                  Get started
                </Link>
                <a
                  href="https://github.com/elahlabs/elah"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded border border-outline-variant bg-transparent px-5 py-2.5 text-sm font-medium text-on-surface transition-colors hover:bg-surface-container"
                >
                  <Github className="h-3.5 w-3.5" />
                  GitHub
                </a>
              </div>
            </div>

            {/* Support / contact */}
            <div className="flex flex-col rounded-lg border border-primary/40 bg-surface-low p-7">
              <div className="label-mono mb-2 text-2xs text-on-surface-variant opacity-90">
                Support &amp; services
              </div>
              <h2
                className="text-2xl font-semibold tracking-tight text-on-surface"
                style={{ fontFamily: 'var(--font-inter), sans-serif' }}
              >
                Let&apos;s talk
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
                For priority support, custom integration help, or production
                deployment (including self-hosted @elah/cli render infrastructure),
                get in touch. No forms, no sales funnel — just email or Discord.
              </p>

              <div className="mt-6 space-y-3">
                <a
                  href="mailto:paul@elah.dev"
                  className="flex items-center gap-3 rounded-md border border-outline-variant bg-surface-container p-4 transition-colors hover:border-outline"
                >
                  <Mail className="h-4 w-4 shrink-0 text-primary" />
                  <span className="text-sm font-medium text-on-surface">paul@elah.dev</span>
                </a>
                <a
                  href="https://discord.gg/8CeZ2XbPy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 rounded-md border border-outline-variant bg-surface-container p-4 transition-colors hover:border-outline"
                >
                  <MessageCircle className="h-4 w-4 shrink-0 text-primary" />
                  <span className="text-sm font-medium text-on-surface">Join the Discord</span>
                </a>
              </div>

              <p className="mt-6 text-xs leading-relaxed text-on-surface-variant">
                See the{' '}
                <a
                  href="https://github.com/elahlabs/elah/blob/main/LICENSE"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
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
