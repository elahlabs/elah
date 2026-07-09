import type { Metadata } from 'next'
// Published-package stylesheets (@elah/timeline, @elah/editor) are imported
// once in the root layout — see app/layout.tsx — so their cascade position
// stays fixed across client-side navigation. Only the app-local playground
// styles are scoped to this layout.
import '@/styles/playground.css'
import { PlaygroundNav } from '@/components/playground/shared/PlaygroundNav'

export const metadata: Metadata = {
  title: {
    template: '%s — Playground',
    default: 'Playground',
  },
}

export default function PlaygroundLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="pg-shell">
      <PlaygroundNav />
      <div className="pg-content">{children}</div>
    </div>
  )
}
