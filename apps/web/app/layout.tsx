import type { Metadata, Viewport } from 'next'
import { Inter, Geist, Geist_Mono, Big_Shoulders } from 'next/font/google'
// Published-package stylesheets are imported here (root layout) rather than
// in the playground/editor nested layouts so their cascade position is fixed
// at first paint. When they were imported per-route, client-side back
// navigation could leave their <link> after the app's globals.css in <head>,
// letting their unscoped `.hidden` utility beat globals.css's `md:` variants
// and collapse the marketing Navbar to its mobile toggle on every page.
import '@elah/timeline/styles.css'
import '@elah/editor/styles.css'
import '@/styles/globals.css'
import '@/styles/landing.css'
import { siteConfig } from '@/config/site'
import { ThemeProvider } from '@/components/ThemeProvider'
import { JsonLd } from '@/components/seo/JsonLd'
import { RedditPixel } from '@/components/RedditPixel'
import { ConsentProvider } from '@/components/ConsentProvider'
import { ConsentBanner } from '@/components/ConsentBanner'
import { InstallBanner } from '@/components/InstallBanner'
import { ServiceWorkerRegistrar } from '@/components/ServiceWorkerRegistrar'

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

// Condensed display face for headings and the wordmark.
const displayFace = Big_Shoulders({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  weight: ['700', '800'],
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
    { media: '(prefers-color-scheme: light)', color: '#06070a' },
    { media: '(prefers-color-scheme: dark)', color: '#06070a' },
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

// Site-wide theme, applied before first paint so there is no flash. Order:
// stored choice (elah-theme), the homepage's old key (elah-lp-theme, migrated
// once), then the system preference.
const themeInitScript = `(function(){try{var d=document.documentElement,t=localStorage.getItem('elah-theme');if(t!=='light'&&t!=='dark'){var o=localStorage.getItem('elah-lp-theme');if(o==='light'||o==='dark'){t=o;localStorage.setItem('elah-theme',o)}else{t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}}d.classList.toggle('dark',t==='dark')}catch(e){}})();`

// beforeinstallprompt can fire before React hydrates (e.g. a repeat visit
// with an already-active service worker), so a useEffect listener in
// useInstallPrompt would miss it. Park the event on window here, before
// hydration, and re-broadcast it as a plain event the hook can pick up
// whenever it mounts. preventDefault() is mandatory — without it Chromium
// shows its own mini-infobar and we lose control of the moment.
const installPromptScript = `
  window.__elahInstallPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    window.__elahInstallPrompt = e;
    window.dispatchEvent(new Event('elah:installprompt'));
  });
  window.addEventListener('appinstalled', function () {
    window.__elahInstallPrompt = null;
    window.dispatchEvent(new Event('elah:appinstalled'));
  });
`

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script dangerouslySetInnerHTML={{ __html: installPromptScript }} />
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
        className={`${inter.variable} ${geist.variable} ${geistMono.variable} ${displayFace.variable} bg-surface text-on-surface antialiased`}
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
        <ServiceWorkerRegistrar />
        <ConsentProvider>
          <RedditPixel />
          <ThemeProvider>{children}</ThemeProvider>
          <ConsentBanner />
          <InstallBanner />
        </ConsentProvider>
      </body>
    </html>
  )
}
