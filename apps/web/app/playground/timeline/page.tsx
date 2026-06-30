'use client'

import dynamic from 'next/dynamic'

const TimelineEditor = dynamic(
  () => import('@/components/playground/timeline/TimelineEditor'),
  { ssr: false },
)

export default function TimelinePage() {
  return <TimelineEditor />
}
