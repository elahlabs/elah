import type { Metadata } from 'next'
import Link from 'next/link'
import { Github } from 'lucide-react'
// Published-package stylesheets: each @elah package ships its own compiled
// Tailwind utilities (the app's Tailwind does not scan node_modules). The
// --elah-* variables these classes consume are defined in globals.css .elah-root.
import '@elah/timeline/styles.css'
import '@elah/editor/styles.css'
import '@/styles/playground.css'
import { PlaygroundTabs } from '@/components/playground/PlaygroundTabs'
import { siteConfig } from '@/config/site'

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
        <span className="pg-brand">
          <span className="pg-brand-dot" />
          <span className="pg-brand-name">elah</span>
          <span className="pg-brand-pkg">@elah/editor</span>
        </span>
        <PlaygroundTabs />
        <a
          href={siteConfig.links.github}
          target="_blank"
          rel="noopener noreferrer"
          className="pg-nav-link"
          title="View source on GitHub"
        >
          <Github size={14} />
        </a>
      </nav>
      <div className="pg-content">{children}</div>
    </div>
  )
}
