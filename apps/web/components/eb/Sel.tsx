import type { ReactNode } from 'react'

/**
 * Selected-word emphasis: a word shown as a selected layer in an editor, with
 * a cyber red box and four square handles. Decorative; the text reads as-is.
 */
export function Sel({ children }: { children: ReactNode }) {
  const handle = 'absolute h-[7px] w-[7px] border border-[#FF003C] bg-[var(--color-surface)]'
  return (
    <span className="relative mx-[0.08em] inline-block px-[0.08em] [outline:2px_solid_#FF003C] [outline-offset:-1px]">
      {children}
      <span aria-hidden className={`${handle} -left-[4px] -top-[4px]`} />
      <span aria-hidden className={`${handle} -right-[4px] -top-[4px]`} />
      <span aria-hidden className={`${handle} -bottom-[4px] -left-[4px]`} />
      <span aria-hidden className={`${handle} -bottom-[4px] -right-[4px]`} />
    </span>
  )
}
