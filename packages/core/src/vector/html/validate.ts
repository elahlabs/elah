/**
 * The whitelist for a scene written in the HTML/CSS subset (MC-1a; plan
 * sections 4.1 and 4.2). DOM-free: a small lenient tokenizer over the markup
 * (tag names and attributes) and over the stylesheet / inline `style=""` text
 * (rules and declarations). It never fixes anything: every violation is
 * reported with the native substitute where one exists, so the model can retry.
 */

import { FONT_REGISTRY } from '../../fonts/registry'
import { parseCssColor } from '../color'
import { cssGradientToPaint } from './cssGradient'
import { nearest, parseMotion } from './motion'
import type { SceneSource, SceneViolation } from './types'

const BLOCK_TAGS = new Set(['div', 'section', 'header', 'footer', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span'])
const LIST_TAGS = new Set(['ul', 'ol', 'li'])
const ELEMENT_TAGS = new Set([...BLOCK_TAGS, ...LIST_TAGS, 'svg', 'img', 'style'])
const VOID_TAGS = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'area', 'base', 'col', 'embed', 'track', 'wbr'])

const TAG_SUBSTITUTES: Record<string, string> = {
  canvas: 'an svg, or native shape clips',
  iframe: 'native clips; embedded pages are not supported',
  video: 'a video asset clip placed by the editor, not by the scene',
  audio: 'an audio asset clip placed by the editor, not by the scene',
  link: 'inline the rules in the scene style block',
  button: 'a div with a background',
  a: 'a span',
  br: 'two elements, or the text wrapped by the box width',
  b: 'a span with font-weight',
  strong: 'a span with font-weight',
  i: 'a span with font-style',
  em: 'a span with font-style',
  u: 'a span with text-decoration: underline',
  table: 'flex or grid divs',
}

const GLOBAL_ATTRS = new Set(['id', 'class', 'style', 'role', 'title', 'alt', 'lang'])
const IMG_ATTRS = new Set(['src', 'width', 'height'])

const ALLOWED_PROPS = new Set([
  'position', 'display', 'inset', 'top', 'left', 'right', 'bottom', 'width', 'height',
  'min-width', 'min-height', 'max-width', 'max-height', 'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'box-sizing',
  'gap', 'row-gap', 'column-gap',
  'flex', 'flex-direction', 'flex-wrap', 'flex-flow', 'flex-grow', 'flex-shrink', 'flex-basis', 'order',
  'align-items', 'align-content', 'align-self', 'justify-content', 'justify-items', 'justify-self',
  'place-items', 'place-content', 'place-self',
  'grid', 'grid-template', 'grid-template-columns', 'grid-template-rows', 'grid-template-areas', 'grid-area',
  'grid-column', 'grid-row', 'grid-auto-flow', 'grid-auto-columns', 'grid-auto-rows',
  'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'line-height', 'text-align', 'white-space', 'color',
  'background', 'background-color', 'background-image', 'background-clip', '-webkit-background-clip', '-webkit-text-fill-color',
  'border', 'border-width', 'border-style', 'border-color', 'border-radius',
  'opacity', 'text-shadow', '-webkit-text-stroke', '-webkit-text-stroke-width', '-webkit-text-stroke-color',
  'mix-blend-mode', 'clip-path', 'overflow', 'translate', 'rotate', 'scale', 'transform-origin', 'z-index',
  'object-fit', 'list-style', 'list-style-type', 'filter',
  'box-shadow', 'text-decoration', 'text-decoration-line',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
])

