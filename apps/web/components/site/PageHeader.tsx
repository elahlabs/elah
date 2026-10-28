import type { ReactNode } from 'react'
import { Slate, Sel, display, lead, label, container } from '@/components/eb'

export interface PageHeaderProps {
  /** Small mono label above the title (section or category). */
  eyebrow: ReactNode
  /** The page's single h1. */
  title: ReactNode
  /** One or two sentences under the title. */
  lede?: ReactNode
  /** Extra content under the lede (a callout, a CTA row). */
  children?: ReactNode
  /**
   * `page` is the full-width header for marketing pages and uses the same type
   * scale and measure as the landing's section heads. `doc` is the same
   * pattern inside a docs article column: smaller title, hairline underneath.
   */
  variant?: 'page' | 'doc'
  /** `narrow` aligns the header with a max-w-3xl body (changelog). Page variant only. */
  width?: 'wide' | 'narrow'
  /** Anchor id for the h1 (docs pages link to it from the sidebar). */
  id?: string
  /** A word in a string `title` to show as a selected layer (`Sel`). */
  selected?: string
}

/**
 * The one page-header block: eyebrow, h1, lede. The h1 face comes from the
 * global heading rule (`--font-display`), not from this component.
 */
export function PageHeader({
  eyebrow,
  title,
  lede,
  children,
  variant = 'page',
  width = 'wide',
  id,
  selected,
}: PageHeaderProps) {
  const isDoc = variant === 'doc'

  let heading: ReactNode = title
  if (selected && typeof title === 'string') {
    const i = title.indexOf(selected)
    if (i >= 0) {
      heading = (
        <>
          {title.slice(0, i)}
          <Sel>{selected}</Sel>
          {title.slice(i + selected.length)}
        </>
      )
    }
  }

  const content = (
    <>
      {typeof eyebrow === 'string' ? (
        <Slate label={eyebrow} />
      ) : (
        <div className={`border-t border-[var(--color-on-surface)] py-3 text-[var(--color-on-surface)] ${label}`}>
          {eyebrow}
        </div>
      )}
      <h1
        id={id}
        className={`m-0 scroll-mt-24 font-extrabold text-[var(--color-on-surface)] text-balance ${display} ${
          isDoc
            ? 'mb-4 mt-3 text-[40px] leading-[0.95] tracking-[-0.3px] sm:text-[48px]'
            : 'mb-5 mt-4 text-[56px] leading-[0.92] tracking-[-0.5px] sm:text-[72px] lg:text-[88px]'
        }`}
      >
        {heading}
      </h1>
      {lede ? <p className={`${lead} max-w-[40rem]`}>{lede}</p> : null}
      {children}
    </>
  )

  if (isDoc) {
    return <header className="mb-8 border-b border-outline-variant pb-6">{content}</header>
  }

  return (
    <header className="pt-[clamp(32px,5vw,64px)]">
      <div
        className={width === 'narrow' ? 'mx-auto w-full max-w-3xl px-4 sm:px-6' : container}
      >
        {content}
      </div>
    </header>
  )
}
