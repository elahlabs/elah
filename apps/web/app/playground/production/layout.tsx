import type { Metadata } from 'next'

// The page itself is a client component, so metadata lives in this layout.
export const metadata: Metadata = {
  title: 'Full Editor',
  description:
    'The complete @elah/editor composition running live: asset panel, GPU-accelerated preview, interactive overlays, timeline, audio, and MP4 export.',
  alternates: { canonical: '/playground/production' },
}

export default function ProductionLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
