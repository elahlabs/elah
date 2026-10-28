'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Mounts its children the first time it scrolls near the viewport, and never
 * unmounts them. Demos that need the engine sit inside this, so the page does
 * not load the engine before it is looked at (brief section 10).
 */
export function LoadOnView({ children, placeholder, className, rootMargin = '200px' }: { children: ReactNode; placeholder?: ReactNode; className?: string; rootMargin?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [seen, setSeen] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || seen) return
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true)
          io.disconnect()
        }
      },
      { rootMargin },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [seen, rootMargin])

  return (
    <div ref={ref} className={className}>
      {seen ? children : placeholder}
    </div>
  )
}
