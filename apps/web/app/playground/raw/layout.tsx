import type { Metadata } from 'next'

// The page itself is a client component, so metadata lives in this layout.
export const metadata: Metadata = {
  title: 'Full Editor Demo',
  description:
    'A guided elah demo with pre-loaded sample media — cut, trim, text, transitions, and export in a single session.',
  alternates: { canonical: '/playground/raw' },
}

export default function RawPlaygroundLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
