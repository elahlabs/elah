import type { Metadata } from 'next'
import Link from 'next/link'
import { Package, ExternalLink } from 'lucide-react'
import { Navbar } from '@/components/marketing/Navbar'
import { Footer } from '@/components/marketing/Footer'
import { releases, currentVersion, type ChangeKind } from '@/config/changelog'
import { siteConfig } from '@/config/site'
import { formatDate } from '@/lib/utils'
import { PageHeader } from '@/components/site/PageHeader'
import { container, display, label, mono, outline, sectionY } from '@/components/eb'

const tag = `inline-flex items-center bg-surface-low px-2 py-[3px] ${label} ${outline}`
const textLink = 'text-on-surface underline decoration-primary underline-offset-4 hover:bg-surface-container'

export const metadata: Metadata = {
  title: 'Changelog',
  description: `What's new in the elah packages (@elah/core, @elah/timeline, @elah/editor, @elah/cli). Currently v${currentVersion}.`,
  alternates: { canonical: '/changelog' },
}

const kindLabel: Record<ChangeKind, string> = {
  added: 'Added',
  changed: 'Changed',
  fixed: 'Fixed',
}

export default function ChangelogPage() {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <Navbar />

      <main className="flex-1">
        {/* Header */}
        <PageHeader
          eyebrow="Changelog"
          title="What&apos;s new in elah"
          lede={
            <>
              Release notes for the published packages — <code className={`text-[13px] ${mono}`}>@elah/core</code>,{' '}
              <code className={`text-[13px] ${mono}`}>@elah/timeline</code>, and{' '}
              <code className={`text-[13px] ${mono}`}>@elah/editor</code> ship together and share a version.{' '}
              <code className={`text-[13px] ${mono}`}>@elah/cli</code> is a separate package that versions independently.
            </>
          }
         
        >
          <div className="mt-5 flex flex-wrap items-center gap-3">
              <span className={`inline-flex items-center gap-1.5 bg-surface-low px-3 py-1 text-on-surface ${label} ${outline}`}>
                <Package className="h-3.5 w-3.5" />
                Latest: v{currentVersion}
              </span>
              <Link
                href="https://www.npmjs.com/package/@elah/editor"
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-1.5 ${label} ${textLink}`}
              >
                View on npm
                <ExternalLink className="h-3 w-3" />
              </Link>
              <Link
                href="https://github.com/elahlabs/elah/blob/main/CHANGELOG.md"
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-1.5 ${label} ${textLink}`}
              >
                CHANGELOG.md
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
        </PageHeader>

        {/* Releases */}
        <div className={`${container} pt-12 ${sectionY}`}>
          <div className="flex max-w-3xl flex-col gap-14">
            {releases.map((release) => (
              <section
                key={release.version}
                id={`v${release.version}`}
                className="scroll-mt-20"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 className={`m-0 text-[40px] leading-[0.95] font-extrabold tracking-[-0.3px] text-on-surface ${display}`}>
                    v{release.version}
                  </h2>
                  {release.latest && (
                    <span className={tag}>
                      Latest
                    </span>
                  )}
                  <time className={`text-on-surface-variant ${label}`}>
                    {formatDate(release.date)}
                  </time>
                </div>

                <p className="mt-3 max-w-2xl text-[15px] leading-[23px] text-on-surface-variant">
                  {release.summary}
                </p>

                <div className="mt-6 flex flex-col gap-6">
                  {release.groups.map((group, gi) => (
                    <div key={gi}>
                      <div className="mb-2.5 flex items-center gap-2">
                        <span className={tag}>{kindLabel[group.kind]}</span>
                        {group.scope && (
                          <code className={`bg-surface-low px-2 py-[3px] text-on-surface-variant ${label} ${outline}`}>
                            {group.scope}
                          </code>
                        )}
                      </div>
                      <ul className="flex flex-col gap-1.5 border-l border-outline-variant pl-4">
                        {group.items.map((item, ii) => (
                          <li
                            key={ii}
                            className="text-[15px] leading-[23px] text-on-surface-variant"
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

          <div className="mt-16 max-w-3xl border-t border-outline-variant pt-6">
            <p className="text-[13px] leading-[20px] text-on-surface-variant">
              Following{' '}
              <a
                href="https://semver.org"
                target="_blank"
                rel="noopener noreferrer"
                className={textLink}
              >
                Semantic Versioning
              </a>
              . Have a question about a release? Ask on{' '}
              <a
                href={siteConfig.links.discord}
                target="_blank"
                rel="noopener noreferrer"
                className={textLink}
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
