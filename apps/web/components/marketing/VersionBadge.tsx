import Link from 'next/link'
import { cn } from '@/lib/utils'
import { currentVersion } from '@/config/changelog'
import { label } from '@/components/eb'

interface VersionBadgeProps {
  className?: string
  /** Full-width variant for the mobile menu. */
  block?: boolean
}

/**
 * Version cell that links to the changelog: mono uppercase, hairline, with a
 * red square dot. Shows the current published package version (single source
 * of truth in config/changelog.ts).
 */
export function VersionBadge({ className, block }: VersionBadgeProps) {
  return (
    <Link
      href="/changelog"
      title={`What's new in v${currentVersion}`}
      className={cn(
        'group inline-flex items-center gap-2 text-on-surface-variant no-underline transition-colors hover:bg-surface-container hover:text-on-surface',
        label,
        block && 'w-full',
        className,
      )}
    >
      <span aria-hidden className="inline-block h-[6px] w-[6px] shrink-0 bg-[#FF003C]" />
      <span className="tabular-nums">v{currentVersion}</span>
      <span>What&apos;s new</span>
    </Link>
  )
}
