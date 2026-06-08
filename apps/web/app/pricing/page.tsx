import type { Metadata } from 'next'
import { Navbar } from '@/components/marketing/Navbar'
import { Footer } from '@/components/marketing/Footer'
import { Check, ArrowRight } from 'lucide-react'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'Precision Studio is open source and free. Enterprise support available.',
}

const features = [
  'TimelineEngine with full undo/redo history',
  'WebGL2 GpuRenderer with VideoLayer, ImageLayer, TextLayer',
  'WebCodecs decode pipeline (StreamingFrameProducer)',
  'resolveTimeline() pure resolver',
  'Export pipeline (MP4 via Web Worker + mediabunny)',
  'Audio playback (Web Audio API)',
  'Interactive transform overlays',
  'Text overlay system (drag, resize, inline edit)',
  'Transition system (fade, slide/wipe architecture)',
  'AssetPanel with filmstrip thumbnails + waveforms',
  'Drag-drop media import',
  'TypeScript-first, fully typed API',
  'All future open-source updates',
]

export default function PricingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <Navbar />

      <main className="flex-1">
        {/* Header */}
        <div className="border-b border-outline-variant bg-surface py-16">
          <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
            <div className="label-mono mb-4 text-2xs text-on-surface-variant opacity-60">
              Pricing
            </div>
            <h1
              className="text-4xl font-semibold tracking-tight text-on-surface"
              style={{ fontFamily: 'var(--font-inter), sans-serif' }}
            >
              Free & Open Source
            </h1>
            <p className="mt-4 text-base leading-relaxed text-on-surface-variant">
              Precision Studio is MIT licensed. Use it commercially, fork it, contribute to it. No seat limits, no usage fees, no vendor lock-in.
            </p>
          </div>
        </div>

        {/* Plans */}
        <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">

            {/* Open Source */}
            <div className="flex flex-col overflow-hidden rounded-md border border-outline-variant bg-white">
              <div className="border-b border-outline-variant p-6">
                <div className="label-mono mb-1 text-2xs text-on-surface-variant opacity-60">Open Source</div>
                <div className="text-2xl font-semibold text-on-surface" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
                  Free
                </div>
                <div className="mt-1 text-xs text-on-surface-variant">MIT License · Forever</div>
              </div>
              <div className="flex flex-1 flex-col p-6">
                <ul className="mb-6 flex-1 space-y-2">
                  {features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-tertiary" />
                      <span className="text-xs text-on-surface-variant">{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/docs/getting-started"
                  className="flex items-center justify-center gap-2 rounded bg-primary px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
                >
                  Get Started
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>

            {/* Pro support */}
            <div className="flex flex-col overflow-hidden rounded-md border border-secondary/30 bg-white">
              <div className="border-b border-secondary/20 bg-secondary/5 p-6">
                <div className="label-mono mb-1 text-2xs text-secondary opacity-80">Pro Support</div>
                <div className="text-2xl font-semibold text-on-surface" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
                  Contact us
                </div>
                <div className="mt-1 text-xs text-on-surface-variant">Custom pricing</div>
              </div>
              <div className="flex flex-1 flex-col p-6">
                <ul className="mb-6 flex-1 space-y-2">
                  {[
                    'Everything in Open Source',
                    'Priority bug fixes and patches',
                    'Architecture review sessions',
                    'Integration support calls',
                    'Roadmap influence',
                    'Private Slack/Discord channel',
                    'SLA-backed response times',
                  ].map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-secondary" />
                      <span className="text-xs text-on-surface-variant">{f}</span>
                    </li>
                  ))}
                </ul>
                <a
                  href="mailto:contact@precisionstudio.dev"
                  className="flex items-center justify-center gap-2 rounded border border-secondary/40 px-4 py-2.5 text-sm font-medium text-secondary transition-colors hover:bg-secondary/5"
                >
                  Contact Sales
                </a>
              </div>
            </div>

            {/* Enterprise */}
            <div className="flex flex-col overflow-hidden rounded-md border border-outline-variant bg-inverse-surface text-inverse-on-surface">
              <div className="border-b border-white/10 p-6">
                <div className="label-mono mb-1 text-2xs text-white/50">Enterprise</div>
                <div className="text-2xl font-semibold" style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
                  Custom
                </div>
                <div className="mt-1 text-xs opacity-50">White-glove integration</div>
              </div>
              <div className="flex flex-1 flex-col p-6">
                <ul className="mb-6 flex-1 space-y-2">
                  {[
                    'Everything in Pro Support',
                    'Custom feature development',
                    'On-site architecture workshops',
                    'Dedicated engineering support',
                    'Code escrow options',
                    'Compliance + security reviews',
                    'Custom licensing agreements',
                  ].map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-60" />
                      <span className="text-xs opacity-70">{f}</span>
                    </li>
                  ))}
                </ul>
                <a
                  href="mailto:enterprise@precisionstudio.dev"
                  className="flex items-center justify-center gap-2 rounded bg-white px-4 py-2.5 text-sm font-medium text-inverse-surface transition-colors hover:bg-white/90"
                >
                  Talk to us
                </a>
              </div>
            </div>
          </div>

          {/* FAQ */}
          <div className="mt-16">
            <h2
              className="mb-8 text-xl font-semibold tracking-tight text-on-surface"
              style={{ fontFamily: 'var(--font-inter), sans-serif' }}
            >
              Frequently Asked Questions
            </h2>
            <div className="space-y-4">
              {[
                {
                  q: 'Can I use Precision Studio in a commercial product?',
                  a: 'Yes. The MIT license permits commercial use, modification, and distribution. You do not need to open-source your product, pay royalties, or ask for permission.',
                },
                {
                  q: 'What is included in the free tier?',
                  a: 'The complete SDK — TimelineEngine, GpuRenderer, decode pipeline, export pipeline, all React components, and all TypeScript types. There are no feature gates or locked tiers in the open-source version.',
                },
                {
                  q: 'Do I need mediabunny to use the SDK?',
                  a: 'mediabunny is required for video decode and MP4 export. It is a peer dependency and has its own license. The DemuxerFactory interface is pluggable — you can bring any demuxer that implements it.',
                },
                {
                  q: 'What browsers does Precision Studio support?',
                  a: 'Chrome/Edge 108+ is the primary target — WebCodecs and WebGL2 are required. Firefox has partial WebCodecs support. Safari has limited support. Check the browser limits section in the export docs for full details.',
                },
                {
                  q: 'Is there a hosted/SaaS version?',
                  a: 'Not currently. Precision Studio is a client-side SDK that runs entirely in the browser. There is no server component, no cloud dependency, and no data leaves the user\'s machine.',
                },
              ].map(({ q, a }) => (
                <div key={q} className="rounded-md border border-outline-variant bg-white p-5">
                  <div className="mb-2 text-sm font-medium text-on-surface">{q}</div>
                  <p className="text-sm leading-relaxed text-on-surface-variant">{a}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
