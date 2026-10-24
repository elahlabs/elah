import Link from 'next/link'
import { Star } from 'lucide-react'
import { GET_STARTED_URL, GITHUB_URL, navLinks } from '@/config/nav'
import { MARK, btnPrimary, btnSecondary, btnSmall, outline, sans } from './ui'

/**
 * The white pill nav (DESIGN.md section 6). Links, the GitHub star count and
 * the primary action come from the brief's navigation (`config/nav.ts`).
 */
export function HomeNav({ stars = null }: { stars?: string | null }) {
  return (
    <header className="w-full px-4 pt-3 sm:px-8 lg:px-[88px]">
      <nav
        aria-label="Primary"
        className={`mx-auto flex h-[46px] w-full max-w-[1264px] items-center justify-between bg-white pl-5 pr-[7px] ${outline}`}
      >
        <Link href="/" className="flex items-center gap-[10px] no-underline">
          <span
            aria-hidden="true"
            className="h-[26px] w-[26px] shrink-0 "
            style={{ backgroundImage: `url(${MARK})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
          />
          <span className={`text-[17px] font-semibold tracking-[-0.6px] text-[#1B1416] ${sans}`}>elah</span>
        </Link>

        <ul className="m-0 hidden list-none items-center gap-[34px] p-0 lg:flex">
          {navLinks.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className={`text-[14px] text-[#77696B] no-underline transition-colors hover:text-[#1B1416] ${sans}`}>
                {l.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-[10px]">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={stars ? `elah on GitHub, ${stars} stars` : 'elah on GitHub'}
            className={`${btnSecondary} ${btnSmall} hidden sm:inline-flex`}
          >
            <Star size={13} strokeWidth={2} className="fill-[#F0625A] text-[#F0625A]" aria-hidden />
            {stars ?? 'GitHub'}
          </a>
          <Link href={GET_STARTED_URL} className={`${btnPrimary} ${btnSmall}`}>
            Get started
          </Link>
        </div>
      </nav>
    </header>
  )
}
