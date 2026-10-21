import { describe, expect, it } from 'vitest'
import { compileVideoSpec } from '../compile'
import type { Clip } from '../../types'
import type { SpecElement } from '../types'

/**
 * Icon colour. Found by RENDERING a compiled spec, not by a structural test:
 * the builder read only `stroke`/`fill` and fell back to white, so every icon a
 * model coloured with `color` — the natural field, and the one the design named
 * — drew as a white outline on the default off-white background. Invisible.
 */
function iconClip(el: Partial<SpecElement>): Clip {
  const { project } = compileVideoSpec({
    format: { width: 1080, height: 1920, fps: 30 },
    duration: 2,
    design: { colors: [{ name: 'accent', value: '#22c55e' }] },
    elements: [{ id: 'i', kind: 'icon', icon: 'user', at: 0, duration: 2, w: 120, h: 120, ...el } as SpecElement],
  })
  return Object.values(project.clips).flat().find((c) => c.shapeKind === 'path' || c.shapeKind === 'circle')!
}

describe('icon colour', () => {
  it('honours `color`, resolving tokens', () => {
    expect(iconClip({ color: '$accent' }).shapeStroke).toBe('#22c55e')
  })

  it('`color` wins over `stroke`', () => {
    expect(iconClip({ color: '#ff0000', stroke: '#0000ff' }).shapeStroke).toBe('#ff0000')
  })

  it('falls back to `stroke`, then `fill`', () => {
    expect(iconClip({ stroke: '#0000ff' }).shapeStroke).toBe('#0000ff')
    expect(iconClip({ fill: '#00ff00' }).shapeStroke).toBe('#00ff00')
  })

  it('with no colour at all, defaults to ink — never white, which vanishes on the default background', () => {
    const stroke = iconClip({}).shapeStroke
    expect(stroke).toBe('#111111')
    expect(stroke?.toLowerCase()).not.toBe('#ffffff')
  })

  it('an unknown icon becomes a badge filled with the same colour', () => {
    const clip = iconClip({ icon: 'no-such-icon', color: '$accent' })
    expect(clip.shapeKind).toBe('circle')
    expect(clip.shapeFill).toBe('#22c55e')
  })
})
