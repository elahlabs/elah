import { ChevronDown } from 'lucide-react'
import { JsonLd } from '@/components/seo/JsonLd'

// Rendered as native <details> so the answers are crawlable without JS, and
// mirrored as FAQPage JSON-LD for answer engines. Keep both lists in sync.
const faqs = [
  {
    question: 'Does elah need a server to edit or export video?',
    answer:
      'No — by default everything runs in the browser: decoding (WebCodecs), rendering (WebGL2), and MP4 export (a Web Worker drawing to an OffscreenCanvas), so footage never leaves the user’s machine. When you want server-side rendering — batch jobs, AI-generated video, CI — @elah/cli runs the exact same export pipeline headlessly on your own hardware, with bit-identical output.',
  },
  {
    question: 'Can elah render video on a server?',
    answer:
      'Yes. npx @elah/cli serve starts a self-hosted HTTP render server: POST a seconds-based JSON spec to /render and get MP4 bytes back. It keeps a warm headless Chrome and runs core’s real exportVideo pipeline, so server output is frame-identical to the browser. There is also elah build / elah export for one-shot CLI renders, and a Node library API.',
  },
  {
    question: 'What can I build with elah?',
    answer:
      'An embeddable video editor inside your own product: the SDK ships EditorProvider, Preview, AssetPanel, and Timeline React components on top of a headless TypeScript engine, so you can compose a full editor in under 20 lines or drive the engine directly.',
  },
  {
    question: 'Is the exported video identical to the preview?',
    answer:
      'Yes. Preview and export run the same pure resolver — resolveTimeline(frame, project) → Scene — and the same placement math, so the frame you scrub is the frame you ship. Same project, same frame, same pixels.',
  },
  {
    question: 'How is elah different from Remotion?',
    answer:
      'Remotion turns React components into video — programmatic composition rendered by headless Chromium. elah is an editing engine: an integer-frame timeline data model with undo history, drag/trim/split UI, and a GPU export pipeline that runs in the user’s browser or headlessly via @elah/cli. The difference is the editing foundation, not where rendering happens.',
  },
  {
    question: 'Which frameworks does elah support?',
    answer:
      'The core engine is framework-agnostic TypeScript with zero React imports. React and Next.js bindings ship today via @elah/editor and @elah/timeline; React Native support is experimental, with more frameworks planned.',
  },
  {
    question: 'Is elah open source?',
    answer:
      'Yes — elah is open source under the Apache-2.0 license, copyright Elah Labs Private Limited. It’s free to use, modify, embed, self-host, and ship in commercial products, including hosted and white-label offerings. Paid support and services are available if you want them, but nothing is gated behind a license.',
  },
  {
    question: 'What export formats does elah support?',
    answer:
      'MP4 with H.264 video by default (VP9 and VP8 are also available) and AAC or Opus audio, at any aspect ratio — 9:16, 16:9, 1:1, or a custom stage — up to the project’s native resolution.',
  },
]

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map(({ question, answer }) => ({
    '@type': 'Question',
    name: question,
    acceptedAnswer: { '@type': 'Answer', text: answer },
  })),
}

export function FAQSection() {
  return (
    <section id="faq" className="border-b border-outline-variant bg-surface py-20">
      <JsonLd data={faqJsonLd} />
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mb-10">
          <div className="label-mono mb-3 text-2xs text-on-surface-variant opacity-90">
            FAQ
          </div>
          <h2
            className="text-2xl font-semibold tracking-tight text-on-surface md:text-3xl"
            style={{ fontFamily: 'var(--font-inter), sans-serif' }}
          >
            Common questions.
          </h2>
        </div>
        <div className="mx-auto max-w-3xl space-y-2">
          {faqs.map(({ question, answer }) => (
            <details
              key={question}
              className="group rounded-md border border-outline-variant bg-surface-container"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-medium text-on-surface [&::-webkit-details-marker]:hidden">
                {question}
                <ChevronDown className="h-4 w-4 shrink-0 text-on-surface-variant transition-transform group-open:rotate-180" />
              </summary>
              <p className="px-5 pb-4 text-sm leading-relaxed text-on-surface-variant">
                {answer}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
