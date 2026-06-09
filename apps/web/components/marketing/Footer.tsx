import Link from 'next/link'
import { Layers } from 'lucide-react'

const footerLinks = {
  Product: [
    { label: 'Docs', href: '/docs' },
    { label: 'Examples', href: '/examples' },
    { label: 'Playgrounds', href: '/playgrounds' },
    { label: 'Changelog', href: '/blog' },
    { label: 'Pricing', href: '/pricing' },
  ],
  Developers: [
    { label: 'Getting Started', href: '/docs/getting-started' },
    { label: 'Timeline API', href: '/docs/api#timeline-engine' },
    { label: 'Editor API', href: '/docs/editor' },
    { label: 'Export Pipeline', href: '/docs/export' },
    { label: 'Architecture', href: '/docs#architecture' },
  ],
  Company: [
    { label: 'GitHub', href: 'https://github.com/elahlabs/elah' },
    { label: 'Contributing', href: 'https://github.com/elahlabs/elah/blob/main/CONTRIBUTING.md' },
    { label: 'License', href: 'https://github.com/elahlabs/elah/blob/main/LICENSE' },
  ],
}

export function Footer() {
  return (
    <footer className="border-t border-outline-variant bg-surface-low">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="mb-4 flex items-center gap-2 no-underline">
              <div className="flex h-6 w-6 items-center justify-center rounded bg-primary">
                <Layers className="h-3.5 w-3.5 text-white" />
              </div>
              <span className="text-sm font-semibold text-on-surface">
                elah
              </span>
            </Link>
            <p className="mt-3 text-xs leading-relaxed text-on-surface-variant" style={{ maxWidth: '18rem' }}>
              Browser-native video infrastructure. Engine-first, renderer-agnostic, built for production creative tooling.
            </p>
            <div className="mt-4 flex gap-1">
              <span className="label-mono rounded border border-outline-variant px-2 py-0.5 text-2xs text-on-surface-variant">
                WebCodecs
              </span>
              <span className="label-mono rounded border border-outline-variant px-2 py-0.5 text-2xs text-on-surface-variant">
                WebGL2
              </span>
              <span className="label-mono rounded border border-outline-variant px-2 py-0.5 text-2xs text-on-surface-variant">
                React
              </span>
            </div>
          </div>

          {/* Link columns */}
          {Object.entries(footerLinks).map(([title, links]) => (
            <div key={title}>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-on-surface-variant">
                {title}
              </h3>
              <ul className="space-y-2">
                {links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-on-surface-variant no-underline transition-colors hover:text-on-surface"
                      {...(link.href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col items-start justify-between gap-3 border-t border-outline-variant pt-6 sm:flex-row sm:items-center">
          <p className="text-xs text-on-surface-variant">
            © {new Date().getFullYear()} elah. Open source under MIT license.
          </p>
          <p className="label-mono text-2xs text-on-surface-variant opacity-60">
            Built with Next.js · Deployed on Vercel
          </p>
        </div>
      </div>
    </footer>
  )
}
