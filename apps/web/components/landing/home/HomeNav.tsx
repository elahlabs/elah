import Link from 'next/link'
import { Star } from 'lucide-react'
import { GET_STARTED_URL, GITHUB_URL, navLinks } from '@/config/nav'
import { MARK, display, label } from './ui'

/**
 * Nav as a strip of hairline cells, like an editor's menu bar. Links, the
 * GitHub star count and the primary action come from `config/nav.ts`.
 */
export function HomeNav({ stars = null }: { stars?: string | null }) {
  const cell = 'flex items-center border-l border-[#D9D7D0] px-4 sm:px-5'
  return (
    <header className="sticky top-0 z-[60] w-full border-b border-[#D9D7D0] bg-[#F0EFEA]/90 backdrop-blur-md">
      <nav aria-label="Primary" className="flex h-[52px] w-full items-stretch">
        <Link href="/" className="flex items-center gap-[10px] px-4 no-underline sm:px-5">
          <span
            aria-hidden="true"
            className="h-[24px] w-[24px] shrink-0"
            style={{ backgroundImage: `url(${MARK})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
          />
          <span className={`text-[24px] font-extrabold leading-none text-[#0E0E10] ${display}`}>elah</span>
        </Link>

        <ul className="m-0 hidden list-none items-stretch border-l border-[#D9D7D0] p-0 lg:flex">
          {navLinks.map((l) => (
            <li key={l.href} className="flex">
              <Link
                href={l.href}
                className={`flex items-center px-4 text-[#5E5D58] no-underline transition-colors hover:bg-[#0E0E10] hover:text-[#F0EFEA] ${label}`}
              >
                {l.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="ml-auto flex items-stretch">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={stars ? `elah on GitHub, ${stars} stars` : 'elah on GitHub'}
            className={`${cell} hidden gap-2 text-[#0E0E10] no-underline transition-colors hover:bg-[#E8E6E0] sm:flex ${label}`}
          >
            <Star size={12} strokeWidth={2} className="fill-[#FF003C] text-[#FF003C]" aria-hidden />
            {stars ?? 'GitHub'}
          </a>
          <Link
            href={GET_STARTED_URL}
            className={`flex items-center bg-[#0E0E10] px-5 text-[#F0EFEA] no-underline transition-colors hover:bg-[#FF003C] hover:text-[#0E0E10] ${label}`}
          >
            Get started
          </Link>
        </div>
      </nav>
    </header>
  )
}
