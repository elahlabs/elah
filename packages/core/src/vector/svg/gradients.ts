/**
 * `url(#id)` → a gradient `Paint`, for one fill/stroke value on one element
 * (PV-P6b-3). `href` chains, percentages, `gradientUnits`, `gradientTransform`
 * and `stop-opacity`/fill-or-stroke-opacity are honoured; spread methods other
 * than `pad`, focal points and `fr` are reported through `skip` and otherwise
 * ignored (the gradient still paints, without that feature).
 *
 * `parseLength` and `rules` are passed in rather than imported from
 * `svgToProject.ts`: that module owns them as private closures (this
 * ticket's allowlist only opens `resolvePaint` and the shape step there), and
 * importing this module from there while it imports back would cycle.
 */
import type { Affine } from '../pathOps'
import { multiply, parseTransformList, IDENTITY } from '../pathOps'
import type { Box } from '../place'
import { withAlpha } from '../color'
import type { SvgStyle, StyleRule } from './style'
import { declaredFor } from './style'
import type { SvgNode } from './types'
import { linearToPaint, radialToPaint, type GradientResult, type GradientStopIn } from '../gradient'

const MAX_HREF_CHAIN = 8

function resolveChainAttr(chain: readonly SvgNode[], name: string): string | undefined {
  for (const node of chain) {
    const v = node.attrs[name]
    if (v !== undefined) return v
  }
  return undefined
}

function findStopsNode(chain: readonly SvgNode[]): SvgNode | undefined {
  for (const node of chain) {
    if (node.children.some((c) => c.tag === 'stop')) return node
  }
  return undefined
}

function walkHrefChain(target: SvgNode, ids: Map<string, SvgNode>): SvgNode[] {
  const chain: SvgNode[] = [target]
  const seen = new Set<SvgNode>([target])
  let current = target
  for (let i = 0; i < MAX_HREF_CHAIN; i++) {
    const href = current.attrs['href']
    if (href === undefined) break
    const m = /^#(.+)$/.exec(href)
    if (m === null) break
    const next = ids.get(m[1])
    if (next === undefined) break
    if (seen.has(next)) break // href cycle: stop instead of walking it forever
    chain.push(next)
    seen.add(next)
    current = next
  }
  return chain
}

function parseOffsetAttr(value: string | undefined): number {
  if (value === undefined) return 0
  const t = value.trim()
  const isPct = t.endsWith('%')
  const n = parseFloat(isPct ? t.slice(0, -1) : t)
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, isPct ? n / 100 : n))
}

function parseUnitInterval(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const t = value.trim()
  const isPct = t.endsWith('%')
  const n = parseFloat(isPct ? t.slice(0, -1) : t)
  if (!Number.isFinite(n)) return fallback
  return Math.min(1, Math.max(0, isPct ? n / 100 : n))
}

/** Resolve `url(#id)` to a gradient Paint for one element, or undefined when `id` is not a gradient. */
export function svgGradientPaint(
  target: SvgNode,
  ids: Map<string, SvgNode>,
  el: { style: SvgStyle; m: Affine; userBounds: Box; stageBounds: Box; opacity: number },
  vb: Box,
  skip: (feature: string) => void,
  parseLength: (value: string | undefined, axis: 'x' | 'y' | 'other') => number,
  rules: StyleRule[],
): GradientResult | undefined {
  if (target.tag !== 'linearGradient' && target.tag !== 'radialGradient') return undefined
  const isLinear = target.tag === 'linearGradient'

  const chain = walkHrefChain(target, ids)
  const gradientUnits = resolveChainAttr(chain, 'gradientUnits') ?? 'objectBoundingBox'
  const gradientTransformAttr = resolveChainAttr(chain, 'gradientTransform')
  const spreadMethod = resolveChainAttr(chain, 'spreadMethod') ?? 'pad'

  const stopsNode = findStopsNode(chain)
  if (stopsNode === undefined) return { kind: 'solid', color: 'transparent', approximations: [] }

  const rawStops: GradientStopIn[] = []
  let prevOffset = 0
  for (const child of stopsNode.children) {
    if (child.tag !== 'stop') continue
    const offset = Math.max(parseOffsetAttr(child.attrs['offset']), prevOffset)
    prevOffset = offset
    const decls = declaredFor(child, rules)
    let color = decls['stop-color'] ?? '#000000'
    if (color.trim() === 'currentColor') color = el.style.color
    const stopOpacity = parseUnitInterval(decls['stop-opacity'], 1)
    color = withAlpha(color, stopOpacity * el.opacity)
    rawStops.push({ offset, color })
  }
  if (rawStops.length === 0) return { kind: 'solid', color: 'transparent', approximations: [] }

  let gt: Affine = IDENTITY
  if (gradientTransformAttr !== undefined) {
    const parsed = parseTransformList(gradientTransformAttr)
    if (parsed === null) skip('transform-syntax')
    else gt = parsed
  }

  let g: Affine
  const userSpace = gradientUnits === 'userSpaceOnUse'
  if (userSpace) {
    g = multiply(el.m, gt)
  } else {
    const ub = el.userBounds
    if (ub.width === 0 || ub.height === 0) {
      skip('gradient-degenerate-bbox')
      return { kind: 'solid', color: 'transparent', approximations: [] }
    }
    const bbox: Affine = [ub.width, 0, 0, ub.height, ub.x, ub.y]
    g = multiply(el.m, multiply(bbox, gt))
  }

  if (spreadMethod === 'reflect' || spreadMethod === 'repeat') skip('gradient-spread')

  const coord = (raw: string, axis: 'x' | 'y' | 'other'): number => {
    if (userSpace) return parseLength(raw, axis)
    const t = raw.trim()
    if (t.endsWith('%')) {
      const n = parseFloat(t.slice(0, -1))
      return Number.isFinite(n) ? n / 100 : 0
    }
    const n = parseFloat(t)
    return Number.isFinite(n) ? n : 0
  }

  let result: GradientResult
  if (isLinear) {
    const x1 = coord(resolveChainAttr(chain, 'x1') ?? '0%', 'x')
    const y1 = coord(resolveChainAttr(chain, 'y1') ?? '0%', 'y')
    const x2 = coord(resolveChainAttr(chain, 'x2') ?? '100%', 'x')
    const y2 = coord(resolveChainAttr(chain, 'y2') ?? '0%', 'y')
    result = linearToPaint([x1, y1], [x2, y2], rawStops, g, el.stageBounds)
  } else {
    const cxRaw = resolveChainAttr(chain, 'cx') ?? '50%'
    const cyRaw = resolveChainAttr(chain, 'cy') ?? '50%'
    const rRaw = resolveChainAttr(chain, 'r') ?? '50%'
    const fxRaw = resolveChainAttr(chain, 'fx') ?? cxRaw
    const fyRaw = resolveChainAttr(chain, 'fy') ?? cyRaw
    const frRaw = resolveChainAttr(chain, 'fr') ?? '0%'
    const cx = coord(cxRaw, 'x')
    const cy = coord(cyRaw, 'y')
    const r = coord(rRaw, 'other')
    const fx = coord(fxRaw, 'x')
    const fy = coord(fyRaw, 'y')
    const fr = coord(frRaw, 'other')
    if (fr > 0) skip('radial-gradient-fr')
    result = radialToPaint([cx, cy], r, [fx, fy], rawStops, g, el.stageBounds)
  }

  for (const feature of result.approximations) skip(feature)
  return result
}
