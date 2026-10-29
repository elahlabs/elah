import { siteConfig } from '@/config/site'

/**
 * Single source of truth for site navigation. The header (`SiteNav`) and the
 * footer (`SiteFooter`) both read from here; `components/landing/landingData.ts`
 * re-exports these names for the landing components. Every internal href must
 * resolve to an `app/**\/page.tsx` route (anchors are checked against the
 * route part only).
 */

export interface NavLink {
  label: string
  href: string
}

export interface FooterColumn {
  heading: string
  links: NavLink[]
}

export const GITHUB_URL = siteConfig.links.github
export const DISCORD_URL = siteConfig.links.discord
export const GET_STARTED_URL = '/docs/getting-started'
export const EDITOR_URL = '/playground/production'
export const CONTACT_URL = 'mailto:paul@elah.dev'

/**
 * Elah Creator, the hosted editor for people making videos rather than code.
 * Links go to `/login` because the creator's `/` redirects there and drops the
 * query string. `placement` names the button so the UTM tags tell them apart.
 */
export function creatorUrl(placement: string): string {
  const url = new URL('https://creator.elahlabs.com/login')
  url.searchParams.set('utm_source', 'elah.dev')
  url.searchParams.set('utm_medium', 'landing')
  url.searchParams.set('utm_campaign', 'try-elah-creator')
  url.searchParams.set('utm_content', placement)
  return url.toString()
}

/** Primary header links, in display order. */
export const navLinks: NavLink[] = [
  { label: 'Motion', href: '/motion' },
  { label: 'Claude', href: '/claude' },
  { label: 'Docs', href: '/docs' },
  { label: 'Playgrounds', href: '/playgrounds' },
  { label: 'Examples', href: '/examples' },
  { label: 'Blog', href: '/blog' },
]

export const footerColumns: FooterColumn[] = [
  {
    heading: 'Product',
    links: [
      { label: 'Docs', href: '/docs' },
      { label: 'Examples', href: '/examples' },
      { label: 'Playgrounds', href: '/playgrounds' },
      { label: 'Motion', href: '/motion' },
      { label: 'Claude', href: '/claude' },
      { label: 'Blog', href: '/blog' },
      { label: 'Changelog', href: '/changelog' },
    ],
  },
  {
    heading: 'Developers',
    links: [
      { label: 'Getting Started', href: GET_STARTED_URL },
      { label: 'API Reference', href: '/docs/api' },
      { label: 'Timeline API', href: '/docs/timeline' },
      { label: 'Editor API', href: '/docs/editor' },
      { label: 'Motion', href: '/docs/motion' },
      { label: 'HTML scenes & VideoSpec', href: '/docs/scenes' },
      { label: 'Export Pipeline', href: '/docs/export' },
      { label: 'Architecture', href: '/docs/architecture' },
      { label: 'For agents', href: '/docs/agents' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'GitHub', href: GITHUB_URL },
      { label: 'Discord', href: DISCORD_URL },
      { label: 'Contact', href: CONTACT_URL },
      { label: 'Contributing', href: `${GITHUB_URL}/blob/main/CONTRIBUTING.md` },
      { label: 'License', href: `${GITHUB_URL}/blob/main/LICENSE` },
    ],
  },
]

export type NavVariant = 'floating' | 'bar'

/**
 * Which header a route gets. Docs have a persistent sidebar, so a nav that
 * hides while you read long pages is hostile: they get the stable bar.
 * Everything else with site chrome gets the floating pill.
 */
export function navVariantFor(pathname: string | null): NavVariant {
  return pathname === '/docs' || pathname?.startsWith('/docs/') ? 'bar' : 'floating'
}

/** True when `href` is the current section: exact match or a parent path. */
export function isActiveHref(pathname: string | null, href: string): boolean {
  if (!pathname || !href.startsWith('/')) return false
  const path = href.split('#')[0]
  return pathname === path || pathname.startsWith(path + '/')
}
