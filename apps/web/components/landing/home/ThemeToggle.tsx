'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'

type Theme = 'light' | 'dark'
export const LP_THEME_KEY = 'elah-lp-theme'

/**
 * Runs before first paint, as the first child of the `.lp` wrapper: applies
 * the stored theme, or the system preference, so the page never flashes the
 * wrong one.
 */
export const lpThemeInitScript = `(function(){try{var t=localStorage.getItem('${LP_THEME_KEY}');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.currentScript.parentElement.dataset.theme=t}catch(e){}})()`

function root() {
  return document.querySelector<HTMLElement>('.lp')
}

/** Light/dark switch for the homepage. Remembers the choice; until then it follows the system. */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState<Theme | null>(null)

  useEffect(() => {
    const el = root()
    if (!el) return
    // Client-side navigation skips the init script, so apply it here too.
    const stored = localStorage.getItem(LP_THEME_KEY)
    const media = matchMedia('(prefers-color-scheme: dark)')
    const initial: Theme = stored === 'light' || stored === 'dark' ? stored : media.matches ? 'dark' : 'light'
    el.dataset.theme = initial
    setTheme(initial)
    const follow = (e: MediaQueryListEvent) => {
      if (localStorage.getItem(LP_THEME_KEY)) return
      const t: Theme = e.matches ? 'dark' : 'light'
      el.dataset.theme = t
      setTheme(t)
    }
    media.addEventListener('change', follow)
    return () => media.removeEventListener('change', follow)
  }, [])

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    const el = root()
    if (el) el.dataset.theme = next
    localStorage.setItem(LP_THEME_KEY, next)
    setTheme(next)
  }

  const dark = theme === 'dark'
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Light mode' : 'Dark mode'}
      className={className}
    >
      {dark ? <Sun size={15} strokeWidth={1.75} aria-hidden /> : <Moon size={15} strokeWidth={1.75} aria-hidden />}
    </button>
  )
}
