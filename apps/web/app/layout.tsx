import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import '@/styles/globals.css'
import { siteConfig } from '@/config/site'
import { ThemeProvider } from '@/components/ThemeProvider'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
  weight: ['400', '500', '600'],
})

export const metadata: Metadata = {
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

// Runs synchronously before first paint to avoid flash of wrong theme.
// Defaults to light mode; only an explicit saved choice can switch to dark.
const themeInitScript = `
(function(){
  try{
    var t=localStorage.getItem('ps-theme');
    if(t==='dark') document.documentElement.classList.add('dark');
  }catch(e){}
})();
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
      </head>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} bg-surface text-on-surface antialiased`}
        style={{ fontFamily: 'var(--font-inter), system-ui, sans-serif' }}
      >
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
