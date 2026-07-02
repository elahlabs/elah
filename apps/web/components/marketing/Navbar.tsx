'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { Menu, X, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
import { ThemeToggle } from '@/components/ThemeToggle'

const navLinks = [
  { label: 'Docs', href: '/docs' },
  { label: 'Architecture', href: '/docs/architecture' },
  { label: 'Examples', href: '/examples' },
  { label: 'Playgrounds', href: '/playgrounds' },
  { label: 'Blog', href: '/blog' },
  { label: 'Pricing', href: '/pricing' },
]

export function Navbar() {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 border-b border-outline-variant bg-surface/95 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2.5 text-on-surface no-underline transition-opacity hover:opacity-75"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/elah-mark.png" alt="elah logo" className="h-6 w-6" />
          <span
            className="text-sm font-semibold tracking-tight"
            style={{ fontFamily: 'var(--font-inter), system-ui, sans-serif' }}
          >
            elah
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                'rounded px-3 py-1.5 text-sm transition-colors',
                pathname === link.href || pathname.startsWith(link.href + '/')
                  ? 'bg-surface-high text-on-surface font-medium'
                  : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface',
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Desktop actions */}
        <div className="hidden items-center gap-2 md:flex">
          <Link
            href="https://discord.gg/8CeZ2XbPy"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded px-3 py-1.5 text-sm text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
          >
            Discord
            <ExternalLink className="h-3 w-3" />
          </Link>
          <Link
            href="https://github.com/elahlabs/elah"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded px-3 py-1.5 text-sm text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
          >
            GitHub
            <ExternalLink className="h-3 w-3" />
          </Link>
          <ThemeToggle />
          <Link
            href="/docs/getting-started"
            className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
          >
            Get Started
          </Link>
        </div>

        {/* Mobile menu toggle */}
        <button
          className="flex h-8 w-8 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-container md:hidden"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </button>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="border-t border-outline-variant bg-surface px-4 pb-4 pt-2 md:hidden"
          >
            <nav className="flex flex-col gap-1">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    'rounded px-3 py-2 text-sm transition-colors',
                    pathname === link.href
                      ? 'bg-surface-high text-on-surface font-medium'
                      : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface',
                  )}
                >
                  {link.label}
                </Link>
              ))}
              <Link
                href="https://discord.gg/8CeZ2XbPy"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-1.5 rounded px-3 py-2 text-sm text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
              >
                Discord
                <ExternalLink className="h-3 w-3" />
              </Link>
              <Link
                href="https://github.com/elahlabs/elah"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-1.5 rounded px-3 py-2 text-sm text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
              >
                GitHub
                <ExternalLink className="h-3 w-3" />
              </Link>
              <div className="mt-2 flex items-center justify-between border-t border-outline-variant pt-2">
                <ThemeToggle />
                <Link
                  href="/docs/getting-started"
                  onClick={() => setMobileOpen(false)}
                  className="block rounded bg-primary px-3 py-2 text-center text-sm font-medium text-white"
                >
                  Get Started
                </Link>
              </div>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}
