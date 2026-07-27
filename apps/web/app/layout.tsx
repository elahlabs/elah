import type { Metadata, Viewport } from 'next'
import { Inter, Geist, Geist_Mono, Bricolage_Grotesque } from 'next/font/google'
// Published-package stylesheets are imported here (root layout) rather than
// in the playground/editor nested layouts so their cascade position is fixed
// at first paint. When they were imported per-route, client-side back
// navigation could leave their <link> after the app's globals.css in <head>,
// letting their unscoped `.hidden` utility beat globals.css's `md:` variants
// and collapse the marketing Navbar to its mobile toggle on every page.
import '@elah/timeline/styles.css'
import '@elah/editor/styles.css'
import '@/styles/globals.css'
import { siteConfig } from '@/config/site'
import { ThemeProvider } from '@/components/ThemeProvider'
import { JsonLd } from '@/components/seo/JsonLd'
import { RedditPixel } from '@/components/RedditPixel'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

// Geist is the landing-v2 body/UI face; --font-geist-sans was previously
// referenced in globals.css but never loaded (fell back to system-ui).
const geist = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
  display: 'swap',
})

// Replaces JetBrains Mono as --font-geist-mono site-wide — the mono token now
// resolves to a real Geist Mono instead of the CSS fallback stack.
const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
  weight: ['400', '500', '600'],
})

// Display face for landing-v2 headings and the wordmark.
const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  weight: ['500', '600', '700'],
})

export const metadata: Metadata = {
  // Required for canonical URLs and og:image/twitter:image resolution — every
  // relative URL in metadata (including the file-based opengraph-image route)
  // resolves against this.
  metadataBase: new URL(siteConfig.url),
  title: {
    default: siteConfig.name,
    template: `%s — ${siteConfig.name}`,
  },
  description: siteConfig.description,
  keywords: siteConfig.keywords,
  authors: [{ name: 'elah' }],
  creator: 'elah',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: siteConfig.url,
    title: siteConfig.name,
    description: siteConfig.description,
    siteName: siteConfig.name,
  },
  twitter: {
    card: 'summary_large_image',
    title: siteConfig.name,
    description: siteConfig.description,
  },
  // Favicon + touch icon are provided by app/icon.png and app/apple-icon.png
  // (Next.js file-based metadata), so no manual `icons` entry is needed.
}

// viewport-fit=cover lets the editor's mobile bottom bar pad itself with
// env(safe-area-inset-bottom) instead of floating above the home indicator.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fcf9f8' },
    { media: '(prefers-color-scheme: dark)', color: '#111010' },
  ],
}

// Site-wide schema.org entities. Page-specific schema (SoftwareApplication,
// FAQPage, BlogPosting) lives with the pages that own it.
const organizationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: siteConfig.name,
  url: siteConfig.url,
  logo: `${siteConfig.url}/icon.png`,
  sameAs: [siteConfig.links.github, 'https://www.npmjs.com/package/@elah/editor'],
}

const webSiteJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: siteConfig.name,
  url: siteConfig.url,
  description: siteConfig.description,
}

// The site is dark-only. Apply the class before first paint so there is no
// flash of the light fallback tokens.
const themeInitScript = `document.documentElement.classList.add('dark');`

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {/* Material Symbols icon font — used by the landing-v2 editor mockups
            and section chrome. Variable axes requested so weights/fill match. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block"
        />
        {/* Plain <link> rather than metadata alternates.types: pages that set
            their own `alternates` (canonicals) would replace it entirely. */}
        <link
          rel="alternate"
          type="application/rss+xml"
          title="elah blog"
          href="/feed.xml"
        />
      </head>
      <body
        className={`${inter.variable} ${geist.variable} ${geistMono.variable} ${bricolage.variable} bg-surface text-on-surface antialiased`}
        style={{ fontFamily: 'var(--font-inter), system-ui, sans-serif' }}
      >
        <a
          href="#main"
          className="sr-only rounded bg-primary px-4 py-2 text-sm font-medium text-on-primary focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
        >
          Skip to content
        </a>
        <JsonLd data={organizationJsonLd} />
        <JsonLd data={webSiteJsonLd} />
        <RedditPixel />
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
