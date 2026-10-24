import type { ReactNode } from 'react'

/**
 * The landing's emphasis: a word shown as a selected layer in an editor, with
 * a cyber red box and four square handles. Decorative; the text reads as-is.
 */
export function Sel({ children }: { children: ReactNode }) {
  const handle = 'absolute h-[7px] w-[7px] border border-[#FF003C] bg-[#F0EFEA]'
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

/** L-shaped crop marks at the four corners of a positioned parent. */
export function CropMarks({ color = '#0E0E10', size = 14, inset = 0 }: { color?: string; size?: number; inset?: number }) {
  const s = { width: size, height: size, borderColor: color, margin: inset }
  const base = 'pointer-events-none absolute'
  return (
    <>
      <span aria-hidden className={`${base} left-0 top-0 border-l border-t`} style={s} />
      <span aria-hidden className={`${base} right-0 top-0 border-r border-t`} style={s} />
      <span aria-hidden className={`${base} bottom-0 left-0 border-b border-l`} style={s} />
      <span aria-hidden className={`${base} bottom-0 right-0 border-b border-r`} style={s} />
    </>
  )
}
