import type { Metadata } from 'next'
import { JsonLd } from '@/components/seo/JsonLd'
import { siteConfig } from '@/config/site'
import { currentVersion } from '@/config/changelog'
import { LandingNav } from '@/components/landing/LandingNav'
import { LandingHero } from '@/components/landing/LandingHero'
import { SpecStrip, Architecture, DataFlow, Integration, Faq, Cta } from '@/components/landing/LandingSections'
import { LandingLibraries } from '@/components/landing/LandingLibraries'
import { LandingPlaygrounds } from '@/components/landing/LandingPlaygrounds'
import { LandingFooter } from '@/components/landing/LandingFooter'

export const metadata: Metadata = {
  title: { absolute: 'elah — browser-native, frame-accurate video editing engine' },
  alternates: { canonical: '/' },
}

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

export default function HomePage() {
  return (
    <div className="landing-root" style={{ minHeight: '100vh' }}>
      <JsonLd data={softwareJsonLd} />
      <LandingNav />
      <main>
        <LandingHero />
        <SpecStrip />
        <LandingLibraries />
        <Architecture />
        <DataFlow />
        <LandingPlaygrounds />
        <Integration />
        <Faq />
        <Cta />
      </main>
      <LandingFooter />
    </div>
  )
}
