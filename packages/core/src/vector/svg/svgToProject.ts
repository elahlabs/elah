/**
 * SVG tree → child `Project` (PV-P6b-2). DOM-free: walks the plain `SvgNode`
 * tree built by a real parser (`DOMParser` in the browser, the test-only
 * `__tests__/xml.ts` in Node) and turns every drawable element into a `path`
 * shape clip, one track each, document order = stacking order. Groups whose
 * opacity is under 1 and hold more than one shape become nested compound
 * clips (PV-P1a); anything this ticket cannot represent is counted in the
 * returned `skipped` list rather than silently dropped or approximated.
 */

import type { Clip, Paint, Transform } from '../../types'
import { createClip } from '../../elements/base'
import {
  IDENTITY,
  type Affine,
  type PathSeg,
  multiply,
  translation,
  uniformScale,
  isConformal,
  parseTransformList,
  parsePathData,
  transformPath,
  pathBounds,
  pathToD,
  rectPath,
  ellipsePath,
  polyPath,
  parsePoints,
} from '../pathOps'
import { withAlpha } from '../color'
import { transformForBox, type Box } from '../place'
import { projectFromClips, compoundClipFor, maxShapesForStage } from '../importClip'
import {
  INITIAL_STYLE,
  type SvgStyle,
  type StyleRule,
  parseStyleSheet,
  declaredFor,
  computeStyle,
} from './style'
import { svgGradientPaint } from './gradients'
import type { SvgNode, SvgImportOptions, SvgImportResult, SvgSkip } from './types'

/** Elements that only define reusable content; never drawn directly. */
const DEFINITION_TAGS = new Set([
  'defs', 'title', 'desc', 'metadata', 'style', 'linearGradient', 'radialGradient',
  'stop', 'symbol', 'clipPath', 'mask', 'filter', 'pattern', 'marker',
])

const SHAPE_TAGS = new Set(['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path'])

/** Image-like placement covering the parent stage exactly (a group compound's transform). */
const FULL_STAGE: Transform = { x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } }

/** A group compound may nest to this many levels; PV-P1a's cap is 4 and the import itself uses one. */
const MAX_GROUP_DEPTH = 3

const UNIT_RE = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-Z%]*)$/

function clampUnit(n: number): number {
  return Math.min(1, Math.max(0, n))
}

function parseOpacityAttr(value: string | undefined): number {
  if (value === undefined) return 1
  const trimmed = value.trim()
  const isPercent = trimmed.endsWith('%')
  const num = parseFloat(isPercent ? trimmed.slice(0, -1) : trimmed)
  if (!Number.isFinite(num)) return 1
  return clampUnit(isPercent ? num / 100 : num)
}

