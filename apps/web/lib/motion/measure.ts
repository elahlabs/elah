/**
 * Lay out a scene written in the HTML/CSS subset into a `MeasuredScene`. Browser-only: it mounts the
 * fragment in a hidden, stage-sized host, waits for fonts, reads boxes, line breaks and computed styles,
 * and unmounts. Everything after this (`sceneToClip` in core) is pure.
 *
 * Ported from the creator app's `lib/editor/motionCode/measure.ts`; the only changes are the imports
 * (`@elah/core`) and an inlined DOM -> SvgNode converter. The fragment is parsed with `DOMParser`
 * (no script runs) and scripts and `on*` attributes are stripped again before anything is imported.
 */

import { FONT_REGISTRY, type SvgNode } from '@elah/core'
import type { MeasuredBox, MeasuredLine, MeasuredNode, MeasuredScene, MeasuredStyle, SceneSource } from '@elah/core/html'

export interface MeasureOptions {
  stage: { width: number; height: number }
  /** Resolves when the bundled faces are loaded. */
  fontsReady: () => Promise<void>
}

const HOST_ATTR = 'data-mc-host'
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/'

function domToSvgNode(el: Element): SvgNode {
  const attrs: Record<string, string> = {}
  for (const attr of Array.from(el.attributes)) {
    if (attr.namespaceURI === XMLNS_NS) continue
    attrs[attr.localName] = attr.value
  }
  const children: SvgNode[] = []
  for (const child of Array.from(el.children)) children.push(domToSvgNode(child))
  const tag = el.localName
  return { tag, attrs, children, ...(tag === 'style' ? { text: el.textContent ?? '' } : {}) }
}

/** Prefix every rule of the scene's stylesheet so it only reaches the element carrying `attr`. */
export function scopeCss(css: string, attr: string = HOST_ATTR): string {
  return css.replace(/([^{}@]+)\{([^{}]*)\}/g, (_all, selector: string, body: string) => {
    const scoped = selector
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (s === ':root' ? `[${attr}]` : `[${attr}] ${s}`))
      .join(', ')
    return `${scoped} {${body}}`
  })
}

