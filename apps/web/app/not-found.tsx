import type { Metadata } from 'next'
import Link from 'next/link'
import { Navbar } from '@/components/marketing/Navbar'
import { Footer } from '@/components/marketing/Footer'
import { btnLarge, btnPrimary, btnSecondary, display, label, lead } from '@/components/eb'

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
          <div className={`mb-4 text-on-surface-variant ${label}`}>404</div>
          <h1 className={`m-0 text-[56px] leading-[0.92] font-extrabold tracking-[-0.5px] text-on-surface sm:text-[72px] ${display}`}>
            Page not found
          </h1>
          <p className={`${lead} mt-4`}>
            This page does not exist or has moved.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Link href="/" className={`${btnPrimary} ${btnLarge}`}>
              Go Home
            </Link>
            <Link href="/docs" className={`${btnSecondary} ${btnLarge}`}>
              Read Docs
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}
