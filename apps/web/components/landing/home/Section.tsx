import type { ReactNode } from 'react'
import { container, h2OnDark, leadOnDark, outline, sectionY } from './ui'

type Bg = 'blush' | 'white' | 'carousel'
const BG: Record<Bg, string> = { blush: 'bg-[#5A1218]', white: 'bg-[#4B0E13]', carousel: 'bg-[#6A1A22]' }

/** One landing section: container, gutters, rhythm, heading and lead (DESIGN.md section 4). */
export function Section({
  bg,
  id,
  title,
  intro,
  children,
}: {
  bg: Bg
  id?: string
  title: ReactNode
  intro?: ReactNode
  children?: ReactNode
}) {
  return (
    <section id={id} className={`${BG[bg]} ${sectionY} scroll-mt-4`}>
      <div className={`${container} flex flex-col gap-12`}>
        <div className={`flex max-w-[720px] flex-col gap-4 self-start rounded-[20px] bg-[#FFF5F3] p-6 sm:p-8 ${outline}`}>
          <h2 className={h2OnDark}>{title}</h2>
          {intro ? <p className={leadOnDark}>{intro}</p> : null}
        </div>
        {children}
      </div>
    </section>
  )
}
