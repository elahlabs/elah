import type { CSSProperties } from 'react'

interface IconProps {
  name: string
  size?: number
  /** Material Symbols FILL axis (0 outline, 1 filled). */
  fill?: 0 | 1
  /** Material Symbols wght axis. */
  weight?: number
  color?: string
  className?: string
  style?: CSSProperties
}

/**
 * Material Symbols Outlined glyph. The font is loaded once in app/layout.tsx;
 * per-icon axes (size/fill/weight) are set via font-variation-settings so a
 * single font file covers every icon on the landing mockups.
 */
export function Icon({ name, size = 18, fill = 0, weight = 300, color, className, style }: IconProps) {
  return (
    <span
      className={`material-symbols-outlined${className ? ` ${className}` : ''}`}
      style={{
        fontSize: size,
        color,
        fontVariationSettings: `'opsz' 20, 'wght' ${weight}, 'FILL' ${fill}, 'GRAD' 0`,
        ...style,
      }}
    >
      {name}
    </span>
  )
}
