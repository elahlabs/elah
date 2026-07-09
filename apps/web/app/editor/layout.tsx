import type { Metadata } from 'next'
// Published-package stylesheets (@elah/timeline, @elah/editor) are imported
// once in the root layout — see app/layout.tsx — so their cascade position
// stays fixed across client-side navigation. Only the app-local playground
// styles are scoped to this layout.
import '@/styles/playground.css'

export const metadata: Metadata = {
  title: 'Editor',
}

export default function EditorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="pg-shell">
      <div className="pg-content">{children}</div>
    </div>
  )
}
