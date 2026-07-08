import type { Metadata } from 'next'

// The page itself is a client component, so metadata lives in this layout.
export const metadata: Metadata = {
  title: 'Timeline Only',
  description:
    'An isolated @elah/timeline demo: tracks, clips, snapping, keyboard shortcuts, and the TimelineEngine without the full editor stack.',
  alternates: { canonical: '/playground/timeline' },
}

export default function TimelinePlaygroundLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
