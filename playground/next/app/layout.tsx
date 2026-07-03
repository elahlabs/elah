import type { Metadata } from 'next'
// The SDK ships the CSS its components (Timeline, Preview, Asset/Elements
// panels) need. Import it first so our local globals.css can still override.
import '@elah/editor/styles.css'
import './globals.css'

export const metadata: Metadata = {
  title: '@elah/editor — Next.js Playground',
  description: 'Standalone Next.js showcase of the @elah/editor production editor, installed from npm.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
