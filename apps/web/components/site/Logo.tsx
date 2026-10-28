import Link from 'next/link'
import { cn } from '@/lib/utils'
import { MARK, display } from '@/components/eb'

interface LogoProps {
  /** Mark edge length in px. */
  size?: number
  className?: string
  /** Wordmark font size in px. */
  wordmarkSize?: number
}

/**
 * The elah mark (red "e" on an ink tile) plus the display-face wordmark,
 * linking home. Same mark and wordmark as the homepage; one logo for the
 * header and anywhere else it is needed.
 */
export function Logo({ size = 24, wordmarkSize = 24, className }: LogoProps) {
  return (
    <Link
      href="/"
      aria-label="elah home"
      className={cn('flex shrink-0 items-center gap-[10px] text-on-surface no-underline', className)}
    >
      <span
        aria-hidden="true"
        className="shrink-0"
        style={{ width: size, height: size, backgroundImage: `url(${MARK})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
      />
      <span className={`font-extrabold leading-none text-on-surface ${display}`} style={{ fontSize: wordmarkSize }}>
        elah
      </span>
    </Link>
  )
}
