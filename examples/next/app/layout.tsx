import type { Metadata } from 'next'
// The SDK ships THREE stylesheets and you need all of them. Each package
// compiles its own — @elah/timeline's Tailwind build only scans its own source,
// so @elah/editor/styles.css does not contain the timeline's classes:
//
//   1. timeline/styles.css       — ruler, tracks, clips, playhead, trim handles
//   2. editor/styles.css         — Preview, AssetPanel, ElementsPanel, SourcePanel
//   3. editor/styles/tokens.css  — the 130+ --elah-* design tokens both consume
//
// Skip tokens.css only if your app already defines --elah-* inside .elah-root.
// Import your own CSS last so it can override.
import '@elah/timeline/styles.css'
import '@elah/editor/styles.css'
import '@elah/editor/styles/tokens.css'
import './globals.css'

export const metadata: Metadata = {
  title: '@elah/editor — Next.js Example',
  description: 'Standalone Next.js showcase of the @elah/editor production editor, installed from npm.',
  // Declared inline so the browser's automatic /favicon.ico request does not
  // 404 into the console. Swap it for your own icon.
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3' fill='%23b7102a'/%3E%3Cpath d='M6 4.5v7l5-3.5z' fill='%23fff'/%3E%3C/svg%3E",
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
