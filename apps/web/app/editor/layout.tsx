import type { Metadata } from 'next'
// Published-package stylesheets: each @elah package ships its own compiled
// Tailwind utilities (the app's Tailwind does not scan node_modules). The
// --elah-* variables these classes consume are defined in globals.css .elah-root.
import '@elah/timeline/styles.css'
import '@elah/editor/styles.css'
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
