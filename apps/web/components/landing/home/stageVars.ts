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
  '--elah-bg': '#170F10',
  '--elah-bg-secondary': '#1F1517',
  '--elah-bg-panel': '#261A1C',
  '--elah-bg-card': '#1F1517',
  '--elah-bg-elevated': '#2E2224',
  '--elah-bg-highest': '#3D3032',
  '--elah-accent': '#FF003C',
  '--elah-accent-hover': '#D10030',
  '--elah-accent-dim': '#FF003C',
  '--elah-accent-glow': 'rgba(240, 98, 90, 0.35)',
  '--elah-accent-soft': 'rgba(240, 98, 90, 0.14)',
  '--elah-accent-text': '#1B1416',
  ...clip('video', '#FF003C'),
  ...clip('shape', '#FF003C'),
  ...clip('text', '#3DDC97'),
  ...clip('audio', '#3DDC97'),
  ...clip('image', '#E0A33A'),
  ...clip('freehand', '#E0A33A'),
} as CSSProperties
