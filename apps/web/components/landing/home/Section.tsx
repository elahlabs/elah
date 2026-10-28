import type { ReactNode } from 'react'
import { Slate, container, h2 as h2Class, lead, sectionY } from '@/components/eb'

/**
 * One landing section, opened by a slate strip (`SC 03 · BINDING`) on a
 * hairline. `scene` also names the section's clip on the scrub bar.
 */
export function Section({
  n,
  scene,
  kicker,
  id,
  title,
  intro,
  children,
}: {
  n: number
  scene: string
  kicker?: string
  id?: string
  title: ReactNode
  intro?: ReactNode
  children?: ReactNode
}) {
  return (
    <section id={id} data-scene={scene} className={`${sectionY} scroll-mt-16`}>
      <div className={container}>
        <Slate n={n} label={scene} kicker={kicker} />
        <div className="flex flex-col gap-12 pt-10 lg:pt-14">
          <div className="flex max-w-[900px] flex-col gap-5">
            <h2 className={h2Class}>{title}</h2>
            {intro ? <p className={`${lead} max-w-[640px]`}>{intro}</p> : null}
          </div>
          {children}
        </div>
      </div>
    </section>
  )
}
