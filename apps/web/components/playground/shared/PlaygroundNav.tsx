'use client'

import { usePathname } from 'next/navigation'
import { Github } from 'lucide-react'
import { PlaygroundTabs } from './PlaygroundTabs'
import { BackButton } from './BackButton'
import { siteConfig } from '@/config/site'

// The production editor folds this navigation into its own single header
// (AppHeader), so the shared playground chrome is suppressed on that route.
const MERGED_ROUTES = new Set(['/playground/production'])

// Brand package label per tab — falls back to the editor package.
const PKG_BY_ROUTE: Record<string, string> = {
  '/playground/timeline': '@elah/timeline',
}

export function PlaygroundNav() {
  const pathname = usePathname()
  if (MERGED_ROUTES.has(pathname)) return null

  return (
    <nav className="pg-nav">
      <BackButton />
      <div className="pg-nav-divider" />
      <span className="pg-brand">
        <span className="pg-brand-dot" />
        <span className="pg-brand-name">elah</span>
        <span className="pg-brand-pkg">{PKG_BY_ROUTE[pathname] ?? '@elah/editor'}</span>
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
