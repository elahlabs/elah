import Link from 'next/link'
import { footerColumns, GITHUB_URL } from '@/config/nav'
import { MARK, container, display, label, sans } from './ui'

function GitHubLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-[16px] w-[16px] fill-current" aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.4-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
    </svg>
  )
}

/**
 * Footer: hairline columns, then the wordmark set as large as the column
 * allows, like an end card. Link columns come from `config/nav.ts`.
 */
export function HomeFooter({ stars = null }: { stars?: string | null }) {
  return (
    <footer data-scene="Credits" className="w-full pb-[44px]">
      <div className={container}>
        <div className="grid grid-cols-1 border-t border-[var(--lp-ink)] sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-5 py-8 pr-6">
            <span aria-hidden="true" className="h-[36px] w-[36px]" style={{ backgroundImage: `url(${MARK})`, backgroundSize: 'cover' }} />
            <p className={`m-0 max-w-[280px] text-[15px] leading-[23px] text-[var(--lp-muted)] ${sans}`}>
              The open-source video engine for the browser. Write motion as code, keep it on a timeline.
            </p>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex h-[36px] items-center gap-2 self-start bg-[var(--lp-ink)] px-4 text-[var(--lp-paper)] no-underline transition-colors hover:bg-[#FF003C] hover:text-[#0E0E10] ${label}`}
            >
              <GitHubLogo />
              Star on GitHub
              {stars ? <span className="border-l border-current pl-2 tabular-nums">{stars}</span> : null}
            </a>
          </div>
          {footerColumns.map((col) => (
            <nav key={col.heading} aria-label={col.heading} className="flex flex-col gap-4 border-t border-[var(--lp-line)] py-8 sm:border-l sm:border-t-0 sm:pl-6">
              <p className={`m-0 text-[var(--lp-muted)] ${label}`}>{col.heading}</p>
              <ul className="m-0 flex list-none flex-col gap-[10px] p-0">
                {col.links.map((l) => {
                  const external = !l.href.startsWith('/')
                  const cls = `text-[15px] text-[var(--lp-ink)] no-underline underline-offset-4 hover:underline ${sans}`
                  return (
                    <li key={l.href}>
                      {external ? (
                        <a href={l.href} className={cls} {...(l.href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                          {l.label}
                        </a>
                      ) : (
                        <Link href={l.href} className={cls}>
                          {l.label}
                        </Link>
                      )}
                    </li>
                  )
                })}
              </ul>
            </nav>
          ))}
        </div>

        <div className={`flex items-center justify-between gap-4 border-t border-[var(--lp-line)] py-3 text-[var(--lp-muted)] ${label}`}>
          <span>elah is open source under Apache-2.0.</span>
          <span className="hidden sm:inline">End of reel</span>
        </div>
        <p aria-hidden className={`m-0 flex select-none justify-between overflow-hidden pt-4 text-[34vw] font-extrabold leading-[0.74] text-[var(--lp-ink)] lg:text-[24vw] ${display}`}>
          {['e', 'l', 'a', 'h'].map((ch) => (
            <span key={ch}>{ch}</span>
          ))}
        </p>
      </div>
    </footer>
  )
}
