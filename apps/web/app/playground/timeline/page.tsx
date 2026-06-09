'use client'

import dynamic from 'next/dynamic'

const TimelineEditor = dynamic(
  () => import('@/components/playground/TimelineEditor'),
  { ssr: false },
)

export default function TimelinePage() {
  return <TimelineEditor />
}
