import type { CSSProperties } from 'react'

/**
 * Re-colours the real @elah/timeline for the dark stage so clips follow the
 * landing's track colours (DESIGN.md section 2): coral for motion, mint for
 * text and audio, amber for secondary. The timeline itself is the product
 * component; only its tokens change, inside this wrapper.
 */
const clip = (name: string, hex: string) => ({
  [`--elah-clip-${name}-top`]: hex,
  [`--elah-clip-${name}-mid`]: hex,
  [`--elah-clip-${name}-bottom`]: hex,
  [`--elah-clip-${name}-accent`]: hex,
})

export const stageVars = {
  '--elah-bg': '#0E0E10',
  '--elah-bg-secondary': '#161618',
  '--elah-bg-panel': '#1C1C1F',
  '--elah-bg-card': '#161618',
  '--elah-bg-elevated': '#242428',
  '--elah-bg-highest': '#2E2E33',
  '--elah-accent': '#FF003C',
  '--elah-accent-hover': '#D10030',
  '--elah-accent-dim': '#FF003C',
  '--elah-accent-glow': 'rgba(255, 0, 60, 0.35)',
  '--elah-accent-soft': 'rgba(255, 0, 60, 0.14)',
  '--elah-accent-text': '#0E0E10',
  ...clip('video', '#FF003C'),
  ...clip('shape', '#FF003C'),
  ...clip('text', '#3DDC97'),
  ...clip('audio', '#3DDC97'),
  ...clip('image', '#E0A33A'),
  ...clip('freehand', '#E0A33A'),
} as CSSProperties
