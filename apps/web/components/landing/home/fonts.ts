import { Fuzzy_Bubbles, Instrument_Serif } from 'next/font/google'

// The two display faces only the landing page uses; Geist / Geist Mono come
// from the root layout (--font-geist-sans, --font-geist-mono).
const hand = Fuzzy_Bubbles({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-lp-hand',
  display: 'swap',
})

const serif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-lp-serif',
  display: 'swap',
})

export const homeFontVars = `${hand.variable} ${serif.variable}`
