import type { Metadata } from 'next'
// Published-package stylesheets: each @elah package ships its own compiled
// Tailwind utilities (the app's Tailwind does not scan node_modules). The
// --elah-* variables these classes consume are defined in globals.css .elah-root.
import '@elah/timeline/styles.css'
import '@elah/editor/styles.css'
import '@/styles/playground.css'
import { PlaygroundNav } from '@/components/playground/PlaygroundNav'

export const metadata: Metadata = {
  title: {
    template: '%s — Playground',
    default: 'Playground',
  },
}

export default function PlaygroundLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="pg-shell">
      <PlaygroundNav />
      <div className="pg-content">{children}</div>
    </div>
  )
}
