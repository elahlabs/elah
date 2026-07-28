'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'
import { Menu, X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { docsNav } from '@/config/docs'
import { DocsNavList } from '@/components/docs/DocsSidebar'

/** Page title for the breadcrumb, resolved from the sidebar nav data. */
function useCurrentDocTitle(pathname: string): string {
  for (const section of docsNav) {
    for (const item of section.items) {
      // Skip in-page anchors — several sections list them alongside real routes.
      if (item.href.includes('#')) continue
      if (item.href === pathname) return item.title
    }
  }
  return 'Introduction'
}

/**
 * Docs navigation for narrow viewports: a sticky sub-bar under the Navbar with
 * a hamburger that opens the full nav tree as an overlay drawer. Hidden at `md`
 * and up, where `DocsSidebar` takes over.
 */
export function DocsMobileNav() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const title = useCurrentDocTitle(pathname)

  useEffect(() => setMounted(true), [])

  const close = useCallback(() => setOpen(false), [])

  // Route changes dismiss the drawer. Hash links stay on the same pathname, so
  // DocsNavList also closes it via onNavigate.
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!open) return

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      triggerRef.current?.focus()
    }
  }, [open, close])

  return (
    <>
      <div className="sticky top-14 z-40 flex h-12 items-center gap-2 border-b border-outline-variant bg-surface/95 px-4 backdrop-blur-sm md:hidden">
        <button
          ref={triggerRef}
          onClick={() => setOpen(true)}
          aria-label="Open documentation navigation"
          aria-expanded={open}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
        >
          <Menu className="h-4 w-4" />
        </button>
        <span className="truncate text-sm text-on-surface-variant">
          Docs <span className="opacity-50">/</span>{' '}
          <span className="text-on-surface">{title}</span>
        </span>
      </div>

      {mounted &&
        createPortal(
          <AnimatePresence>
            {open && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  onClick={close}
                  className="fixed inset-0 z-[60] bg-black/50 md:hidden"
                />
                <motion.div
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.18 }}
                  role="dialog"
                  aria-modal="true"
                  aria-label="Documentation navigation"
                  className="fixed inset-y-0 left-0 z-[70] w-[min(20rem,85vw)] overflow-y-auto border-r border-outline-variant bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
                >
                  <div className="sticky top-0 flex items-center justify-between border-b border-outline-variant bg-surface px-4 py-3">
                    <span className="label-mono text-2xs text-on-surface-variant opacity-70">
                      Documentation
                    </span>
                    <button
                      ref={closeRef}
                      onClick={close}
                      aria-label="Close documentation navigation"
                      className="flex h-9 w-9 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <nav aria-label="Documentation" className="px-3 py-4">
                    <DocsNavList dense={false} onNavigate={close} />
                  </nav>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
  )
}