/** Refused properties and what to use instead. */
const REFUSED_PROPS: Record<string, { message: string; substitute?: string }> = {
  'backdrop-filter': { message: 'backdrop-filter is not supported', substitute: 'an adjustment clip beneath the element' },
  'text-transform': { message: 'text-transform is not supported', substitute: 'write the text in the case you want' },
  perspective: { message: 'the perspective property is not supported (the eye distance is fixed at 1200px)', substitute: 'a data-motion clause on the rotateX / rotateY channels of an image, video or compound clip, e.g. rotateY: 0 → 90deg 0.4s' },
  'transform-style': { message: '3D scenes are not supported', substitute: 'rotateX / rotateY data-motion channels on a single image, video or compound clip' },
  'backface-visibility': { message: 'backface-visibility is not supported (a flipped clip shows its back face, mirrored)', substitute: 'two stacked clips that swap opacity at 90deg of rotateY' },
  'font-variation-settings': { message: 'variable font axes are not supported', substitute: 'a bundled font weight' },
  'font-variant': { message: 'font-variant is not supported' },
  transform: { message: 'the transform shorthand is not supported', substitute: 'the individual translate, rotate and scale properties; skew and 3D tilt with the skewX / skewY / rotateX / rotateY data-motion channels' },
  skew: { message: 'skew is not a CSS property here', substitute: 'a data-motion clause on the skewX / skewY channels, e.g. skewX: 0 → 12deg 0.4s' },
  animation: { message: 'CSS animation is not supported', substitute: 'data-motion on the element' },
  transition: { message: 'CSS transitions are not supported', substitute: 'data-motion on the element' },
  'text-overflow': { message: 'text-overflow is not supported' },
}

const BLEND_MODES = new Set(['normal', 'screen', 'multiply', 'overlay', 'soft-light', 'darken', 'lighten', 'difference', 'plus-lighter'])
const DISPLAY_VALUES = new Set(['block', 'flex', 'grid', 'inline-block', 'none'])
const POSITION_VALUES = new Set(['static', 'relative', 'absolute'])
const CLIP_PATH_FNS = ['inset(', 'circle(', 'ellipse(', 'path(']

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

const GENERIC_FAMILY: Record<string, string> = {
  'sans-serif': 'inter',
  serif: 'playfair-display',
  monospace: 'roboto-mono',
  cursive: 'caveat',
  fantasy: 'bebas-neue',
  'system-ui': 'inter',
  'ui-sans-serif': 'inter',
  'ui-serif': 'playfair-display',
  'ui-monospace': 'roboto-mono',
}

