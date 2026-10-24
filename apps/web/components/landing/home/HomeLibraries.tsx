import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { coreSubpaths, libraries } from '../landingData'
import { Section } from './Section'
import { Sel } from './Sel'
import { btnSecondary, btnSmall, cardBody, cardLight, cardTitle, mono, outline, panel } from './ui'

/** Libraries and install (brief section 5, item 8), with the experimental @elah/core subpaths. */
export function HomeLibraries() {
  return (
    <Section n={6} scene="Libraries" kicker="Five packages" id="libraries" title={<>Choose a <Sel>library.</Sel></>} intro="Five composable packages. Drop in the whole editor, or take only the layer you need.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {libraries.map((lib) => (
          <article key={lib.pkg} className={`${cardLight} min-w-0 !p-5`}>
            <div className="flex flex-col gap-[10px]">
              <h3 className={cardTitle}>{lib.title}</h3>
              <p className={cardBody}>{lib.subtitle}</p>
            </div>
            <div className="mt-auto flex flex-col gap-4">
              <div className={`${panel} overflow-x-auto whitespace-nowrap px-4 py-3 text-[12px] text-[#0E0E10] ${mono}`}>
                <span className="text-[#FF003C]">$ </span>
                {lib.extraCmd ?? `npm install ${lib.pkg}`}
              </div>
              <Link href={lib.href} className={`${btnSecondary} ${btnSmall} self-start`}>
                Open
                <ArrowRight size={16} strokeWidth={2} aria-hidden />
              </Link>
            </div>
          </article>
        ))}
        <article className={`${cardLight} min-w-0 !p-5`}>
          <div className="flex flex-col gap-[10px]">
            <div className="flex items-center justify-between gap-3">
              <h3 className={cardTitle}>@elah/core subpaths</h3>
              <span className={`shrink-0 bg-[#F7F6F2] px-3 py-[3px] text-[11px] uppercase tracking-[0.14em] text-[#5E5D58] ${mono} ${outline}`}>Experimental</span>
            </div>
            <p className={cardBody}>Coming in 1.0. Separate entries, so an app that does not import them pays nothing.</p>
          </div>
          <ul className={`${panel} m-0 mt-auto flex list-none flex-col gap-2 p-4`}>
            {coreSubpaths.map((p) => (
              <li key={p.path} className="flex flex-col">
                <code className={`text-[12px] text-[#0E0E10] ${mono}`}>{p.path}</code>
                <span className="text-[13px] text-[#5E5D58]">{p.what}</span>
              </li>
            ))}
          </ul>
        </article>
      </div>
    </Section>
  )
}
