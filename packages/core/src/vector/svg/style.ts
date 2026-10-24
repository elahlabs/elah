/**
 * SVG presentation attributes, the `style` attribute, `<style>` class/tag
 * rules, and inheritance (PV-P6b-2). DOM-free: a `<style>` sheet is parsed by
 * hand, not by the browser's CSSOM.
 */

import type { SvgNode } from './types'

export interface SvgStyle {
  fill: string
  fillOpacity: number
  fillRule: 'nonzero' | 'evenodd'
  stroke: string
  strokeOpacity: number
  strokeWidth: string
  strokeLinecap: string
  strokeLinejoin: string
  strokeMiterlimit?: string
  strokeDasharray: string
  strokeDashoffset: string
  color: string
  visibility: string
  markerStart: string
  markerMid: string
  markerEnd: string
}

export const INITIAL_STYLE: SvgStyle = {
  fill: '#000000',
  fillOpacity: 1,
  fillRule: 'nonzero',
  stroke: 'none',
  strokeOpacity: 1,
  strokeWidth: '1',
  strokeLinecap: 'butt',
  strokeLinejoin: 'miter',
  strokeDasharray: 'none',
  strokeDashoffset: '0',
  color: '#000000',
  visibility: 'visible',
  markerStart: 'none',
  markerMid: 'none',
  markerEnd: 'none',
}

export type Decls = Record<string, string>

export interface StyleRule {
  kind: 'class' | 'tag'
  name: string
  decls: Decls
}

/** Presentation attribute names read (exactly this set). */
const PRESENTATION_ATTRS = [
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-opacity', 'stroke-width',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray',
  'stroke-dashoffset', 'color', 'visibility', 'display', 'opacity', 'clip-path',
  'mask', 'filter', 'marker', 'marker-start', 'marker-mid', 'marker-end',
  'vector-effect', 'paint-order', 'stop-color', 'stop-opacity',
]

/** `name: value; name2: value2` → `{ name: value, name2: value2 }`. */
export function parseDeclarations(text: string): Decls {
  const out: Decls = {}
  for (const raw of text.split(';')) {
    const idx = raw.indexOf(':')
    if (idx < 0) continue
    let name = raw.slice(0, idx).trim().toLowerCase()
    let value = raw.slice(idx + 1).trim()
    value = value.replace(/!important\s*$/i, '').trim()
    if (name === '') continue
    if (name === 'marker') {
      out['marker-start'] = value
      out['marker-mid'] = value
      out['marker-end'] = value
      continue
    }
    out[name] = value
  }
  return out
}

/** Remove `/* … *\/` comments. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '')
}

/**
 * A tiny CSS parser: `selector-text { block }` pairs found by brace counting.
 * `@`-rules are skipped whole and reported. Only class and tag selectors are
 * kept; anything else is reported and dropped.
 */
export function parseStyleSheet(text: string, skip: (feature: string) => void): StyleRule[] {
  const clean = stripComments(text)
  const rules: StyleRule[] = []
  let i = 0
  const n = clean.length
  while (i < n) {
    // Skip whitespace
    while (i < n && /\s/.test(clean[i])) i++
    if (i >= n) break
    const selStart = i
    while (i < n && clean[i] !== '{') i++
    if (i >= n) break // unterminated selector, no block: stop
    const selectorText = clean.slice(selStart, i).trim()
    i++ // consume '{'
    const blockStart = i
    let depth = 1
    while (i < n && depth > 0) {
      if (clean[i] === '{') depth++
      else if (clean[i] === '}') depth--
      if (depth > 0) i++
    }
    const blockText = clean.slice(blockStart, i)
    if (i < n) i++ // consume closing '}'

    if (selectorText.startsWith('@')) {
      skip('css-at-rule')
      continue
    }
    if (selectorText === '') continue

    for (const rawSelector of selectorText.split(',')) {
      const selector = rawSelector.trim()
      if (selector === '') continue
      if (/^\.[A-Za-z_][\w-]*$/.test(selector)) {
        rules.push({ kind: 'class', name: selector.slice(1), decls: parseDeclarations(blockText) })
      } else if (/^[A-Za-z][\w-]*$/.test(selector)) {
        rules.push({ kind: 'tag', name: selector, decls: parseDeclarations(blockText) })
      } else {
        skip('css-selector')
      }
    }
  }
  return rules
}