/** Rewrite the first family of every `font-family` that names a bundled font to its registered `elah-<id>` name. */
export function mapBundledFontFamilies(css: string): string {
  return css.replace(/(font-family\s*:\s*)([^;}]+)/gi, (all, head: string, value: string) => {
    if (/var\(/i.test(value)) return all
    const first = value.split(',')[0].trim().replace(/^["']|["']$/g, '').trim().toLowerCase().replace(/^elah-/, '')
    const def = FONT_REGISTRY.find((f) => f.id === first || f.family.toLowerCase() === first)
    return def ? `${head}"elah-${def.id}", sans-serif` : all
  })
}

function mapInlineFonts(root: ParentNode): void {
  for (const el of Array.from(root.querySelectorAll('[style]'))) {
    const v = el.getAttribute('style') ?? ''
    if (/font-family/i.test(v)) el.setAttribute('style', mapBundledFontFamilies(v))
  }
}

function sanitise(root: ParentNode): void {
  for (const s of Array.from(root.querySelectorAll('script, iframe, object, embed'))) s.remove()
  for (const el of Array.from(root.querySelectorAll('*'))) {
    for (const a of Array.from(el.attributes)) {
      if (a.name.toLowerCase().startsWith('on')) el.removeAttribute(a.name)
    }
  }
}

const px = (s: string): number => {
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : 0
}

function decorationOf(el: Element): string | undefined {
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    const line = getComputedStyle(cur).textDecorationLine
    if (line && line !== 'none') return line
  }
  return undefined
}

function readStyle(el: Element, boxW: number, boxH: number): MeasuredStyle {
  const cs = getComputedStyle(el)
  const none = (v: string): string | undefined => (v === 'none' || v === 'normal' || v === '' ? undefined : v)
  const fontSize = px(cs.fontSize)
  const cornerPx = (v: string): number => (v.endsWith('%') ? (parseFloat(v) / 100) * Math.min(boxW, boxH) : px(v))
  const radii: [number, number, number, number] = [
    cornerPx(cs.borderTopLeftRadius),
    cornerPx(cs.borderTopRightRadius),
    cornerPx(cs.borderBottomRightRadius),
    cornerPx(cs.borderBottomLeftRadius),
  ]
  const radius = Math.max(...radii)
  const decoration = decorationOf(el)
  const borderW = cs.borderTopStyle === 'none' || cs.borderTopStyle === 'hidden' ? 0 : px(cs.borderTopWidth)
  const z = parseInt(cs.zIndex, 10)
  const strokeW = px(cs.getPropertyValue('-webkit-text-stroke-width'))
  const clip = cs.getPropertyValue('background-clip') || cs.getPropertyValue('-webkit-background-clip')
  return {
    color: cs.color,
    backgroundColor: cs.backgroundColor,
    ...(none(cs.backgroundImage) ? { backgroundImage: cs.backgroundImage } : {}),
    borderWidth: borderW,
    borderColor: cs.borderTopColor,
    borderRadius: radius,
    borderRadii: radii,
    ...(none(cs.boxShadow) ? { boxShadow: cs.boxShadow } : {}),
    ...(decoration ? { textDecoration: decoration } : {}),
    padding: px(cs.paddingLeft),
    paddings: [px(cs.paddingTop), px(cs.paddingRight), px(cs.paddingBottom), px(cs.paddingLeft)],
    opacity: parseFloat(cs.opacity),
    fontFamily: cs.fontFamily,
    fontSize,
    fontWeight: parseInt(cs.fontWeight, 10) || 400,
    fontStyle: cs.fontStyle,
    letterSpacing: cs.letterSpacing === 'normal' ? 0 : px(cs.letterSpacing),
    lineHeight: cs.lineHeight === 'normal' ? fontSize * 1.2 : px(cs.lineHeight),
    textAlign: cs.textAlign,
    ...(none(cs.textShadow) ? { textShadow: cs.textShadow } : {}),
    ...(strokeW > 0 ? { webkitTextStroke: `${strokeW}px ${cs.getPropertyValue('-webkit-text-stroke-color')}` } : {}),
    backgroundClipText: clip.trim() === 'text',
    mixBlendMode: cs.mixBlendMode,
    ...(none(cs.clipPath) ? { clipPath: cs.clipPath } : {}),
    overflowHidden: cs.overflowX === 'hidden' || cs.overflowX === 'clip' || cs.overflowY === 'hidden' || cs.overflowY === 'clip',
    ...(Number.isFinite(z) ? { zIndex: z } : {}),
    ...(none(cs.translate) ? { translate: cs.translate } : {}),
    ...(none(cs.rotate) ? { rotate: cs.rotate } : {}),
    ...(none(cs.scale) ? { scale: cs.scale } : {}),
    transformOrigin: cs.transformOrigin,
  }
}

function boxOf(el: Element, host: HTMLElement, hostRect: DOMRect): MeasuredBox {
  if (el instanceof HTMLElement) {
    let x = 0
    let y = 0
    let cur: HTMLElement | null = el
    while (cur && cur !== host) {
      x += cur.offsetLeft
      y += cur.offsetTop
      cur = cur.offsetParent instanceof HTMLElement ? cur.offsetParent : null
    }
    return { x, y, width: el.offsetWidth, height: el.offsetHeight }
  }
  const r = el.getBoundingClientRect()
  return { x: r.left - hostRect.left, y: r.top - hostRect.top, width: r.width, height: r.height }
}

function linesOf(node: Text, hostRect: DOMRect, fontSize: number): MeasuredLine[] {
  const text = node.data
  const range = document.createRange()
  const lines: MeasuredLine[] = []
  let cur: { text: string; left: number; top: number; right: number; bottom: number } | null = null
  const tolerance = Math.max(2, fontSize * 0.4)
  for (let i = 0; i < text.length; i++) {
    range.setStart(node, i)
    range.setEnd(node, i + 1)
    const rects = range.getClientRects()
    if (rects.length === 0) continue
    const r = rects[0]
    if (cur && Math.abs(r.top - cur.top) > tolerance) {
      lines.push(finish(cur, hostRect))
      cur = null
    }
    if (!cur) cur = { text: '', left: r.left, top: r.top, right: r.right, bottom: r.bottom }
    cur.text += text[i]
    cur.left = Math.min(cur.left, r.left)
    cur.right = Math.max(cur.right, r.right)
    cur.top = Math.min(cur.top, r.top)
    cur.bottom = Math.max(cur.bottom, r.bottom)
  }
  if (cur) lines.push(finish(cur, hostRect))
  range.detach()
  return lines.filter((l) => l.text !== '')
}

function finish(l: { text: string; left: number; top: number; right: number; bottom: number }, hostRect: DOMRect): MeasuredLine {
  return {
    text: l.text.replace(/\s+/g, ' ').trim(),
    box: { x: l.left - hostRect.left, y: l.top - hostRect.top, width: l.right - l.left, height: l.bottom - l.top },
  }
}

export async function measureScene(src: SceneSource, opts: MeasureOptions): Promise<MeasuredScene> {
  const parsed = new DOMParser().parseFromString(`<!doctype html><body>${src.html}</body>`, 'text/html')
  sanitise(parsed.body)

  const sheet = [src.css, ...Array.from(parsed.querySelectorAll('style')).map((s) => s.textContent ?? '')].join('\n')
  for (const s of Array.from(parsed.querySelectorAll('style'))) s.remove()

  const host = document.createElement('div')
  host.setAttribute(HOST_ATTR, '')
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${opts.stage.width}px;height:${opts.stage.height}px;overflow:hidden;pointer-events:none;margin:0;padding:0;box-sizing:border-box`
  const style = document.createElement('style')
  style.textContent = scopeCss(mapBundledFontFamilies(sheet))
  host.append(style)
  for (const n of Array.from(parsed.body.childNodes)) host.append(document.importNode(n, true))
  mapInlineFonts(host)
  document.body.append(host)

  try {
    const rootEl = Array.from(host.children).find((c): c is HTMLElement => c instanceof HTMLElement && c !== (style as Element))
    if (!rootEl) throw new Error('The scene has no root element')

    await opts.fontsReady()

    const styles = new Map<Element, MeasuredStyle>()
    const collect = (el: Element): void => {
      const cs = getComputedStyle(el)
      if (cs.display === 'none') return
      const w = el instanceof HTMLElement ? el.offsetWidth : el.getBoundingClientRect().width
      const h = el instanceof HTMLElement ? el.offsetHeight : el.getBoundingClientRect().height
      styles.set(el, readStyle(el, w, h))
      if (el.localName !== 'svg') for (const c of Array.from(el.children)) collect(c)
    }
    collect(rootEl)

    const neutral = document.createElement('style')
    neutral.textContent = `[${HOST_ATTR}] * { translate:none !important; rotate:none !important; scale:none !important; transform:none !important; }`
    host.append(neutral)
    const hostRect = host.getBoundingClientRect()

    const build = (el: Element): MeasuredNode | null => {
      const st = styles.get(el)
      if (!st) return null
      const tag = el.localName
      const node: MeasuredNode = {
        tag,
        box: boxOf(el, host, hostRect),
        style: st,
        children: [],
        ...(el.id ? { id: el.id } : {}),
        ...(el.getAttribute('data-motion') ? { motion: el.getAttribute('data-motion') as string } : {}),
      }
      if (tag === 'svg') {
        node.svg = domToSvgNode(el)
        if (/currentcolor/i.test(el.outerHTML) && st.color) node.svg.attrs.color = st.color
        return node
      }
      if (el instanceof HTMLImageElement) {
        node.img = {
          src: el.getAttribute('src') ?? '',
          ...(el.complete && el.naturalWidth > 0 ? { naturalWidth: el.naturalWidth, naturalHeight: el.naturalHeight } : {}),
          objectFit: getComputedStyle(el).objectFit,
        }
        return node
      }
      const lines: MeasuredLine[] = []
      for (const c of Array.from(el.childNodes)) {
        if (c.nodeType === Node.TEXT_NODE && (c as Text).data.trim() !== '') lines.push(...linesOf(c as Text, hostRect, st.fontSize ?? 16))
      }
      if (lines.length > 0) node.text = { lines }
      for (const c of Array.from(el.children)) {
        const child = build(c)
        if (child) node.children.push(child)
      }
      return node
    }

    const root = build(rootEl)
    if (!root) throw new Error('The scene root is not displayed')

    const num = (name: string, fallback: number): number => {
      const n = parseFloat(rootEl.getAttribute(name) ?? '')
      return Number.isFinite(n) ? n : fallback
    }
    return {
      name: rootEl.getAttribute('data-scene') || 'scene',
      at: num('data-at', 0),
      duration: num('data-duration', 3),
      stage: { ...opts.stage },
      root,
    }
  } finally {
    host.remove()
  }
}
