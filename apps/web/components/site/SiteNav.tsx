'use client'

import { useEffect, useId, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, Star, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { trackEvent } from '@/lib/analytics'
import { DISCORD_URL, GET_STARTED_URL, GITHUB_URL, isActiveHref, navLinks, type NavVariant } from '@/config/nav'
import { VersionBadge } from '@/components/marketing/VersionBadge'
import { ThemeToggle, label } from '@/components/eb'
import { Logo } from './Logo'

export interface SiteNavProps {
  /** Both variants render the same hairline-cell bar; kept so callers compile. */
  variant?: NavVariant | 'pill'
  /** Ignored (the old floating pill overlapped the hero). Kept so callers compile. */
  overlap?: boolean
  /** GitHub star count shown in the GitHub cell (homepage). */
  stars?: string | null
  /** Show the version badge and Discord link. The homepage turns these off. */
  extras?: boolean
  /** Show the solid "Get started" cell. */
  cta?: boolean
}

function GitHubLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-[14px] w-[14px] fill-current" aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.4-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
    </svg>
  )
}

const cell = 'flex items-center border-l border-outline-variant px-4 sm:px-5'
const linkIdle = 'text-on-surface-variant hover:bg-on-surface hover:text-surface'
const linkActive = 'bg-on-surface text-surface'
const cta =
  'flex items-center bg-on-surface px-5 text-surface no-underline transition-colors hover:bg-[#FF003C] hover:text-[#0E0E10]'

/** Close on route change and on Escape. */
function useMenuState(pathname: string) {
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  return [open, setOpen] as const
}

/**
 * The one site header: a sticky 52px strip of hairline cells (logo, links,
 * theme, GitHub, primary action) with a full-width menu panel below lg.
 */
export function SiteNav({ stars = null, extras = true, cta: showCta = true }: SiteNavProps) {
  const pathname = usePathname() ?? '/'
  const [open, setOpen] = useMenuState(pathname)
  const panelId = useId()
  const close = () => setOpen(false)
  const row = `flex items-center border-t border-outline-variant px-5 py-4 no-underline transition-colors ${label}`

  return (
    <header className="sticky top-0 z-[60] w-full border-b border-outline-variant bg-[color-mix(in_srgb,var(--color-surface)_88%,transparent)] backdrop-blur-md">
      <nav aria-label="Primary" className="flex h-[52px] w-full items-stretch">
        <div className="flex items-center px-4 sm:px-5">
          <Logo />
        </div>

        <ul className="m-0 hidden list-none items-stretch border-l border-outline-variant p-0 lg:flex">
          {navLinks.map((l) => {
            const active = isActiveHref(pathname, l.href)
            return (
              <li key={l.href} className="flex">
                <Link
                  href={l.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn('flex items-center px-4 no-underline transition-colors', label, active ? linkActive : linkIdle)}
                >
                  {l.label}
                </Link>
              </li>
            )
          })}
        </ul>

        <div className="ml-auto flex items-stretch">
          {extras && <VersionBadge className={cn(cell, 'hidden xl:flex')} />}
          {extras && (
            <a
              href={DISCORD_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackEvent('discord_clicked', { source: 'nav_desktop' })}
              className={cn(cell, 'hidden text-on-surface no-underline transition-colors hover:bg-surface-container xl:flex', label)}
            >
              Discord
            </a>
          )}
          <ThemeToggle className={`${cell} justify-center text-on-surface transition-colors hover:bg-surface-container`} />
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={stars ? `elah on GitHub, ${stars} stars` : 'elah on GitHub'}
            className={cn(cell, 'hidden gap-2 text-on-surface no-underline transition-colors hover:bg-surface-container sm:flex', label)}
          >
            <GitHubLogo />
            GitHub
            {stars ? (
              <span className="flex items-center gap-1.5 border-l border-current pl-2 tabular-nums">
                <Star size={12} strokeWidth={2} className="fill-[#FF003C] text-[#FF003C]" aria-hidden />
                {stars}
              </span>
            ) : null}
          </a>
          {showCta && (
            <Link href={GET_STARTED_URL} className={cn(cta, label)}>
              Get started
            </Link>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            aria-controls={panelId}
            className={cn(cell, 'justify-center text-on-surface transition-colors hover:bg-surface-container lg:hidden')}
          >
            {open ? <X size={16} aria-hidden /> : <Menu size={16} aria-hidden />}
          </button>
        </div>
      </nav>

      {open && (
        <div
          id={panelId}
          className="absolute inset-x-0 top-full max-h-[calc(100dvh-52px)] overflow-y-auto border-b border-outline-variant bg-surface lg:hidden"
        >
          <nav aria-label="Mobile">
            {navLinks.map((l) => {
              const active = isActiveHref(pathname, l.href)
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={close}
                  aria-current={active ? 'page' : undefined}
                  className={cn(row, active ? linkActive : 'text-on-surface hover:bg-surface-container')}
                >
                  {l.label}
                </Link>
              )
            })}
            {extras && (
              <div onClick={close}>
                <VersionBadge block className={cn(row, 'text-on-surface')} />
              </div>
            )}
            {extras && (
              <a
                href={DISCORD_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => {
                  trackEvent('discord_clicked', { source: 'nav_mobile' })
                  close()
                }}
                className={cn(row, 'text-on-surface hover:bg-surface-container')}
              >
                Discord
              </a>
            )}
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={close}
              className={cn(row, 'gap-2 text-on-surface hover:bg-surface-container')}
            >
              <GitHubLogo />
              GitHub
              {stars ? (
                <span className="flex items-center gap-1.5 border-l border-current pl-2 tabular-nums">
                  <Star size={12} strokeWidth={2} className="fill-[#FF003C] text-[#FF003C]" aria-hidden />
                  {stars}
                </span>
              ) : null}
            </a>
            {showCta && (
              <Link href={GET_STARTED_URL} onClick={close} className={cn(cta, 'border-t border-outline-variant py-4', label)}>
                Get started
              </Link>
            )}
          </nav>
        </div>
      )}
    </header>
  )
}
