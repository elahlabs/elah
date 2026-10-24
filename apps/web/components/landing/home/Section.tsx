import type { ReactNode } from 'react'
import { container, h2 as h2Class, lead, sectionY } from './ui'

type Bg = 'blush' | 'white' | 'carousel'
const BG: Record<Bg, string> = { blush: 'bg-[#FFF5F3]', white: 'bg-white', carousel: 'bg-[#FBEEEB]' }

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
        <div className="flex max-w-[720px] flex-col gap-4">
          <h2 className={h2Class}>{title}</h2>
          {intro ? <p className={lead}>{intro}</p> : null}
        </div>
        {children}
      </div>
    </section>
  )
}
