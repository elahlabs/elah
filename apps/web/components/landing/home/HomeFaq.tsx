import Link from 'next/link'
import { Plus } from 'lucide-react'
import { faq } from '../landingData'
import { Section } from './Section'
import { Sel, outline, sans } from '@/components/eb'

/** FAQ (brief section 5, item 11). Native details elements: keyboard and screen-reader friendly with no script. */
export function HomeFaq() {
  return (
    <Section n={9} scene="FAQ" kicker="Common questions" id="faq" title={<>Common <Sel>questions.</Sel></>}>
      <div className="flex max-w-[780px] flex-col gap-2">
        {faq.map((item) => (
          <details key={item.q} className={`group bg-[var(--lp-card)] ${outline}`}>
            <summary className={`flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-[16px] font-semibold tracking-[-0.3px] text-[var(--lp-ink)] marker:hidden [&::-webkit-details-marker]:hidden ${sans}`}>
              {item.q}
              <Plus size={18} strokeWidth={2} aria-hidden className="shrink-0 text-[#FF003C] transition-transform duration-200 group-open:rotate-45 motion-reduce:transition-none" />
            </summary>
            <div className="px-5 pb-5">
              <p className={`m-0 text-[15px] leading-[23px] text-[var(--lp-muted)] text-pretty ${sans}`}>{item.a}</p>
              {item.href && (
                <Link href={item.href} className={`mt-3 inline-block text-[14px] font-semibold text-[var(--lp-ink)] no-underline transition-colors hover:text-[#FF003C] ${sans}`}>
                  {item.hrefLabel ?? 'Read more'} →
                </Link>
              )}
            </div>
          </details>
        ))}
      </div>
    </Section>
  )
}
