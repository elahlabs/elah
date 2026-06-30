'use client'

import dynamic from 'next/dynamic'

const RawEditor = dynamic(
  () => import('@/components/playground/raw/RawEditor'),
  { ssr: false },
)

export default function RawPage() {
  return <RawEditor />
}