export function svgToProject(root: SvgNode, opts: SvgImportOptions): SvgImportResult {
  if (root.tag !== 'svg') throw new Error('Not an SVG document')

  const skipMap = new Map<string, number>()
  const skip = (feature: string, n = 1): void => {
    skipMap.set(feature, (skipMap.get(feature) ?? 0) + n)
  }

  const ids = new Map<string, SvgNode>()
  collectIds(root, ids)

  const styleTexts: string[] = []
  collectStyleTexts(root, styleTexts)
  const rules: StyleRule[] = []
  for (const text of styleTexts) rules.push(...parseStyleSheet(text, skip))

  // --- ViewBox --------------------------------------------------------
  let vb: { x: number; y: number; width: number; height: number }
  const parsedVb = parseViewBoxAttr(root.attrs['viewBox'])
  if (parsedVb !== null && parsedVb.width > 0 && parsedVb.height > 0) {
    vb = parsedVb
  } else {
    const w = parsePxAttr(root.attrs['width'])
    const h = parsePxAttr(root.attrs['height'])
    if (w !== null && h !== null && w > 0 && h > 0) {
      vb = { x: 0, y: 0, width: w, height: h }
    } else {
      vb = { x: 0, y: 0, width: 300, height: 150 }
      skip('no-viewbox')
    }
  }

  const size = opts.size ?? 1024
  const k = size / Math.max(vb.width, vb.height)
  const stage = {
    width: Math.max(1, Math.round(vb.width * k)),
    height: Math.max(1, Math.round(vb.height * k)),
  }
  const R: Affine = [k, 0, 0, k, -vb.x * k, -vb.y * k]

  const maxShapes = opts.maxShapes ?? maxShapesForStage(stage)
  let shapeCount = 0
  let emitted = 0

  // ---------------------------------------------------------------------
  // Lengths
  // ---------------------------------------------------------------------

  function parseLength(value: string | undefined, axis: 'x' | 'y' | 'other'): number {
    if (value === undefined) return 0
    const m = UNIT_RE.exec(value.trim())
    if (!m) return 0
    const n = parseFloat(m[1])
    if (!Number.isFinite(n)) return 0
    const unit = m[2]
    switch (unit) {
      case '':
      case 'px':
        return n
      case '%': {
        const ref =
          axis === 'x' ? vb.width : axis === 'y' ? vb.height : Math.sqrt((vb.width * vb.width + vb.height * vb.height) / 2)
        return (n / 100) * ref
      }
      case 'pt':
        return (n * 4) / 3
      case 'pc':
        return n * 16
      case 'in':
        return n * 96
      case 'cm':
        return (n * 96) / 2.54
      case 'mm':
        return (n * 96) / 25.4
      case 'em':
        skip('unit:em')
        return n * 16
      case 'ex':
        skip('unit:ex')
        return n * 8
      default:
        skip(`unit:${unit}`)
        return n
    }
  }

  function isParseableLength(token: string): boolean {
    return UNIT_RE.test(token.trim())
  }

  // ---------------------------------------------------------------------
  // Paint
  // ---------------------------------------------------------------------

  const URL_RE = /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)\s*(.*)$/

  /**
   * `raw` is a fill/stroke value (`none`, `currentColor`, a colour, or
   * `url(#id) fallback`); `geom` is the element's own geometry (fill/stroke,
   * whichever `raw` belongs to) needed only when `raw` turns out to reference
   * a gradient, to build that gradient's coordinate spaces (PV-P6b-3).
   */
  function resolvePaint(
    raw: string,
    style: SvgStyle,
    opacity: number,
    geom: { m: Affine; userBounds: Box; stageBounds: Box },
  ): { color: string; paint?: Paint } {
    const trimmed = raw.trim()
    if (trimmed === 'none') return { color: 'transparent' }

    let base: string
    let paint: Paint | undefined
    if (trimmed === 'currentColor') {
      base = style.color
    } else {
      const m = URL_RE.exec(trimmed)
      if (m !== null) {
        const targetId = m[1]
        const fallback = m[2].trim()
        const target = ids.get(targetId)
        if (target === undefined) {
          skip('paint-server-missing')
          base = fallback !== '' ? fallback : 'transparent'
        } else if (target.tag === 'linearGradient' || target.tag === 'radialGradient') {
          const result = svgGradientPaint(
            target,
            ids,
            { style, m: geom.m, userBounds: geom.userBounds, stageBounds: geom.stageBounds, opacity },
            vb,
            skip,
            parseLength,
            rules,
          )
          if (result !== undefined && result.kind === 'paint') {
            paint = result.paint
            const firstStopColor = result.paint.type === 'solid' ? result.paint.color : (result.paint.stops[0]?.color ?? 'transparent')
            base = fallback !== '' ? fallback : firstStopColor
          } else {
            base = result !== undefined ? result.color : fallback !== '' ? fallback : 'transparent'
          }
        } else if (target.tag === 'pattern') {
          skip('pattern')
          base = fallback !== '' ? fallback : 'transparent'
        } else {
          base = fallback !== '' ? fallback : 'transparent'
        }
      } else {
        base = trimmed
      }
    }

    if (base === 'transparent' || opacity >= 1) return { color: base, paint }
    const withA = withAlpha(base, opacity)
    if (withA === base) skip('color-alpha')
    return { color: withA, paint }
  }

  // ---------------------------------------------------------------------
  // Group opacity wrapping, shared by <g>/<a>/<switch>/<use>
  // ---------------------------------------------------------------------

  function applyGroupOpacity(children: Clip[], opacity: number, depth: number, name: string): Clip[] {
    if (opacity >= 1) return children
    if (children.length === 0) return []
    if (children.length === 1) {
      const c = children[0]
      return [{ ...c, opacity: (c.opacity ?? 1) * opacity }]
    }
    if (depth + 1 <= MAX_GROUP_DEPTH) {
      const project = projectFromClips(children, { fps: opts.fps, stage })
      return [
        compoundClipFor(project, {
          name,
          startFrame: 0,
          durationFrames: opts.durationFrames,
          transform: FULL_STAGE,
          opacity,
        }),
      ]
    }
    skip('group-opacity-depth')
    return children.map((c) => ({ ...c, opacity: (c.opacity ?? 1) * opacity }))
  }

  // ---------------------------------------------------------------------
  // The walk
  // ---------------------------------------------------------------------

  function convertChildren(nodes: SvgNode[], m: Affine, style: SvgStyle, depth: number, useStack: ReadonlySet<string>): Clip[] {
    const out: Clip[] = []
    for (const child of nodes) out.push(...convertNode(child, m, style, depth, useStack))
    return out
  }

  function convertNode(node: SvgNode, m: Affine, parentStyle: SvgStyle, depth: number, useStack: ReadonlySet<string>): Clip[] {
    const tag = node.tag

    if (DEFINITION_TAGS.has(tag)) return []
    if (tag === 'text' || tag === 'image') {
      skip(tag)
      return []
    }
    if (tag === 'foreignObject') {
      skip('foreign-object')
      return []
    }
    if (tag === 'animate' || tag === 'animateTransform' || tag === 'animateMotion' || tag === 'set') {
      skip('animation')
      return []
    }
    if (tag === 'svg') {
      skip('nested-svg')
      return []
    }

    const decls = declaredFor(node, rules)
    const displayVal = decls['display']
    if (displayVal !== undefined && displayVal.trim().toLowerCase() === 'none') return []

    const style = computeStyle(parentStyle, decls)

    let m2 = m
    const transformAttr = node.attrs['transform']
    if (transformAttr !== undefined) {
      const t = parseTransformList(transformAttr)
      if (t === null) skip('transform-syntax')
      else m2 = multiply(m, t)
    }

    for (const prop of ['clip-path', 'mask', 'filter'] as const) {
      const v = decls[prop]
      if (v !== undefined && v.trim().toLowerCase() !== 'none') skip(prop)
    }

    const opacity = parseOpacityAttr(decls['opacity'])

    if (tag === 'g' || tag === 'a') {
      const childDepth = opacity < 1 ? depth + 1 : depth
      const converted = convertChildren(node.children, m2, style, childDepth, useStack)
      return applyGroupOpacity(converted, opacity, depth, node.attrs['id'] ?? 'Group')
    }

    if (tag === 'switch') {
      const firstUsable = node.children.find((c) => c.tag !== 'foreignObject')
      const childDepth = opacity < 1 ? depth + 1 : depth
      const content = firstUsable !== undefined ? convertNode(firstUsable, m2, style, childDepth, useStack) : []
      return applyGroupOpacity(content, opacity, depth, node.attrs['id'] ?? 'Group')
    }

    if (tag === 'use') {
      return convertUse(node, m2, style, depth, useStack, opacity)
    }

    if (SHAPE_TAGS.has(tag)) {
      return convertShape(node, tag, m2, style, opacity, decls)
    }

    skip(`element:${tag}`)
    return []
  }

  function convertUse(
    node: SvgNode,
    m: Affine,
    style: SvgStyle,
    depth: number,
    useStack: ReadonlySet<string>,
    opacity: number,
  ): Clip[] {
    const href = node.attrs['href']
    const match = href !== undefined ? /^#(.+)$/.exec(href) : null
    const targetId = match !== null ? match[1] : null
    const target = targetId !== null ? ids.get(targetId) : undefined

    if (targetId === null || target === undefined) {
      skip('use-missing')
      return []
    }
    if (useStack.has(targetId) || useStack.size >= 8) {
      skip('use-cycle')
      return []
    }

    const tx = parseLength(node.attrs['x'], 'x')
    const ty = parseLength(node.attrs['y'], 'y')
    const m2 = multiply(m, translation(tx, ty))
    const nextStack = new Set(useStack)
    nextStack.add(targetId)
    const childDepth = opacity < 1 ? depth + 1 : depth

    let content: Clip[]
    if (target.tag === 'symbol') {
      if (target.attrs['viewBox'] !== undefined) skip('symbol-viewbox')
      content = convertChildren(target.children, m2, style, childDepth, nextStack)
    } else {
      content = convertNode(target, m2, style, childDepth, nextStack)
    }

    return applyGroupOpacity(content, opacity, depth, node.attrs['id'] ?? 'Use')
  }

  function convertShape(
    node: SvgNode,
    tag: string,
    m: Affine,
    style: SvgStyle,
    opacity: number,
    decls: Record<string, string>,
  ): Clip[] {
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return []

    let geom: PathSeg[]
    switch (tag) {
      case 'rect': {
        const x = parseLength(node.attrs['x'], 'x')
        const y = parseLength(node.attrs['y'], 'y')
        const w = parseLength(node.attrs['width'], 'x')
        const h = parseLength(node.attrs['height'], 'y')
        let rx = node.attrs['rx'] !== undefined ? parseLength(node.attrs['rx'], 'x') : undefined
        let ry = node.attrs['ry'] !== undefined ? parseLength(node.attrs['ry'], 'y') : undefined
        if (rx === undefined && ry !== undefined) rx = ry
        if (ry === undefined && rx !== undefined) ry = rx
        geom = rectPath(x, y, w, h, rx ?? 0, ry ?? 0)
        break
      }
      case 'circle': {
        const r = parseLength(node.attrs['r'], 'other')
        const cx = parseLength(node.attrs['cx'], 'x')
        const cy = parseLength(node.attrs['cy'], 'y')
        geom = ellipsePath(cx, cy, r, r)
        break
      }
      case 'ellipse': {
        const rx = parseLength(node.attrs['rx'], 'x')
        const ry = parseLength(node.attrs['ry'], 'y')
        const cx = parseLength(node.attrs['cx'], 'x')
        const cy = parseLength(node.attrs['cy'], 'y')
        geom = ellipsePath(cx, cy, rx, ry)
        break
      }
      case 'line': {
        const x1 = parseLength(node.attrs['x1'], 'x')
        const y1 = parseLength(node.attrs['y1'], 'y')
        const x2 = parseLength(node.attrs['x2'], 'x')
        const y2 = parseLength(node.attrs['y2'], 'y')
        geom = [
          { c: 'M', x: x1, y: y1 },
          { c: 'L', x: x2, y: y2 },
        ]
        break
      }
      case 'polyline':
      case 'polygon': {
        const pts = parsePoints(node.attrs['points'] ?? '')
        geom = polyPath(pts, tag === 'polygon')
        break
      }
      default: // 'path'
        geom = parsePathData(node.attrs['d'] ?? '')
        break
    }

    if (geom.length === 0) return []

    const segs = transformPath(geom, m)
    const bounds = pathBounds(segs)
    if (bounds === null) return []

    let { x, y, width, height } = bounds
    if (width < 1e-3) {
      x -= (1 - width) / 2
      width = 1
    }
    if (height < 1e-3) {
      y -= (1 - height) / 2
      height = 1
    }
    const box = { x, y, width, height }
    // The element's own geometry bounds, before `m` — objectBoundingBox
    // gradients are relative to this, never to the stage-space `box` above.
    const userBounds: Box = pathBounds(geom) ?? box

    const scale = uniformScale(m)
    const fillResult = resolvePaint(style.fill, style, style.fillOpacity, { m, userBounds, stageBounds: box })
    const strokeResult = resolvePaint(style.stroke, style, style.strokeOpacity, { m, userBounds, stageBounds: box })
    let shapeFill = fillResult.color
    let shapeStroke = strokeResult.color
    let shapeFillPaint = fillResult.paint
    let shapeStrokePaint = strokeResult.paint
    const sw = parseLength(style.strokeWidth, 'other') * scale
    let shapeStrokeWidth = sw
    if (sw <= 0) {
      shapeStroke = 'transparent'
      shapeStrokeWidth = 0
      shapeStrokePaint = undefined
    }

    if (shapeStroke !== 'transparent' && !isConformal(m)) skip('non-uniform-stroke')

    if (shapeFill === 'transparent' && shapeStroke === 'transparent' && shapeFillPaint === undefined && shapeStrokePaint === undefined) {
      return []
    }

    shapeCount++
    if (emitted === maxShapes) {
      skip('element-limit')
      return []
    }
    emitted++

    let shapeStrokeDash: number[] | undefined
    let shapeStrokeDashOffset: number | undefined
    let shapeStrokeCap: 'round' | 'square' | undefined
    let shapeStrokeJoin: 'round' | 'bevel' | undefined

    if (shapeStroke !== 'transparent') {
      const dashRaw = style.strokeDasharray.trim()
      if (dashRaw !== '' && dashRaw.toLowerCase() !== 'none') {
        const tokens = dashRaw.split(/[\s,]+/).filter((t) => t.length > 0)
        const parseable = tokens.length > 0 && tokens.every(isParseableLength)
        const values = parseable ? tokens.map((t) => parseLength(t, 'other')) : []
        const valid = parseable && values.every((v) => v >= 0) && values.some((v) => v > 0)
        if (valid) {
          shapeStrokeDash = values.map((v) => v * scale)
          const offset = parseLength(style.strokeDashoffset, 'other') * scale
          if (offset !== 0) shapeStrokeDashOffset = offset
        }
      }

      const cap = style.strokeLinecap
      if (cap === 'round' || cap === 'square') shapeStrokeCap = cap

      const join = style.strokeLinejoin
      if (join === 'round' || join === 'bevel') shapeStrokeJoin = join
      else if (join === 'miter-clip' || join === 'arcs') skip(`line-join:${join}`)

      if (style.strokeMiterlimit !== undefined) skip('stroke-miterlimit')

      if (style.markerStart !== 'none' || style.markerMid !== 'none' || style.markerEnd !== 'none') skip('marker')

      const ve = decls['vector-effect']
      if (ve !== undefined && ve.trim().toLowerCase() !== 'none') skip('vector-effect')

      const po = decls['paint-order']
      if (po !== undefined && po.trim().toLowerCase() !== 'normal') skip('paint-order')
    }

    const name = node.attrs['id'] ?? `${tag} ${emitted}`

    return [
      createClip({
        type: 'shape',
        trackId: '',
        name,
        startFrame: 0,
        durationFrames: opts.durationFrames,
        opacity,
        transform: transformForBox(IDENTITY, box, stage, 'shape').transform,
        shape: {
          shapeKind: 'path',
          shapePath: pathToD(segs),
          shapeViewBox: box,
          shapeFill,
          shapeStroke,
          shapeStrokeWidth,
          ...(style.fillRule === 'evenodd' ? { shapeFillRule: 'evenodd' as const } : {}),
          ...(shapeStrokeDash !== undefined ? { shapeStrokeDash } : {}),
          ...(shapeStrokeDashOffset !== undefined ? { shapeStrokeDashOffset } : {}),
          ...(shapeStrokeCap !== undefined ? { shapeStrokeCap } : {}),
          ...(shapeStrokeJoin !== undefined ? { shapeStrokeJoin } : {}),
          ...(shapeFillPaint !== undefined ? { shapeFillPaint } : {}),
          ...(shapeStrokePaint !== undefined ? { shapeStrokePaint } : {}),
        },
      }),
    ]
  }

  // The root <svg> element's own presentation attributes / style are the
  // inherited baseline for every child (SVG semantics: `<svg>` is a normal
  // container for inheritance purposes even though its geometry is handled
  // separately, above).
  const rootStyle = computeStyle(INITIAL_STYLE, declaredFor(root, rules))
  const items = convertChildren(root.children, R, rootStyle, 1, new Set<string>())
  const project = projectFromClips(items, { fps: opts.fps, stage })

  const skipped: SvgSkip[] = Array.from(skipMap.entries())
    .map(([feature, count]) => ({ feature, count }))
    .sort((a, b) => a.feature.localeCompare(b.feature))

  return { project, skipped, shapeCount }
}

// ---------------------------------------------------------------------------
// Tree scans, run once before the walk
// ---------------------------------------------------------------------------

function collectIds(node: SvgNode, ids: Map<string, SvgNode>): void {
  const id = node.attrs['id']
  if (id !== undefined && !ids.has(id)) ids.set(id, node)
  for (const child of node.children) collectIds(child, ids)
}

function collectStyleTexts(node: SvgNode, out: string[]): void {
  if (node.tag === 'style') out.push(node.text ?? '')
  for (const child of node.children) collectStyleTexts(child, out)
}

function parseViewBoxAttr(value: string | undefined): { x: number; y: number; width: number; height: number } | null {
  if (value === undefined) return null
  const nums = value.trim().split(/[\s,]+/).filter((t) => t.length > 0).map(Number)
  if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) return null
  const [x, y, width, height] = nums
  return { x, y, width, height }
}

function parsePxAttr(value: string | undefined): number | null {
  if (value === undefined) return null
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(px)?$/.exec(value.trim())
  if (!m) return null
  const n = parseFloat(m[1])
  return Number.isFinite(n) ? n : null
}