function unquote(s: string): string {
  return s.trim().replace(/^["']|["']$/g, '').trim()
}

/** The bundled id a family name resolves to, by id or by display name (and the `elah-` prefix). */
export function resolveFontId(name: string): string | undefined {
  const n = unquote(name).toLowerCase().replace(/^elah-/, '')
  for (const f of FONT_REGISTRY) if (f.id === n || f.family.toLowerCase() === n) return f.id
  return undefined
}

/** The nearest bundled family for a name the registry does not know, by role. */
export function nearestFontId(name: string): string {
  const n = unquote(name).toLowerCase()
  const generic = GENERIC_FAMILY[n]
  if (generic) return generic
  if (/mono|code|courier|consolas/.test(n)) return 'roboto-mono'
  if (/script|hand|brush|marker/.test(n)) return 'caveat'
  if (/serif|times|georgia|garamond|playfair|merriweather/.test(n) && !/sans/.test(n)) return 'playfair-display'
  if (/impact|condensed|display|black|heavy|bebas|anton/.test(n)) return 'bebas-neue'
  return 'inter'
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

interface Decl {
  prop: string
  value: string
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

function splitOutside(s: string, sep: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote = ''
  let cur = ''
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === sep && depth === 0 && !quote) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur.trim() !== '') out.push(cur)
  return out
}

function parseDecls(body: string): Decl[] {
  const out: Decl[] = []
  for (const part of splitOutside(stripComments(body), ';')) {
    const i = part.indexOf(':')
    if (i < 0) {
      if (part.trim() !== '') out.push({ prop: part.trim().toLowerCase(), value: '' })
      continue
    }
    out.push({
      prop: part.slice(0, i).trim().toLowerCase(),
      value: part.slice(i + 1).trim().replace(/\s*!important\s*$/i, ''),
    })
  }
  return out
}

interface CssRule {
  selector: string
  body: string
}

/** Rules and at-rules of a stylesheet, one level deep. */
function parseSheet(css: string): { rules: CssRule[]; atRules: string[] } {
  const text = stripComments(css)
  const rules: CssRule[] = []
  const atRules: string[] = []
  let i = 0
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i++
    if (i >= text.length) break
    const start = i
    if (text[i] === '@') {
      let j = i
      while (j < text.length && text[j] !== ';' && text[j] !== '{') j++
      const name = text.slice(i, j).trim().split(/\s+/)[0].toLowerCase()
      atRules.push(name)
      if (text[j] === '{') {
        let depth = 0
        for (; j < text.length; j++) {
          if (text[j] === '{') depth++
          else if (text[j] === '}' && --depth === 0) break
        }
      }
      i = j + 1
      continue
    }
    const open = text.indexOf('{', start)
    if (open < 0) break
    const close = text.indexOf('}', open)
    const end = close < 0 ? text.length : close
    rules.push({ selector: text.slice(start, open).trim(), body: text.slice(open + 1, end) })
    i = end + 1
  }
  return { rules, atRules }
}

const EXTERNAL_URL_RE = /url\(\s*["']?\s*(?:https?:|\/\/|data:text|javascript:)/i

class Collector {
  readonly violations: SceneViolation[] = []
  add(v: SceneViolation): void {
    this.violations.push(v)
  }
}

function checkDecl(c: Collector, element: string, d: Decl, inRoot: boolean): void {
  const { prop, value } = d
  const lower = value.toLowerCase()
  const bad = (message: string, substitute?: string): void =>
    c.add({ element, property: prop, value, message, ...(substitute ? { substitute } : {}) })

  if (prop.startsWith('--')) {
    if (!inRoot) bad('CSS variables may only be declared on :root', 'declare it in the :root rule')
    return
  }
  if (EXTERNAL_URL_RE.test(value)) {
    bad('external or script URLs are not allowed', 'a project asset id or an elah-asset: URL, set on an img src')
    return
  }
  if (/url\(/i.test(value)) {
    bad('url() is not supported in styles', 'an img element, or an inline svg')
    return
  }
  const refused = REFUSED_PROPS[prop]
  if (refused) {
    bad(refused.message, refused.substitute)
    return
  }
  if (!ALLOWED_PROPS.has(prop)) {
    bad(`"${prop}" is not in the supported subset`)
    return
  }
  if (/repeating-(linear|radial|conic)-gradient/.test(lower)) {
    bad('repeating gradients are not supported', 'linear-gradient, radial-gradient or conic-gradient with stops')
    return
  }
  for (const call of conicCalls(value)) {
    const parsed = cssGradientToPaint(call)
    if (!parsed.ok) {
      bad(`unreadable conic-gradient: ${parsed.reason}`, 'conic-gradient(from <angle> at <x> <y>, <color> <stop>, ...)')
      return
    }
  }
  if (/calc\(/.test(lower) && /\d(vw|vh|vmin|vmax)\b/.test(lower)) {
    bad('calc() with viewport units is not supported', 'stage px values')
    return
  }
  if (/(^|[\s,(])(env|attr)\(/.test(lower)) {
    bad('env() and attr() are not supported')
    return
  }
  switch (prop) {
    case 'display':
      if (!DISPLAY_VALUES.has(lower)) bad(`display: ${value} is not supported`, 'block, flex, grid, inline-block or none')
      break
    case 'position':
      if (!POSITION_VALUES.has(lower)) bad(`position: ${value} is not supported`, 'static, relative or absolute')
      break
    case 'overflow':
      if (lower !== 'hidden' && lower !== 'visible') bad(`overflow: ${value} is not supported`, 'hidden or visible')
      break
    case 'mix-blend-mode':
      if (!BLEND_MODES.has(lower)) bad(`mix-blend-mode: ${value} is not one of the engine's blend modes`, 'normal, screen, multiply, overlay, soft-light, darken, lighten, difference or plus-lighter')
      break
    case 'clip-path':
      if (lower !== 'none' && !CLIP_PATH_FNS.some((f) => lower.startsWith(f))) bad('clip-path supports inset(), circle(), ellipse() and path() only', 'one of those four')
      break
    case 'border-radius': {
      const corners = splitOutside(value, ' ').map((p) => p.trim()).filter(Boolean)
      if (value.includes('/')) {
        bad('elliptical corner radii are not supported', 'up to four px values, one per corner')
      } else if (corners.length > 4) {
        bad('border-radius takes at most four values', 'up to four px values, one per corner')
      } else if (corners.length > 1 && !corners.every((p) => p === corners[0]) && !corners.every(isPxLength)) {
        bad('per-corner radii must be px values', 'up to four px values, one per corner')
      }
      break
    }
    case 'border-top-left-radius':
    case 'border-top-right-radius':
    case 'border-bottom-right-radius':
    case 'border-bottom-left-radius':
      if (!isPxLength(value.trim())) bad(`${prop} takes one px value`, 'one px value, or border-radius with up to four')
      break
    case 'box-shadow': {
      const problem = boxShadowProblem(value)
      if (problem) bad(problem, 'one outer shadow: <x> <y> <blur> <color>')
      break
    }
    case 'text-decoration':
    case 'text-decoration-line':
      if (lower !== 'none' && lower !== 'underline' && lower !== 'line-through') {
        bad(`${prop}: ${value} is not supported`, 'underline or line-through')
      }
      break
    case 'filter': {
      if (lower === 'none') break
      const fns = [...lower.matchAll(/([a-z-]+)\(/g)].map((m) => m[1])
      const other = fns.filter((f) => f !== 'blur' && f !== 'drop-shadow')
      if (other.length > 0) bad(`filter: ${other.join(', ')} is not supported; only blur() and drop-shadow() are`, 'a blur or glow effect, or an adjustment clip')
      break
    }
    case 'font-family': {
      const families = splitOutside(value, ',').map(unquote)
      const first = families[0] ?? ''
      if (first.startsWith('var(')) break
      if (!resolveFontId(first) && !GENERIC_FAMILY[first.toLowerCase()]) {
        bad(`font "${first}" is not bundled`, nearestFontId(first))
      } else {
        const unknownLater = families.slice(1).filter((f) => !f.startsWith('var(') && !resolveFontId(f) && !GENERIC_FAMILY[f.toLowerCase()])
        if (unknownLater.length > 0) bad('one font family per text element', first)
      }
      break
    }
    case 'background':
    case 'background-image':
      if (/\burl\(/i.test(lower)) bad('background images are not supported', 'an img element')
      break
    case 'background-clip':
    case '-webkit-background-clip':
      if (lower !== 'text' && lower !== 'border-box') bad(`${prop}: ${value} is not supported`, 'text (with a gradient) or border-box')
      break
    default:
      break
  }
}

/** `12px`, `-4px` or a bare `0`. */
function isPxLength(s: string): boolean {
  return /^[+-]?(?:\d+\.?\d*|\.\d+)px$/i.test(s) || /^[+-]?0*\.?0+$/.test(s)
}

/** The text of every balanced `conic-gradient(...)` call in a value. */
function conicCalls(value: string): string[] {
  const out: string[] = []
  const lower = value.toLowerCase()
  let from = 0
  for (;;) {
    const at = lower.indexOf('conic-gradient(', from)
    if (at < 0) break
    // A repeating-conic-gradient is refused before this runs; skip a prefix match anyway.
    let depth = 0
    let end = at
    for (; end < value.length; end++) {
      if (value[end] === '(') depth++
      else if (value[end] === ')' && --depth === 0) break
    }
    out.push(value.slice(at, end + 1))
    from = end + 1
  }
  return out
}

/**
 * Why a `box-shadow` is outside the subset, or null when it is one outer shadow:
 * `<x> <y> [<blur> [<spread 0>]] <color>`, px lengths, the colour first or last.
 */
function boxShadowProblem(value: string): string | null {
  const v = value.trim()
  if (v.toLowerCase() === 'none') return null
  if (splitOutside(v, ',').length > 1) return 'box-shadow supports one outer shadow, not a list'
  const tokens = splitOutside(v.replace(/\s+/g, ' '), ' ').map((t) => t.trim()).filter(Boolean)
  if (tokens.some((t) => t.toLowerCase() === 'inset')) return 'inset box-shadow is not supported; only one outer shadow'
  const colours = tokens.filter((t) => !isPxLength(t))
  const lengths = tokens.filter(isPxLength)
  if (colours.length !== 1 || !(parseCssColor(colours[0]) !== null || /^var\(/i.test(colours[0]) || /^currentcolor$/i.test(colours[0]))) {
    return 'box-shadow needs exactly one colour and px lengths'
  }
  if (lengths.length < 2) return 'box-shadow needs at least an x and a y offset'
  if (lengths.length > 4) return 'box-shadow takes at most x, y, blur and spread'
  if (lengths.length === 4 && parseFloat(lengths[3]) !== 0) return 'box-shadow spread is not supported; only one outer shadow with no spread'
  return null
}

function validateDecls(c: Collector, element: string, decls: Decl[], inRoot: boolean): void {
  for (const d of decls) {
    if (d.value === '' && !d.prop.startsWith('--')) {
      c.add({ element, property: d.prop, message: `declaration "${d.prop}" has no value` })
      continue
    }
    checkDecl(c, element, d, inRoot)
  }
}

function validateStyleText(c: Collector, css: string): void {
  const { rules, atRules } = parseSheet(css)
  for (const at of atRules) {
    const sub =
      at === '@font-face' ? 'the bundled font ids' :
      at === '@keyframes' ? 'data-motion on the element' :
      at === '@import' ? 'inline the rules in this style block' :
      undefined
    c.add({ element: 'style', property: at, message: `${at} is not supported`, ...(sub ? { substitute: sub } : {}) })
  }
  for (const rule of rules) {
    const sel = rule.selector
    const isRoot = sel === ':root'
    const simple = /^(#[A-Za-z_][\w-]*|\.[A-Za-z_][\w-]*)$/.test(sel)
    if (!isRoot && !simple) {
      const pseudo = /::|:/.test(sel)
      c.add({
        element: 'style',
        property: 'selector',
        value: sel,
        message: pseudo ? 'pseudo-classes and pseudo-elements are not supported' : 'only :root, #id and .class selectors are supported',
        substitute: 'give the element an id and select it with #id',
      })
      continue
    }
    validateDecls(c, sel, parseDecls(rule.body), isRoot)
  }
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

interface OpenTag {
  tag: string
  name: string
  childCount: number
}

const TOKEN_RE = /<!--[\s\S]*?-->|<\/([A-Za-z][\w:-]*)\s*>|<([A-Za-z][\w:-]*)((?:\s+[^\s"'<>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/g
const ATTR_RE = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g

function parseAttrs(src: string): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = []
  for (const m of src.matchAll(ATTR_RE)) out.push({ name: m[1].toLowerCase(), value: m[2] ?? m[3] ?? m[4] ?? '' })
  return out
}

export function validateScene(src: SceneSource): { ok: boolean; violations: SceneViolation[] } {
  const c = new Collector()
  const html = src.html ?? ''
  if ((src.css ?? '').trim() !== '') validateStyleText(c, src.css)
  const stack: OpenTag[] = []
  let svgDepth = 0
  let rootCount = 0
  /** MOT-6: every `data-motion` with where it sits, checked for undeclared labels after the whole scene is read. */
  const motions: Array<{ element: string; value: string }> = []


  TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  // Raw-text elements are skipped to their close tag so "<" inside does not tokenize.
  const skipRaw = (tag: string, from: number): { text: string; next: number } => {
    const close = new RegExp(`</${tag}\\s*>`, 'i')
    const rest = html.slice(from)
    const found = close.exec(rest)
    if (!found) return { text: rest, next: html.length }
    return { text: rest.slice(0, found.index), next: from + found.index + found[0].length }
  }

  while ((m = TOKEN_RE.exec(html)) !== null) {
    const last = TOKEN_RE.lastIndex
    if (m[0].startsWith('<!--')) continue
    if (m[1] !== undefined) {
      // closing tag
      const tag = m[1].toLowerCase()
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          if (tag === 'svg') svgDepth = Math.max(0, svgDepth - 1)
          stack.length = i
          break
        }
      }
      continue
    }
    const rawTag = m[2]
    const tag = rawTag.toLowerCase()
    const attrs = parseAttrs(m[3] ?? '')
    const selfClose = m[4] === '/' || VOID_TAGS.has(tag)
    const parent = stack[stack.length - 1]
    const id = attrs.find((a) => a.name === 'id')?.value
    const idx = parent ? parent.childCount++ : rootCount++
    const name = id && id !== '' ? `#${id}` : `${tag}[${idx}]`
    const here = [...stack.map((s) => s.name), name].join(' > ')
    const inSvg = svgDepth > 0 || tag === 'svg'

    if (tag === 'script') {
      c.add({ element: here, message: '<script> is never allowed', substitute: 'data-motion for animation' })
      const raw = skipRaw('script', last)
      TOKEN_RE.lastIndex = raw.next
      continue
    }
    if (tag === 'style' && svgDepth === 0) {
      const raw = selfClose ? { text: '', next: last } : skipRaw('style', last)
      validateStyleText(c, raw.text)
      TOKEN_RE.lastIndex = raw.next
      continue
    }

    if (!inSvg) {
      if (!ELEMENT_TAGS.has(tag)) {
        c.add({
          element: here,
          property: tag,
          message: `<${tag}> is not in the supported subset`,
          ...(TAG_SUBSTITUTES[tag] ? { substitute: TAG_SUBSTITUTES[tag] } : {}),
        })
      }
    } else if (tag === 'foreignobject') {
      c.add({ element: here, message: '<foreignObject> is not supported inside svg', substitute: 'a sibling div positioned over the svg' })
    }

    for (const a of attrs) {
      if (a.name.startsWith('on')) {
        c.add({ element: here, property: a.name, value: a.value, message: 'event handler attributes are never allowed', substitute: 'data-motion for animation' })
        continue
      }
      if (/^\s*javascript:/i.test(a.value)) {
        c.add({ element: here, property: a.name, value: a.value, message: 'javascript: URLs are never allowed' })
        continue
      }
      const isUrlAttr = a.name === 'src' || a.name === 'href' || a.name === 'xlink:href'
      if (isUrlAttr && /^\s*(https?:)?\/\//i.test(a.value)) {
        c.add({
          element: here,
          property: a.name,
          value: a.value,
          message: 'external URLs are not allowed',
          substitute: 'a project asset id or an elah-asset: URL',
        })
        continue
      }
      if (a.name === 'data-motion') motions.push({ element: here, value: a.value })
      if (a.name === 'style') {
        validateDecls(c, here, parseDecls(a.value), false)
        continue
      }
      if (inSvg) {
        if (EXTERNAL_URL_RE.test(a.value)) c.add({ element: here, property: a.name, value: a.value, message: 'external URLs are not allowed' })
        continue
      }
      const ok =
        GLOBAL_ATTRS.has(a.name) ||
        a.name.startsWith('data-') ||
        a.name.startsWith('aria-') ||
        (tag === 'img' && IMG_ATTRS.has(a.name))
      if (!ok) c.add({ element: here, property: a.name, value: a.value, message: `attribute "${a.name}" is not in the supported subset` })
    }

    if (!selfClose) {
      stack.push({ tag, name, childCount: 0 })
      if (tag === 'svg') svgDepth++
    }
  }

  checkMotionLabels(c, motions)
  return { ok: c.violations.length === 0, violations: c.violations }
}

/** A `data-motion` position that names a label no element declares (MOT-6). */
function checkMotionLabels(c: Collector, motions: Array<{ element: string; value: string }>): void {
  const parsed = motions.map((m) => ({ ...m, clauses: parseMotion(m.value).clauses }))
  const declared = new Set<string>()
  for (const m of parsed) for (const cl of m.clauses) if (cl.kind === 'label') declared.add(cl.name)
  for (const m of parsed) {
    for (const cl of m.clauses) {
      if (cl.kind === 'stagger' || cl.ref?.kind !== 'label' || declared.has(cl.ref.name)) continue
      c.add({
        element: m.element,
        property: 'data-motion',
        value: '@' + cl.ref.name,
        message: 'the label "' + cl.ref.name + '" is never declared',
        ...(declared.size > 0 ? { substitute: nearest(cl.ref.name, [...declared]) } : { substitute: 'declare it with "label: ' + cl.ref.name + ' @<seconds>"' }),
      })
    }
  }
}
