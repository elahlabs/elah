/**
 * Spring presets (PV-P5a) — the curve picker's "Springs" row and the
 * vocabulary an agent uses for "gentle", "bouncy", "wobbly".
 *
 * All five share mass 1, so they are spread across the DAMPING RATIO alone:
 * two presets only look different if ζ differs, which is the parameter that
 * actually sets the shape. At 30 fps that gives a ~12 frame snap, a ~36 frame
 * settle and a ~54 frame ring, which is the useful range for UI motion on
 * clip-length keyframes.
 *
 * Note the deliberate id collision with the bezier preset `snappy`: a spring
 * is always written `spring:<id>` in ops and `sp:<id>` in the panel select, so
 * the two namespaces can never be confused.
 */

import type { KeyframeSpring } from '../types'

export interface SpringPreset {
  id: SpringPresetId
  label: string
  spring: KeyframeSpring
}

export type SpringPresetId = 'gentle' | 'snappy' | 'bouncy' | 'stiff' | 'wobbly'

export const SPRING_PRESETS: ReadonlyArray<SpringPreset> = [
  { id: 'gentle', label: 'Gentle', spring: { stiffness: 100, damping: 26, mass: 1 } },
  { id: 'snappy', label: 'Snappy', spring: { stiffness: 300, damping: 24, mass: 1 } },
  { id: 'bouncy', label: 'Bouncy', spring: { stiffness: 180, damping: 12, mass: 1 } },
  { id: 'stiff', label: 'Stiff', spring: { stiffness: 400, damping: 40, mass: 1 } },
  { id: 'wobbly', label: 'Wobbly', spring: { stiffness: 180, damping: 6, mass: 1 } },
]

export function findSpringPreset(id: string): SpringPreset | undefined {
  return SPRING_PRESETS.find((p) => p.id === id)
}

/**
 * The preset whose stiffness, damping, mass (default 1) and velocity (default 0)
 * all equal `s` within 1e-6 — so the panel can name a spring the author has
 * nudged, and fall back to "Custom spring" when there is no match.
 */
export function matchSpringPreset(s: KeyframeSpring | undefined): SpringPreset | undefined {
  if (!s) return undefined
  return SPRING_PRESETS.find(
    (p) =>
      Math.abs(p.spring.stiffness - s.stiffness) < 1e-6 &&
      Math.abs(p.spring.damping - s.damping) < 1e-6 &&
      Math.abs((p.spring.mass ?? 1) - (s.mass ?? 1)) < 1e-6 &&
      Math.abs((p.spring.velocity ?? 0) - (s.velocity ?? 0)) < 1e-6,
  )
}
