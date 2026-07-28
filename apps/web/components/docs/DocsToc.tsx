'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

interface TocItem {
  id: string
  title: string
  level: number
}

interface DocsTocProps {
  items: TocItem[]
}

export function DocsToc({ items }: DocsTocProps) {
  const [activeId, setActiveId] = useState<string>('')

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id)
          }
        }
      },
      // Clears the tallest sticky chrome (56px navbar + 48px mobile sub-bar).
      { rootMargin: '-128px 0px -60% 0px', threshold: 0 }
    )

    items.forEach(({ id }) => {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    })

    return () => observer.disconnect()
  }, [items])

  if (items.length === 0) return null

  const links = (size: 'compact' | 'touch') => (
    <ul className="space-y-0.5">
      {items.map((item) => (
        <li key={item.id}>
          <a
            href={`#${item.id}`}
            className={cn(
              'block rounded px-2 text-xs transition-colors',
              size === 'touch' ? 'py-2' : 'py-1',
              item.level === 3 && 'pl-4',
              activeId === item.id
                ? 'text-primary font-medium'
                : 'text-on-surface-variant hover:text-on-surface'
            )}
          >
            {item.title}
          </a>
        </li>
      ))}
    </ul>
  )

  return (
    <>
      {/* Mobile + tablet: collapsible above the article. Native <details> so it
          works before hydration and needs no extra state. */}
      <details className="order-first rounded-md border border-outline-variant bg-surface-low lg:hidden">
        <summary className="label-mono cursor-pointer list-none px-4 py-3 text-2xs text-on-surface-variant">
          On this page
        </summary>
        <nav className="border-t border-outline-variant px-2 py-2">{links('touch')}</nav>
      </details>

      {/* Desktop rail */}
      <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-48 shrink-0 overflow-y-auto lg:block">
        <div className="py-6 pl-4 pr-2">
          <h4 className="label-mono mb-3 text-2xs text-on-surface-variant opacity-70">
            On this page
          </h4>
          <nav>{links('compact')}</nav>
        </div>
      </aside>
    </>
  )
}
