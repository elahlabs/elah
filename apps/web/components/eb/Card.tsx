import type { ReactNode } from 'react'
import { cardLight, label, mono, outline } from './tokens'

/** Hairline card, with an optional header strip (`title` left, `meta` right). */
export function Card({
  title,
  meta,
  className = '',
  children,
}: {
  title?: ReactNode
  meta?: ReactNode
  className?: string
  children?: ReactNode
}) {
  if (title == null && meta == null) {
    return <div className={`${cardLight} ${className}`}>{children}</div>
  }
  return (
    <div className={`flex flex-col bg-[var(--color-surface-low)] ${outline} ${className}`}>
      <div
        className={`flex items-center justify-between gap-4 border-b border-[var(--color-outline-variant)] px-4 py-2 text-[var(--color-on-surface)] ${label} ${mono}`}
      >
        <span>{title}</span>
        {meta != null ? <span className="text-[var(--color-on-surface-variant)]">{meta}</span> : null}
      </div>
      <div className="flex flex-col gap-5 p-6">{children}</div>
    </div>
  )
}
