'use client'

import { createContext, useContext } from 'react'

type Theme = 'light' | 'dark'

// The site is dark-only. The context is retained so existing consumers
// (useTheme) keep working, but the value is fixed to dark and toggle is a
// no-op. The <html> `dark` class is applied pre-paint in app/layout.tsx.
const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({
  theme: 'dark',
  toggle: () => {},
})

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <ThemeContext.Provider value={{ theme: 'dark', toggle: () => {} }}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)
