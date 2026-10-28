'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

type Theme = 'light' | 'dark'

export const THEME_KEY = 'elah-theme'

// Site-wide light/dark. The <html> `dark` class is the mechanism; it is set
// before first paint by the init script in app/layout.tsx (stored choice,
// then the system preference). This provider mirrors that class into React
// state, flips it on toggle(), persists the choice to localStorage, and
// follows the system preference until the user has chosen.
const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({
  theme: 'dark',
  toggle: () => {},
})

function apply(theme: Theme) {
  // Only some surfaces carry colour transitions, so flipping the class lets
  // them blend while the rest snap, which reads as a flash. Suspend all
  // transitions for the flip so every surface changes together.
  const style = document.createElement('style')
  style.textContent = '*,*::before,*::after{transition:none!important}'
  document.head.appendChild(style)
  document.documentElement.classList.toggle('dark', theme === 'dark')
  void window.getComputedStyle(document.body).opacity
  requestAnimationFrame(() => requestAnimationFrame(() => style.remove()))
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Server and first client render agree on 'dark'; the effect below syncs to
  // the real class, so hydration never mismatches.
  const [theme, setTheme] = useState<Theme>('dark')

  useEffect(() => {
    setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
    const media = matchMedia('(prefers-color-scheme: dark)')
    const follow = (e: MediaQueryListEvent) => {
      try {
        const stored = localStorage.getItem(THEME_KEY)
        if (stored === 'light' || stored === 'dark') return
      } catch {}
      const next: Theme = e.matches ? 'dark' : 'light'
      apply(next)
      setTheme(next)
    }
    media.addEventListener('change', follow)
    return () => media.removeEventListener('change', follow)
  }, [])

  const toggle = useCallback(() => {
    const next: Theme = document.documentElement.classList.contains('dark') ? 'light' : 'dark'
    apply(next)
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {}
    setTheme(next)
  }, [])

  const value = useMemo(() => ({ theme, toggle }), [theme, toggle])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)
