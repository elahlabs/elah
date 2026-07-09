import type { Metadata } from 'next'
import Link from 'next/link'
import { Package, ExternalLink } from 'lucide-react'
import { Navbar } from '@/components/marketing/Navbar'
import { Footer } from '@/components/marketing/Footer'
import { releases, currentVersion, type ChangeKind } from '@/config/changelog'
import { formatDate, cn } from '@/lib/utils'

export const metadata: Metadata = {
  title: 'Changelog',
  description: `What's new in the elah packages (@elah/core, @elah/timeline, @elah/editor). Currently v${currentVersion}.`,
  alternates: { canonical: '/changelog' },
}

const kindLabel: Record<ChangeKind, string> = {
  added: 'Added',
  changed: 'Changed',
  fixed: 'Fixed',
}

const kindStyles: Record<ChangeKind, string> = {
  added: 'bg-green-50 text-green-800 border-green-200 dark:bg-green-500/10 dark:text-green-300 dark:border-green-500/20',
  changed: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20',
  fixed: 'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-500/20',
}

export default function ChangelogPage() {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <Navbar />

      <main className="flex-1">
        {/* Header */}
        <div className="border-b border-outline-variant bg-surface py-14">
          <div className="mx-auto max-w-3xl px-4 sm:px-6">
            <div className="label-mono mb-3 text-2xs text-on-surface-variant opacity-90">
              Changelog
            </div>
            <h1
              className="text-3xl font-semibold tracking-tight text-on-surface md:text-4xl"
              style={{ fontFamily: 'var(--font-inter), sans-serif' }}
            >
              What&apos;s new in elah
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-on-surface-variant">
              Release notes for the published packages — <code className="font-mono text-xs">@elah/core</code>,{' '}
              <code className="font-mono text-xs">@elah/timeline</code>, and{' '}
              <code className="font-mono text-xs">@elah/editor</code>. All three ship together and share a version.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
                <Package className="h-3.5 w-3.5" />
                Latest: v{currentVersion}
              </span>
              <Link
                href="https://www.npmjs.com/package/@elah/editor"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-on-surface-variant transition-colors hover:text-on-surface"
              >
                View on npm
                <ExternalLink className="h-3 w-3" />
              </Link>
              <Link
                href="https://github.com/elahlabs/elah/blob/main/CHANGELOG.md"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-on-surface-variant transition-colors hover:text-on-surface"
              >
                CHANGELOG.md
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          </div>
        </div>

        {/* Releases */}
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
          <div className="flex flex-col gap-14">
            {releases.map((release) => (
              <section
                key={release.version}
                id={`v${release.version}`}
                className="scroll-mt-20"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2
                    className="text-xl font-semibold tracking-tight text-on-surface"
                    style={{ fontFamily: 'var(--font-inter), sans-serif' }}
                  >
                    <span className="font-mono text-primary">v{release.version}</span>
                  </h2>
                  {release.latest && (
                    <span className="rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-2xs font-medium text-primary">
                      Latest
                    </span>
                  )}
                  <time className="text-xs text-on-surface-variant opacity-70">
                    {formatDate(release.date)}
                  </time>
                </div>

                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-on-surface-variant">
                  {release.summary}
                </p>

                <div className="mt-6 flex flex-col gap-6">
                  {release.groups.map((group, gi) => (
                    <div key={gi}>
                      <div className="mb-2.5 flex items-center gap-2">
                        <span
                          className={cn(
                            'inline-flex items-center rounded border px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide',
                            kindStyles[group.kind]
                          )}
                        >
                          {kindLabel[group.kind]}
                        </span>
                        {group.scope && (
                          <code className="rounded bg-surface-low px-1.5 py-0.5 font-mono text-2xs text-on-surface-variant">
                            {group.scope}
                          </code>
                        )}
                      </div>
                      <ul className="flex flex-col gap-1.5 border-l border-outline-variant pl-4">
                        {group.items.map((item, ii) => (
                          <li
                            key={ii}
                            className="text-sm leading-relaxed text-on-surface-variant"
                          >
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <div className="mt-16 border-t border-outline-variant pt-6">
            <p className="text-xs leading-relaxed text-on-surface-variant">
              Following{' '}
              <a
                href="https://semver.org"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Semantic Versioning
              </a>
              . Have a question about a release? Ask on{' '}
              <a
                href="https://discord.gg/8CeZ2XbPy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Discord
              </a>
              .
            </p>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
