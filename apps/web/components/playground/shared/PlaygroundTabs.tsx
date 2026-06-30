'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const tabs = [
  { label: 'Production', href: '/playground/production' },
  { label: 'Timeline', href: '/playground/timeline' },
  { label: 'Raw', href: '/playground/raw' },
]

export function PlaygroundTabs() {
  const pathname = usePathname()

  return (
    <div className="pg-nav-tabs">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className="pg-nav-tab"
          data-active={pathname === tab.href ? 'true' : 'false'}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  )
}
