import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Offline',
  robots: { index: false },
}

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-4 text-center">
      <div className="label-mono mb-4 text-2xs text-on-surface-variant opacity-90">Offline</div>
      <h1
        className="text-3xl font-semibold tracking-tight text-on-surface"
        style={{ fontFamily: 'var(--font-inter), sans-serif' }}
      >
        You&apos;re offline
      </h1>
      <p className="mt-3 max-w-md text-sm text-on-surface-variant">
        elah needs a connection to load — check your network and try again.
      </p>
      <Link
        href="/"
        className="mt-6 rounded bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-colors hover:bg-primary-hover"
      >
        Retry
      </Link>
    </div>
  )
}