/**
 * Declarations that apply to `node`, precedence low → high (later wins):
 * presentation attributes → tag rules → class rules (stylesheet order) →
 * the `style` attribute.
 */
export function declaredFor(node: SvgNode, rules: StyleRule[]): Decls {
  const out: Decls = {}
  for (const attr of PRESENTATION_ATTRS) {
    const value = node.attrs[attr]
    if (value !== undefined) out[attr] = value
  }

  for (const rule of rules) {
    if (rule.kind !== 'tag') continue
    if (rule.name !== node.tag) continue
    Object.assign(out, rule.decls)
  }

  const classAttr = node.attrs['class']
  const classNames = classAttr ? classAttr.split(/\s+/).filter(Boolean) : []
  if (classNames.length > 0) {
    for (const rule of rules) {
      if (rule.kind !== 'class') continue
      if (!classNames.includes(rule.name)) continue
      Object.assign(out, rule.decls)
    }
  }

  const styleAttr = node.attrs['style']
  if (styleAttr !== undefined) {
    Object.assign(out, parseDeclarations(styleAttr))
  }

  return out
}

function clampOpacity(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const trimmed = value.trim()
  const isPercent = trimmed.endsWith('%')
  const num = parseFloat(isPercent ? trimmed.slice(0, -1) : trimmed)
  if (!Number.isFinite(num)) return fallback
  const v = isPercent ? num / 100 : num
  return Math.min(1, Math.max(0, v))
}

/**
 * Each `SvgStyle` field takes the declared value unless absent or `inherit`,
 * else the parent's. Non-inherited properties (`display`, `opacity`,
 * `clip-path`, `mask`, `filter`, `vector-effect`, `paint-order`) are read from
 * `Decls` directly by the converter and never appear here.
 */
export function computeStyle(parent: SvgStyle, decls: Decls): SvgStyle {
  const inherited = (key: string): string | undefined => {
    const v = decls[key]
    if (v === undefined || v.trim().toLowerCase() === 'inherit') return undefined
    return v
  }

  const fillRuleRaw = inherited('fill-rule')
  const fillRule: 'nonzero' | 'evenodd' =
    fillRuleRaw === 'nonzero' || fillRuleRaw === 'evenodd' ? fillRuleRaw : parent.fillRule

  return {
    fill: inherited('fill') ?? parent.fill,
    fillOpacity: clampOpacity(inherited('fill-opacity'), parent.fillOpacity),
    fillRule,
    stroke: inherited('stroke') ?? parent.stroke,
    strokeOpacity: clampOpacity(inherited('stroke-opacity'), parent.strokeOpacity),
    strokeWidth: inherited('stroke-width') ?? parent.strokeWidth,
    strokeLinecap: inherited('stroke-linecap') ?? parent.strokeLinecap,
    strokeLinejoin: inherited('stroke-linejoin') ?? parent.strokeLinejoin,
    strokeMiterlimit: inherited('stroke-miterlimit') ?? parent.strokeMiterlimit,
    strokeDasharray: inherited('stroke-dasharray') ?? parent.strokeDasharray,
    strokeDashoffset: inherited('stroke-dashoffset') ?? parent.strokeDashoffset,
    color: inherited('color') ?? parent.color,
    visibility: inherited('visibility') ?? parent.visibility,
    markerStart: inherited('marker-start') ?? parent.markerStart,
    markerMid: inherited('marker-mid') ?? parent.markerMid,
    markerEnd: inherited('marker-end') ?? parent.markerEnd,
  }
}
