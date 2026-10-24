import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { flow } from '../landingData'
import { Section } from './Section'
import { Sel } from './Sel'
import { btnSecondary, btnSmall, chip, mono, outline } from './ui'

/** Architecture, condensed to one diagram (brief section 5, item 10). */
export function HomeArchitecture() {
  return (
    <Section
      n={8} scene="Engine" kicker="Frames in, frames out"
      id="architecture"
      title={<>One mutation funnel. One pure <Sel>resolver.</Sel></>}
      intro="Time is integer frames, every edit goes through the engine, and renderers only read the resolved scene. Same input, same output."
    >
      <ol className="m-0 flex max-w-[860px] list-none flex-col gap-2 p-0">
        {flow.map((layer, i) => (
          <li key={layer.name} className={`flex flex-col gap-3 bg-[var(--lp-paper)] p-4 sm:flex-row sm:items-center sm:gap-5 ${outline}`}>
            <span className={`w-[140px] shrink-0 text-[11px] uppercase tracking-[0.14em] text-[var(--lp-muted)] ${mono}`}>
              {String(i + 1).padStart(2, '0')} · {layer.name.toLowerCase()}
            </span>
            <div className="flex flex-wrap gap-2">
              {layer.items.map((it, j) => (
                <span key={it} className={`${chip} ${i === flow.length - 1 && j === layer.items.length - 1 ? 'bg-[#FF003C] text-[#0E0E10]' : `bg-[var(--lp-card)] text-[var(--lp-ink)] ${outline}`}`}>
                  {it}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ol>
      <div>
        <Link href="/docs/architecture" className={`${btnSecondary} ${btnSmall}`}>
          Read the architecture docs
          <ArrowRight size={16} strokeWidth={2} aria-hidden />
        </Link>
      </div>
    </Section>
  )
}
