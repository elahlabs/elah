import { describe, expect, it } from 'vitest'
import { pathBounds, parsePathData } from '../vector/pathOps'
import { ICON_DATA } from './data'
import { ICON_NAMES, ICON_STROKE_UNITS, iconPath, resolveIconName } from './index'

/**
 * Every `d` must parse with the SAME parser the renderer uses for `shapeKind: 'path'`
 * (`parsePathData` in `../vector/pathOps`, consumed by `vector/svg/svgToProject.ts`), and the
 * parse must produce a real, drawable shape — not merely "a non-empty string". `parsePathData`
 * follows the SVG error rule (stop at the first bad token, keep what came before), so a
 * corrupted `d` does not throw; it silently truncates. Requiring both a minimum segment count
 * AND non-degenerate bounds is what catches that truncation.
 */
describe('ICON_DATA — every d parses into a drawable path', () => {
  const names = Object.keys(ICON_DATA)

  it('has at least 100 icons', () => {
    expect(names.length).toBeGreaterThanOrEqual(100)
  })

  for (const name of names) {
    it(`"${name}" has a non-empty d that parses to a real, bounded shape`, () => {
      const d = ICON_DATA[name]
      expect(typeof d).toBe('string')
      expect(d.trim().length).toBeGreaterThan(0)

      const segs = parsePathData(d)
      // A degenerate or corrupted d parses to zero segments (parsePathData returns [] when the
      // string does not even start with a move) or to just a lone M with nothing drawn after it.
      expect(segs.length).toBeGreaterThanOrEqual(2)

      const bounds = pathBounds(segs)
      expect(bounds).not.toBeNull()
      expect(Number.isFinite(bounds!.width)).toBe(true)
      expect(Number.isFinite(bounds!.height)).toBe(true)
      // A real glyph in the 24-unit user space draws over some visible area; a path that
      // collapsed to a point (e.g. every coordinate truncated to the same value) would not.
      expect(bounds!.width + bounds!.height).toBeGreaterThan(0)
    })
  }
})

describe('ICON_NAMES', () => {
  it('is sorted and unique, with at least 100 names', () => {
    const sorted = [...ICON_NAMES].sort()
    expect(ICON_NAMES).toEqual(sorted)
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length)
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(100)
  })

  it('matches the keys of ICON_DATA exactly', () => {
    expect([...ICON_NAMES].sort()).toEqual(Object.keys(ICON_DATA).sort())
  })
})

describe('resolveIconName', () => {
  it('resolves an exact hit', () => {
    expect(resolveIconName('rocket')).toBe('rocket')
  })

  it('resolves a known synonym: people -> users', () => {
    expect(resolveIconName('people')).toBe('users')
  })

  it('resolves a trailing plural: rockets -> rocket', () => {
    expect(resolveIconName('rockets')).toBe('rocket')
  })

  it('returns null for an unknown name', () => {
    expect(resolveIconName('this-icon-does-not-exist')).toBeNull()
  })

  it('still resolves the three AV-1 seed names', () => {
    expect(resolveIconName('check')).toBe('check')
    expect(resolveIconName('clock')).toBe('clock')
    expect(resolveIconName('users')).toBe('users')
  })
})

describe('iconPath', () => {
  it('returns a 24-unit viewBox and the d for a known name', () => {
    const result = iconPath('check')
    expect(result).not.toBeNull()
    expect(result!.viewBox).toEqual({ x: 0, y: 0, width: 24, height: 24 })
    expect(result!.d).toBe(ICON_DATA.check)
  })

  it('resolves through a synonym before looking up the path', () => {
    expect(iconPath('people')!.d).toBe(ICON_DATA.users)
  })

  it('returns null for an unknown name', () => {
    expect(iconPath('this-icon-does-not-exist')).toBeNull()
  })

  it('keeps the stroke width the 24-unit Lucide value', () => {
    expect(ICON_STROKE_UNITS).toBe(2)
  })
})

/**
 * The round-trip: re-derive a handful of icons' `d` independently, straight from the
 * `lucide-react` source `__iconNode` this session read to build `data.ts`, and compare to what
 * `data.ts` actually has. This is deliberately NOT a call into `scripts/build-icons.mjs` (that
 * script's own main() runs on import and writes a file — not safe to import from a test); it is
 * a small, separate re-implementation of the same lowering table from TICKET-AV-2, applied fresh
 * to the live upstream module. If `data.ts` ever drifts from the installed lucide-react version,
 * this is what catches it. Every element kind the curated set actually uses (path, line, circle,
 * ellipse, rect-with-radius, polyline, polygon) is exercised by at least one of the six names below.
 */
