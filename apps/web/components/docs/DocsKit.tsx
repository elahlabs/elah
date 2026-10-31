import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, Info, TriangleAlert } from 'lucide-react'
import { label } from '@/components/eb'
import { docsNav } from '@/config/docs'

/**
 * Building blocks for a docs page: readable body text, section headings with
 * a hover anchor, inline code, callouts, reference tables, shortcut keys, and
 * the previous/next pager. A page reads as short text, a small example, then
 * the next idea; reference detail goes in tables, gotchas in callouts.
 */

export function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="group mb-4 mt-16 scroll-mt-28 text-[30px] font-extrabold uppercase leading-none tracking-[-0.2px] text-on-surface md:scroll-mt-20">
      <a href={`#${id}`} className="text-inherit no-underline">
        {children}
        <span aria-hidden className="ml-2 text-on-surface-variant opacity-0 transition-opacity group-hover:opacity-100">
          #
        </span>
      </a>
    </h2>
  )
}

export function H3({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h3 id={id} className="mb-2 mt-8 scroll-mt-28 !font-[family-name:var(--font-geist-sans),system-ui,sans-serif] text-[17px] font-semibold normal-case text-on-surface md:scroll-mt-20">
      {children}
    </h3>
  )
}

export function P({ children }: { children: ReactNode }) {
  return <p className="my-4 text-[15px] leading-[1.75] text-on-surface/85">{children}</p>
}

export function C({ children }: { children: ReactNode }) {
  return (
    <code className="whitespace-nowrap border border-outline-variant bg-surface-container px-1 py-px font-[family-name:var(--font-geist-mono),monospace] text-[0.86em] text-on-surface">
      {children}
    </code>
  )
}

export function Callout({ kind = 'note', title, children }: { kind?: 'note' | 'warning'; title: string; children: ReactNode }) {
  const Icon = kind === 'warning' ? TriangleAlert : Info
  return (
    <aside className={`my-6 flex gap-3 border-l-2 bg-surface-low px-4 py-3.5 ${kind === 'warning' ? 'border-[#FF003C]' : 'border-on-surface'}`}>
      <Icon size={16} strokeWidth={2} aria-hidden className={`mt-[3px] shrink-0 ${kind === 'warning' ? 'text-[#FF003C]' : 'text-on-surface'}`} />
      <div className="text-[14px] leading-[1.7] text-on-surface/85">
        <p className="m-0 font-semibold text-on-surface">{title}</p>
        <div className="mt-1 [&_p]:m-0">{children}</div>
      </div>
    </aside>
  )
}

export interface Row {
  name: string
  type?: string
  optional?: boolean
  desc: ReactNode
}

/** A reference table: name, type, what it does. Replaces interfaces shown as code with `// comments`. */
export function PropTable({ rows, nameLabel = 'Field', footer }: { rows: Row[]; nameLabel?: string; footer?: ReactNode }) {
  return (
    <div className="my-5 border border-outline-variant">
      <div className={`hidden grid-cols-[minmax(0,15rem)_1fr] gap-6 border-b border-outline-variant bg-surface-low px-4 py-2 text-on-surface-variant sm:grid ${label}`}>
        <span>{nameLabel}</span>
        <span>Description</span>
      </div>
      {rows.map((r) => (
        <div key={r.name} className="grid gap-1 border-b border-outline-variant px-4 py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,15rem)_1fr] sm:gap-6">
          <div className="min-w-0">
            <span className="font-[family-name:var(--font-geist-mono),monospace] text-[13px] font-medium leading-[1.5] text-on-surface">{r.name}</span>
            {r.optional ? <span className="ml-1.5 text-[11px] text-on-surface-variant">optional</span> : null}
            {r.type ? (
              <div className="break-words font-[family-name:var(--font-geist-mono),monospace] text-[12px] leading-[1.5] text-on-surface-variant">{r.type}</div>
            ) : null}
          </div>
          <div className="text-[14px] leading-[1.6] text-on-surface/85">{r.desc}</div>
        </div>
      ))}
      {footer ? <div className="border-t border-outline-variant bg-surface-low px-4 py-2.5 text-[13px] text-on-surface-variant">{footer}</div> : null}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center border border-outline-variant border-b-2 bg-surface-low px-1.5 font-[family-name:var(--font-geist-mono),monospace] text-[12px] text-on-surface">
      {children}
    </kbd>
  )
}

/** Shortcut list: each key combo is drawn as separate keys joined by `+`. */
export function Shortcuts({ items }: { items: [keys: string, action: string][] }) {
  return (
    <div className="my-5 border border-outline-variant">
      {items.map(([keys, action]) => (
        <div key={keys} className="flex items-center justify-between gap-4 border-b border-outline-variant px-4 py-2.5 last:border-b-0">
          <span className="text-[14px] text-on-surface/85">{action}</span>
          <span className="flex shrink-0 flex-wrap items-center justify-end gap-1 text-[12px] text-on-surface-variant">
            {keys.split(' + ').map((k, i) => (
              <span key={k} className="flex items-center gap-1">
                {i > 0 ? '+' : null}
                <Kbd>{k}</Kbd>
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Docs pages in sidebar order, one entry per page (section anchors dropped). "Overview" takes its section's name. */
const pages = docsNav.flatMap((s) =>
  s.items.filter((i) => !i.href.includes('#')).map((i) => ({ href: i.href, title: i.title === 'Overview' ? s.title : i.title })),
)

/** Previous / next page links at the foot of a docs page, in sidebar order. */
export function DocsPager({ href }: { href: string }) {
  const i = pages.findIndex((p) => p.href === href)
  const prev = i > 0 ? pages[i - 1] : null
  const next = i >= 0 && i < pages.length - 1 ? pages[i + 1] : null
  const card = 'group flex flex-1 flex-col gap-1 border border-outline-variant px-4 py-3.5 no-underline transition-colors hover:border-on-surface'
  return (
    <nav aria-label="Previous and next page" className="mt-20 flex flex-col gap-3 sm:flex-row">
      {prev ? (
        <Link href={prev.href} className={card}>
          <span className={`flex items-center gap-1.5 text-on-surface-variant ${label}`}>
            <ArrowLeft size={12} aria-hidden /> Previous
          </span>
          <span className="text-[15px] font-medium text-on-surface">{prev.title}</span>
        </Link>
      ) : (
        <span className="flex-1" />
      )}
      {next ? (
        <Link href={next.href} className={`${card} items-end text-right`}>
          <span className={`flex items-center gap-1.5 text-on-surface-variant ${label}`}>
            Next <ArrowRight size={12} aria-hidden className="transition-transform group-hover:translate-x-0.5" />
          </span>
          <span className="text-[15px] font-medium text-on-surface">{next.title}</span>
        </Link>
      ) : null}
    </nav>
  )
}
