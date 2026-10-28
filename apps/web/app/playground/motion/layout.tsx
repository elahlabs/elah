import type { Metadata } from 'next'

// The page itself is a client component, so metadata lives in this layout.
export const metadata: Metadata = {
  title: 'Motion',
  description:
    'Write a scene as HTML and CSS, convert it to native clips and keyframes with the Elah engine, see the keys on a timeline, and export an MP4 in your browser.',
  alternates: { canonical: '/playground/motion' },
}

export default function MotionPlaygroundLayout({ children }: { children: React.ReactNode }) {
  return children
}
