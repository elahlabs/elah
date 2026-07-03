import Link from 'next/link'
import { cn } from '@/lib/utils'
import { currentVersion } from '@/config/changelog'

interface VersionBadgeProps {
  className?: string
  /** Full-width variant for the mobile menu. */
  block?: boolean
}

/**
 * Compact version pill that links to the changelog. Shows the current published
 * package version (single source of truth in config/changelog.ts) so visitors
 * can see what the latest package update is at a glance.
 */
export function VersionBadge({ className, block }: VersionBadgeProps) {
  return (
    <Link
      href="/changelog"
      title={`What's new in v${currentVersion}`}
      className={cn(
        'group inline-flex items-center gap-1.5 rounded-full border border-outline-variant bg-surface-low px-2.5 py-1 text-2xs font-medium text-on-surface-variant transition-colors hover:border-primary/40 hover:bg-surface-container hover:text-on-surface',
        block && 'w-full justify-center',
        className
      )}
    >
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
      </span>
      <span className="font-mono tracking-tight">v{currentVersion}</span>
      <span className="text-on-surface-variant opacity-60 group-hover:opacity-100">
        What&apos;s new
      </span>
    </Link>
  )
}
