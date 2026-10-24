import { currentVersion } from '@/config/changelog'
import type { SiteStatsDisplay } from '@/lib/stats'
import { container, display, label } from './ui'

/** Live stats strip: big condensed numbers in hairline cells. The numbers arrive formatted from the server. */
export function HomeStats({ stats }: { stats: SiteStatsDisplay }) {
  const cells = [
    { label: 'GitHub stars', value: stats.stars ?? '—' },
    { label: 'npm downloads', value: stats.downloads ?? '—' },
    { label: 'Packages · Apache-2.0', value: '5' },
    { label: 'Release', value: `v${currentVersion}` },
  ]
  return (
    <section data-scene="Stats" className="py-16 lg:py-[88px]" aria-label="elah in numbers">
      <div className={container}>
        <dl className="m-0 grid grid-cols-2 border-y border-[var(--lp-line)] lg:grid-cols-4">
          {cells.map((c, i) => (
            <div
              key={c.label}
              className={`flex flex-col gap-3 px-1 py-6 sm:px-5 ${i % 2 === 1 ? 'border-l border-[var(--lp-line)] pl-4' : ''} ${i > 0 ? 'lg:border-l lg:border-[var(--lp-line)] lg:pl-5' : ''} ${i >= 2 ? 'border-t border-[var(--lp-line)] lg:border-t-0' : ''}`}
            >
              <dt className={`text-[var(--lp-muted)] ${label}`}>
                {String(i + 1).padStart(2, '0')} · {c.label}
              </dt>
              <dd className={`m-0 text-[40px] font-extrabold leading-none text-[var(--lp-ink)] sm:text-[52px] ${display}`}>{c.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}
