import { Big_Shoulders } from 'next/font/google'

// The display face only the landing page uses; Geist / Geist Mono come from
// the root layout (--font-geist-sans, --font-geist-mono).
const displayFace = Big_Shoulders({
  subsets: ['latin'],
  weight: ['700', '800'],
  variable: '--font-lp-display',
  display: 'swap',
})

export const homeFontVars = displayFace.variable
