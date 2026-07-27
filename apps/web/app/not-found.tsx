import type { Metadata } from 'next'
import Link from 'next/link'
import { Navbar } from '@/components/marketing/Navbar'
import { Footer } from '@/components/marketing/Footer'

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false },
}

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <Navbar />
      <main className="flex flex-1 items-center justify-center px-4">
        <div className="text-center">
          <div className="label-mono mb-4 text-2xs text-on-surface-variant opacity-90">404</div>
          <h1
            className="text-3xl font-semibold tracking-tight text-on-surface"
            style={{ fontFamily: 'var(--font-inter), sans-serif' }}
          >
            Page not found
          </h1>
          <p className="mt-3 text-sm text-on-surface-variant">
            This page does not exist or has moved.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link
              href="/"
              className="rounded bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-colors hover:bg-primary-hover"
            >
              Go Home
            </Link>
            <Link
              href="/docs"
              className="rounded border border-outline-variant px-4 py-2 text-sm font-medium text-on-surface transition-colors hover:bg-surface-container"
            >
              Read Docs
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}
