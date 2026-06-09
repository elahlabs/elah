import type { Metadata } from 'next'
import Link from 'next/link'
import '@/styles/playground.css'
import { PlaygroundTabs } from '@/components/playground/PlaygroundTabs'

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
      <nav className="pg-nav">
        <Link href="/playgrounds" className="pg-nav-back">
          ← Playgrounds
        </Link>
        <div className="pg-nav-divider" />
        <span style={{ fontSize: 12, color: 'var(--pg-text-muted)' }}>
          @elah/editor
        </span>
        <PlaygroundTabs />
      </nav>
      <div className="pg-content">{children}</div>
    </div>
  )
}
