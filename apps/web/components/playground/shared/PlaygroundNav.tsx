'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Github } from 'lucide-react'
import { PlaygroundTabs } from './PlaygroundTabs'
import { siteConfig } from '@/config/site'

// The production editor folds this navigation into its own single header
// (AppHeader), so the shared playground chrome is suppressed on that route.
const MERGED_ROUTES = new Set(['/playground/production'])

export function PlaygroundNav() {
  const pathname = usePathname()
  if (MERGED_ROUTES.has(pathname)) return null

  return (
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
  )
}
