'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { docsNav } from '@/config/docs'

interface DocsNavListProps {
  /** Called after a link is followed — lets the mobile drawer close itself. */
  onNavigate?: () => void
  /** `false` gives roomier rows for touch; the desktop rail stays dense. */
  dense?: boolean
}

/**
 * The docs navigation tree. Shared by the desktop rail (`DocsSidebar`) and the
 * mobile drawer (`DocsMobileNav`) so both render from one source.
 */
export function DocsNavList({ onNavigate, dense = true }: DocsNavListProps) {
  const pathname = usePathname()

  const isActive = (href: string) => {
    if (href === '/docs') return pathname === '/docs'
    return pathname === href || pathname.startsWith(href + '/')
  }

  return (
    <>
      {docsNav.map((section) => (
        <div key={section.title} className="mb-6">
          <h3 className="label-mono mb-2 text-2xs text-on-surface-variant opacity-70">
            {section.title}
          </h3>
          <ul className="space-y-0.5">
            {section.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  className={cn(
                    'flex items-center justify-between rounded text-sm transition-colors',
                    dense ? 'px-2.5 py-2' : 'px-3 py-2.5',
                    isActive(item.href)
                      ? 'bg-surface-high text-on-surface font-medium'
                      : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                  )}
                >
                  <span>{item.title}</span>
                  {item.label && (
                    <span className="label-mono rounded bg-primary px-1.5 py-0.5 text-2xs text-on-primary">
                      {item.label}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  )
}

export function DocsSidebar() {
  return (
    <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-56 shrink-0 overflow-y-auto border-r border-outline-variant bg-surface py-6 md:block">
      <nav aria-label="Documentation" className="px-4">
        <DocsNavList />
      </nav>
    </aside>
  )
}
