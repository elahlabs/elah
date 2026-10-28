'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/components/ThemeProvider'

/** Site-wide light/dark switch. State lives in ThemeProvider (<html class="dark">). */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, toggle } = useTheme()
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