describe('round-trip against the installed lucide-react source', () => {
  type LucideElement = readonly [string, Record<string, string>]

  function n(attrs: Record<string, string>, key: string): number {
    return Number(attrs[key])
  }

  function fmt(v: number): string {
    return String(Math.round(v * 1e4) / 1e4)
  }

  /** A from-scratch lowering, independent of scripts/build-icons.mjs, for the round-trip check. */
  function lowerIndependently(iconNode: readonly LucideElement[]): string {
    const parts: string[] = []
    for (const [tag, a] of iconNode) {
      if (tag === 'path') {
        parts.push(a.d)
      } else if (tag === 'line') {
        parts.push(`M${fmt(n(a, 'x1'))} ${fmt(n(a, 'y1'))} L${fmt(n(a, 'x2'))} ${fmt(n(a, 'y2'))}`)
      } else if (tag === 'polyline' || tag === 'polygon') {
        const nums = a.points.trim().split(/[\s,]+/).map(Number)
        const points: Array<[number, number]> = []
        for (let i = 0; i < nums.length; i += 2) points.push([nums[i], nums[i + 1]])
        const [first, ...rest] = points
        let d = `M${fmt(first[0])} ${fmt(first[1])}`
        for (const [x, y] of rest) d += ` L${fmt(x)} ${fmt(y)}`
        if (tag === 'polygon') d += ' Z'
        parts.push(d)
      } else if (tag === 'circle' || tag === 'ellipse') {
        const cx = n(a, 'cx')
        const cy = n(a, 'cy')
        const rx = tag === 'circle' ? n(a, 'r') : n(a, 'rx')
        const ry = tag === 'circle' ? n(a, 'r') : n(a, 'ry')
        parts.push(
          `M${fmt(cx - rx)} ${fmt(cy)} A${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx + rx)} ${fmt(cy)} ` +
            `A${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx - rx)} ${fmt(cy)} Z`,
        )
      } else if (tag === 'rect') {
        const x = n(a, 'x')
        const y = n(a, 'y')
        const w = n(a, 'width')
        const h = n(a, 'height')
        const hasRx = a.rx !== undefined
        const hasRy = a.ry !== undefined
        let rx = hasRx ? n(a, 'rx') : hasRy ? n(a, 'ry') : 0
        let ry = hasRy ? n(a, 'ry') : hasRx ? n(a, 'rx') : 0
        rx = Math.min(rx, w / 2)
        ry = Math.min(ry, h / 2)
        if (rx <= 0 || ry <= 0) {
          parts.push(`M${fmt(x)} ${fmt(y)} H${fmt(x + w)} V${fmt(y + h)} H${fmt(x)} Z`)
        } else {
          parts.push(
            `M${fmt(x + rx)} ${fmt(y)} H${fmt(x + w - rx)} ` +
              `A${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(x + w)} ${fmt(y + ry)} V${fmt(y + h - ry)} ` +
              `A${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(x + w - rx)} ${fmt(y + h)} H${fmt(x + rx)} ` +
              `A${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(x)} ${fmt(y + h - ry)} V${fmt(y + ry)} ` +
              `A${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(x + rx)} ${fmt(y)} Z`,
          )
        }
      } else {
        throw new Error(`round-trip test does not know element <${tag}>`)
      }
    }
    return parts.join(' ')
  }

  /** Load an icon's __iconNode straight from the installed lucide-react, following one hop of
   *  re-export alias (e.g. "filter" -> "funnel", "unlock" -> "lock-open" in v0.511.0). */
  async function loadUpstreamIconNode(name: string): Promise<readonly LucideElement[]> {
    const mod: { __iconNode?: readonly LucideElement[] } = await import(
      `lucide-react/dist/esm/icons/${name}.js`
    )
    if (Array.isArray(mod.__iconNode) && mod.__iconNode.length > 0) return mod.__iconNode
    throw new Error(`no __iconNode for "${name}" — see scripts/build-icons.mjs alias handling`)
  }

  const cases: Array<[dataName: string, upstreamName: string]> = [
    ['check', 'check'], // single path, unchanged
    ['x', 'x'], // two path elements, concatenated
    ['clock', 'clock'], // circle -> two arcs, plus polyline -> M/L
    ['database', 'database'], // ellipse -> two arcs, plus two paths
    ['play', 'play'], // polygon -> M/L/Z
    ['credit-card', 'credit-card'], // rounded rect -> M/H/A/V/Z, plus a line
    ['filter', 'funnel'], // re-export alias: "filter" now ships as the "funnel" art
    ['unlock', 'lock-open'], // re-export alias: "unlock" now ships as the "lock-open" art
  ]

  for (const [dataName, upstreamName] of cases) {
    it(`"${dataName}" matches a fresh lowering of lucide-react's "${upstreamName}"`, async () => {
      const iconNode = await loadUpstreamIconNode(upstreamName)
      const expected = lowerIndependently(iconNode)
      expect(ICON_DATA[dataName]).toBe(expected)
    })
  }
})
