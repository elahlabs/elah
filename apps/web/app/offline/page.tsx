import type { Metadata } from 'next'
import Link from 'next/link'
import { btnPrimary, btnLarge, display, label, lead } from '@/components/eb'

export const metadata: Metadata = {
  title: 'Offline',
  robots: { index: false },
}

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-4 text-center">
      <div className={`mb-4 text-on-surface-variant ${label}`}>Offline</div>
      <h1 className={`m-0 text-[56px] leading-[0.92] font-extrabold tracking-[-0.5px] text-on-surface sm:text-[72px] ${display}`}>
        You&apos;re offline
      </h1>
      <p className={`${lead} mt-4 max-w-md`}>
        elah needs a connection to load — check your network and try again.
      </p>
      <Link href="/" className={`${btnPrimary} ${btnLarge} mt-8`}>
        Retry
      </Link>
    </div>
  )
}
