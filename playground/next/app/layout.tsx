import type { Metadata } from 'next'
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
