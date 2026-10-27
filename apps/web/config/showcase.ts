/**
 * Single source of truth for the /showcase page and the landing page's
 * ShowcaseTeaser. Plain data, no JSX. Every entry must be real and reachable:
 * do not add placeholders or "coming soon" cards.
 */

import { siteConfig } from '@/config/site'

export type ShowcaseKind = 'app' | 'playground' | 'example' | 'server'
export type ShowcaseStatus = 'live' | 'preview'

export interface ShowcaseEntry {
  slug: string
  name: string
  kind: ShowcaseKind
  /** Maker, shown when it is not the elah project itself. */
  by?: string
  description: string
  tags: string[]
  href: string
  /** Opens off-site: rendered as a new-tab anchor instead of a Next link. */
  external?: boolean
  status: ShowcaseStatus
  featured?: boolean
}

export const kindLabel: Record<ShowcaseKind, string> = {
  app: 'Hosted app',
  playground: 'Playground',
  example: 'Example app',
  server: 'Server',
}

// Same expression as app/examples/page.tsx, so the three tree URLs cannot drift.
const exampleHref = (dir: string) => `${siteConfig.links.github}/tree/main/examples/${dir}`

export const showcase: ShowcaseEntry[] = [
  {
    slug: 'elah-creator',
    name: 'Elah Creator',
    kind: 'app',
    by: 'Elah Labs',
    description:
      'The hosted product built on this engine: an editor you drive by asking, plus assisted rotoscoping in pilot. It is sales-led — you request access rather than sign up.',
    tags: ['Hosted', 'Assistant', 'Rotoscoping (pilot)'],
    href: 'https://creator.elahlabs.com',
    external: true,
    status: 'live',
    featured: true,
  },
  {
    slug: 'full-editor-playground',
    name: 'Full Editor playground',
    kind: 'playground',
    description:
      'The reference implementation: asset panel, GPU-accelerated preview, interactive overlays, timeline, audio, transitions, and MP4 export, all wired together.',
    tags: ['@elah/editor', 'WebGL2', 'Export'],
    href: '/playground/production',
    status: 'live',
    featured: true,
  },
  {
    slug: 'timeline-playground',
    name: 'Timeline playground',
    kind: 'playground',
    description:
      'The timeline on its own: tracks, clips, snapping, and keyboard shortcuts over the TimelineEngine, without the full editor stack.',
    tags: ['@elah/timeline', 'Integration'],
    href: '/playground/timeline',
    status: 'live',
  },
  {
    slug: 'full-editor-demo',
    name: 'Full Editor demo',
    kind: 'playground',
    description:
      'A guided session with pre-loaded sample media that walks through cut, trim, text, transitions, and export.',
    tags: ['Guided', 'Sample media'],
    href: '/playground/raw',
    status: 'preview',
  },
  {
    slug: 'example-minimal',
    name: 'Minimal starter',
    kind: 'example',
    description:
      'The smallest complete editor on Vite and React: import media, drag it onto the timeline, scrub, and play. Start here when building a custom UI.',
    tags: ['Vite', 'React 19', '~130 lines'],
    href: exampleHref('minimal'),
    external: true,
    status: 'live',
  },
  {
    slug: 'example-react',
    name: 'React example',
    kind: 'example',
    description:
      'A complete production editor, with preview, timeline, asset and element panels, text inspector, and MP4 export, as a standalone Vite app consuming @elah/editor from npm.',
    tags: ['Vite', 'React 19', 'Export'],
    href: exampleHref('react'),
    external: true,
    status: 'live',
  },
  {
    slug: 'example-next',
    name: 'Next.js example',
    kind: 'example',
    description:
      'The same full editor in a Next.js App Router app, including the client-only dynamic import and the transpilePackages config needed to ship it.',
    tags: ['Next.js 16', 'App Router'],
    href: exampleHref('next'),
    external: true,
    status: 'live',
  },
  {
    slug: 'headless-render-server',
    name: 'Headless render server',
    kind: 'server',
    description:
      'npx @elah/cli serve starts a self-hosted HTTP server: POST a JSON spec, get MP4 bytes back, rendered by the same export pipeline as the browser.',
    tags: ['@elah/cli', 'HTTP', 'Playwright'],
    href: '/docs/cli#serve',
    status: 'live',
    featured: true,
  },
]
