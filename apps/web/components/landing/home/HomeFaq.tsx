import Link from 'next/link'
import { Plus } from 'lucide-react'
import { faq } from '../landingData'
import { Section } from './Section'
import { outline, sans } from './ui'

/** FAQ (brief section 5, item 11). Native details elements: keyboard and screen-reader friendly with no script. */
export function HomeFaq() {
  return (
    <Section bg="blush" id="faq" title="Common questions.">
      <div className="flex max-w-[780px] flex-col gap-2">
        {faq.map((item) => (
          <details key={item.q} className={`group rounded-[14px] bg-white ${outline}`}>
            <summary className={`flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-[16px] font-semibold tracking-[-0.3px] text-[#1B1416] marker:hidden [&::-webkit-details-marker]:hidden ${sans}`}>
              {item.q}
              <Plus size={18} strokeWidth={2} aria-hidden className="shrink-0 text-[#F0625A] transition-transform duration-200 group-open:rotate-45 motion-reduce:transition-none" />
            </summary>
            <div className="px-5 pb-5">
              <p className={`m-0 text-[15px] leading-[23px] text-[#77696B] text-pretty ${sans}`}>{item.a}</p>
              {item.href && (
                <Link href={item.href} className={`mt-3 inline-block text-[14px] font-semibold text-[#1B1416] no-underline transition-colors hover:text-[#F0625A] ${sans}`}>
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
