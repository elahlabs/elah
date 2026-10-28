/** L-shaped crop marks at the four corners of a positioned parent. */
export function CropMarks({ color = 'var(--color-on-surface)', size = 14, inset = 0 }: { color?: string; size?: number; inset?: number }) {
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
