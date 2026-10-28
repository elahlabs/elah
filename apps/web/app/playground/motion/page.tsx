'use client'

import dynamic from 'next/dynamic'

// The engine loads on this route only, and only in the browser.
const MotionPlayground = dynamic(() => import('@/components/playground/motion/MotionPlayground'), {
  ssr: false,
  loading: () => <p className="p-6 text-sm text-on-surface-variant">Loading the engine…</p>,
})

export default function MotionPlaygroundPage() {
  return <MotionPlayground />
}
