import Link from 'next/link'
import { Star } from 'lucide-react'
import { GET_STARTED_URL, GITHUB_URL, navLinks } from '@/config/nav'
import { ThemeToggle, MARK, display, label } from '@/components/eb'

/**
 * Nav as a strip of hairline cells, like an editor's menu bar. Links, the
 * GitHub star count and the primary action come from `config/nav.ts`.
 */
export function HomeNav({ stars = null }: { stars?: string | null }) {
  const cell = 'flex items-center border-l border-[var(--lp-line)] px-4 sm:px-5'
  return (
    <header className="sticky top-0 z-[60] w-full border-b border-[var(--lp-line)] bg-[color-mix(in_srgb,var(--lp-paper)_88%,transparent)] backdrop-blur-md">
      <nav aria-label="Primary" className="flex h-[52px] w-full items-stretch">
        <Link href="/" className="flex items-center gap-[10px] px-4 no-underline sm:px-5">
          <span
            aria-hidden="true"
            className="h-[24px] w-[24px] shrink-0"
            style={{ backgroundImage: `url(${MARK})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
          />
          <span className={`text-[24px] font-extrabold leading-none text-[var(--lp-ink)] ${display}`}>elah</span>
        </Link>

        <ul className="m-0 hidden list-none items-stretch border-l border-[var(--lp-line)] p-0 lg:flex">
          {navLinks.map((l) => (
            <li key={l.href} className="flex">
              <Link
                href={l.href}
                className={`flex items-center px-4 text-[var(--lp-muted)] no-underline transition-colors hover:bg-[var(--lp-ink)] hover:text-[var(--lp-paper)] ${label}`}
              >
                {l.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="ml-auto flex items-stretch">
          <ThemeToggle className={`${cell} justify-center text-[var(--lp-ink)] transition-colors hover:bg-[var(--lp-paper2)]`} />
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={stars ? `elah on GitHub, ${stars} stars` : 'elah on GitHub'}
            className={`${cell} hidden gap-2 text-[var(--lp-ink)] no-underline transition-colors hover:bg-[var(--lp-paper2)] sm:flex ${label}`}
          >
            <Star size={12} strokeWidth={2} className="fill-[#FF003C] text-[#FF003C]" aria-hidden />
            {stars ?? 'GitHub'}
          </a>
          <Link
            href={GET_STARTED_URL}
            className={`flex items-center bg-[var(--lp-ink)] px-5 text-[var(--lp-paper)] no-underline transition-colors hover:bg-[#FF003C] hover:text-[#0E0E10] ${label}`}
          >
            Get started
          </Link>
        </div>
      </nav>
    </header>
  )
}
