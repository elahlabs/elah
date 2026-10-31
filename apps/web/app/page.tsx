import type { Metadata } from 'next'
import { JsonLd } from '@/components/seo/JsonLd'
import { siteConfig } from '@/config/site'
import { currentVersion } from '@/config/changelog'
import { getSiteStats, toDisplay } from '@/lib/stats'
import { HomeNav } from '@/components/landing/home/HomeNav'
import { HomeHero } from '@/components/landing/home/HomeHero'
import { HomePartners } from '@/components/landing/home/HomePartners'
import { HomeSteps } from '@/components/landing/home/HomeSteps'
import { HomeBinding } from '@/components/landing/home/HomeBinding'
import { HomeCapabilities } from '@/components/landing/home/HomeCapabilities'
import { HomeClaude } from '@/components/landing/home/HomeClaude'
import { HomePlaygrounds } from '@/components/landing/home/HomePlaygrounds'
import { HomeLibraries } from '@/components/landing/home/HomeLibraries'
import { HomeWhy } from '@/components/landing/home/HomeWhy'
import { HomeArchitecture } from '@/components/landing/home/HomeArchitecture'
import { HomeFaq } from '@/components/landing/home/HomeFaq'
import { HomeCta } from '@/components/landing/home/HomeCta'
import { HomeFooter } from '@/components/landing/home/HomeFooter'
import { ScrubBar } from '@/components/landing/home/ScrubBar'

export const metadata: Metadata = {
  title: { absolute: 'elah — write motion as code, edit it on a timeline' },
  description:
    'Open-source video engine for the browser. Write motion as code, keep it as editable clips and keyframes, and export mp4 without a server.',
  alternates: { canonical: '/' },
}

export const revalidate = 3600

const softwareJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'elah',
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Any (web browser)',
  description: siteConfig.description,
  url: siteConfig.url,
  softwareVersion: currentVersion,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
}

/** Brief section 5 order, in the "edit bay" look (components/landing/home/DESIGN.md). */
export default async function HomePage() {
  const stats = toDisplay(await getSiteStats())
  return (
    <div className="lp min-h-screen bg-[var(--lp-paper)] leading-[normal] text-[var(--lp-ink)] transition-colors duration-300 motion-reduce:transition-none">
      <JsonLd data={softwareJsonLd} />
      <HomeNav stars={stats.stars} />
      <main id="main">
        <HomeHero />
        <HomePartners />
        <HomeSteps />
        <HomeBinding />
        <HomeCapabilities />
        <HomeClaude />
        <HomePlaygrounds />
        <HomeLibraries />
        <HomeWhy />
        <HomeArchitecture />
        <HomeFaq />
        <HomeCta />
      </main>
      <HomeFooter stars={stats.stars} />
      <ScrubBar />
    </div>
  )
}
