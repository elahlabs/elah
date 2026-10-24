import { currentVersion } from '@/config/changelog'
import type { SiteStatsDisplay } from '@/lib/stats'
import { container, mono, sans, outline } from './ui'

/** Live stats strip (brief section 5, item 2). The numbers arrive formatted from the server. */
export function HomeStats({ stats }: { stats: SiteStatsDisplay }) {
  const cells = [
    { label: 'GitHub stars', value: stats.stars ?? '—' },
    { label: 'npm downloads', value: stats.downloads ?? '—' },
    { label: 'Packages', value: '5 · Apache-2.0' },
    { label: 'Release', value: `v${currentVersion}` },
  ]
  return (
    <section className="bg-[#4B0E13] py-10 lg:py-14" aria-label="elah in numbers">
      <div className={container}>
        <dl className={`m-0 grid grid-cols-2 overflow-hidden rounded-[20px] bg-[#FFF5F3] lg:grid-cols-4 ${outline}`}>
          {cells.map((c, i) => (
            <div key={c.label} className={`flex flex-col gap-1 p-5 ${i > 0 ? 'lg:border-l lg:border-[#F3E2DF]' : ''} ${i % 2 === 1 ? 'border-l border-[#F3E2DF] lg:border-l' : ''} ${i >= 2 ? 'border-t border-[#F3E2DF] lg:border-t-0' : ''}`}>
              <dt className={`text-[12px] text-[#1B1416] ${mono}`}>{c.label}</dt>
              <dd className={`m-0 text-[22px] font-semibold tracking-[-0.5px] text-[#1B1416] ${sans}`}>{c.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}
