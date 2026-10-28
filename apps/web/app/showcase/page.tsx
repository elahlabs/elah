import type { Metadata } from 'next'
import { JsonLd } from '@/components/seo/JsonLd'
import { siteConfig } from '@/config/site'
import { showcase } from '@/config/showcase'
import { Navbar } from '@/components/marketing/Navbar'
import { Footer } from '@/components/marketing/Footer'
import { ShowcaseCard } from '@/components/landing/ShowcaseCard'
import { ArrowUpRight } from 'lucide-react'
import { PageHeader } from '@/components/site/PageHeader'
import { Slate, btnSecondary, btnSmall, cardLight, container, h2, label, lead, sectionY } from '@/components/eb'

export const metadata: Metadata = {
  title: 'Showcase',
  description: 'Projects and tools built with elah.',
  alternates: { canonical: '/showcase' },
  // Hidden from navigation, sitemap and the agents index; reachable by direct link only.
  robots: { index: false, follow: false },
}

// No `?template=` query: the repo's ISSUE_TEMPLATE folder has no showcase template.
const SUBMIT_URL = `${siteConfig.links.github}/issues/new`

const absolute = (href: string) => (href.startsWith('http') ? href : `${siteConfig.url}${href}`)

const itemListJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  name: 'Built with elah',
  itemListElement: showcase.map((entry, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: entry.name,
    description: entry.description,
    url: absolute(entry.href),
  })),
}

export default function ShowcasePage() {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <JsonLd data={itemListJsonLd} />
      <Navbar />
      <main id="main" className="flex-1">
        <PageHeader
          eyebrow="Showcase"
          title="Built with elah."
          lede="A hosted product, reference editors, example apps, and a render server. Every card below opens something real."
        />

        <section className={`${container} pt-12 ${sectionY}`}>
          <Slate n={1} label="Showcase" kicker={`${showcase.length} projects`} />
          <div className="grid grid-cols-1 gap-4 pt-10 md:grid-cols-2 lg:grid-cols-3">
            {showcase.map((entry) => (
              <ShowcaseCard key={entry.slug} entry={entry} />
            ))}
          </div>

          <div className={`${cardLight} mt-12`}>
            <div className={`text-on-surface-variant ${label}`}>Built something?</div>
            <h2 className={h2}>Share your project</h2>
            <p className={`${lead} max-w-[560px]`}>
              If you have built something with elah, open an issue on GitHub with a link and a line about what it does, and we will
              consider it for this page.
            </p>
            <div>
              <a href={SUBMIT_URL} target="_blank" rel="noopener noreferrer" className={`${btnSecondary} ${btnSmall}`}>
                Open an issue on GitHub
                <ArrowUpRight size={15} aria-hidden />
              </a>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
