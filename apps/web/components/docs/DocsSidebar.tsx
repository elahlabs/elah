'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { docsNav } from '@/config/docs'

export function DocsSidebar() {
  const pathname = usePathname()

  const isActive = (href: string) => {
    if (href === '/docs') return pathname === '/docs'
    return pathname === href || pathname.startsWith(href + '/')
  }

  return (
    <aside className="sticky top-14 h-[calc(100vh-3.5rem)] w-56 shrink-0 overflow-y-auto border-r border-outline-variant bg-surface py-6">
      <nav className="px-4">
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
                    className={cn(
                      'flex items-center justify-between rounded px-2.5 py-1.5 text-sm transition-colors',
                      isActive(item.href)
                        ? 'bg-surface-high text-on-surface font-medium'
                        : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                    )}
                  >
                    <span>{item.title}</span>
                    {item.label && (
                      <span className="label-mono rounded bg-primary px-1.5 py-0.5 text-2xs text-white">
                        {item.label}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  )
}
