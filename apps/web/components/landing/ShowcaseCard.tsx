import Link from 'next/link'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { kindLabel, type ShowcaseEntry, type ShowcaseKind } from '@/config/showcase'
import { cardBody, cardLight, cardTitle, label, outline } from '@/components/eb'

const ctaLabel: Record<ShowcaseKind, string> = {
  app: 'Visit site',
  playground: 'Launch playground',
  example: 'View on GitHub',
  server: 'Read the docs',
}

// Status dots are the one place the mint/amber status colours are allowed.
const statusDot = { live: '#3DDC97', preview: '#E0A33A' } as const

const tagCls = `bg-surface px-2 py-[3px] text-on-surface-variant ${label} ${outline}`
const ctaCls = `mt-1 inline-flex items-center gap-2 text-on-surface underline decoration-primary underline-offset-4 ${label}`

/** One showcase card: shared by the /showcase grid and the landing teaser. */
export function ShowcaseCard({ entry, showTags = true }: { entry: ShowcaseEntry; showTags?: boolean }) {
  const cta = (
    <>
      {ctaLabel[entry.kind]}
      {entry.external ? <ArrowUpRight size={15} /> : <ArrowRight size={15} />}
    </>
  )
  return (
    <article className={`${cardLight} h-full min-w-0 transition-colors hover:bg-surface-container`}>
      <div className="flex flex-wrap gap-2">
        <span className={`flex items-center gap-2 bg-surface px-2 py-[3px] text-on-surface ${label} ${outline}`}>
          <span aria-hidden className="h-[6px] w-[6px]" style={{ backgroundColor: statusDot[entry.status] }} />
          {entry.status}
        </span>
        <span className={tagCls}>{kindLabel[entry.kind]}</span>
      </div>
      <div className="flex flex-1 flex-col gap-[10px]">
        <h3 className={cardTitle}>{entry.name}</h3>
        {entry.by && <span className={`text-on-surface-variant ${label}`}>by {entry.by}</span>}
        <p className={`${cardBody} flex-1 text-pretty`}>{entry.description}</p>
      </div>
      {showTags && (
        <div className="flex flex-wrap gap-2">
          {entry.tags.map((t) => (
            <span key={t} className={tagCls}>
              {t}
            </span>
          ))}
        </div>
      )}
      {entry.external ? (
        <a href={entry.href} target="_blank" rel="noopener noreferrer" className={ctaCls}>
          {cta}
        </a>
      ) : (
        <Link href={entry.href} className={ctaCls}>
          {cta}
        </Link>
      )}
    </article>
  )
}
