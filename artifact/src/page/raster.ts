/**
 * Frame rasteriser for the HTML page (PLAN-HTML-FIRST section 4, HF-2 step 2).
 *
 * One frame = seek the live page to `t`, bake what the browser computed at that moment into a static clone of
 * the stage, wrap the clone in `<svg><foreignObject>`, load it as a `data:` image and draw it on a canvas.
 *
 * Why the baking: an SVG `<img>` runs its own animation clock, so the markup of each frame must be static.
 * Every element that has an animation carries its current computed values (for exactly the properties the
 * animation keys, from `getKeyframes()`) as inline `!important` declarations; animated pseudo-elements get a
 * generated `[data-elah-bake="n"]::after { ... }` rule. The page CSS is shipped with `animation: none`.
 *
 * Constraints from the 2026-09-25 spike (Chromium): the SVG must load from a `data:` URL (`blob:` and
 * `createImageBitmap(img)` taint the canvas) and the fonts are embedded as `data:` `@font-face` because
 * `document.fonts` does not reach into the image.
 */

import type { PagePlayerHandle } from './types'

/** Thrown when this browser cannot draw the SVG image (decode failed or the canvas is tainted). */
export class PageExportUnsupported extends Error {
  constructor(detail: string) {
    super(`Exporting the programmatic video directly is not supported in this browser; press Edit to export with the native engine. (${detail})`)
    this.name = 'PageExportUnsupported'
  }
}

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export interface RasterTimings {
  frames: number
  /** seek + computed-style bake + serialise + encodeURIComponent */
  buildMs: number
  /** `img.decode()` of the data: SVG */
  decodeMs: number
  /** `drawImage` (+ background fill) */
  drawMs: number
}

export interface Rasterizer {
  readonly width: number
  readonly height: number
  readonly timings: RasterTimings
  /** Seek to `t` and paint the page onto `ctx` (full stage size). */
  rasterFrame(t: number, ctx: Ctx2D, nonce?: string): Promise<void>
  /** The SVG document string for `t` (debugging / probes). */
  svgFor(t: number): string
}

const NOT_PROPERTIES = new Set(['offset', 'easing', 'composite', 'computedOffset'])

/** `strokeDashoffset` -> `stroke-dashoffset`; `cssFloat` / `cssOffset` / `webkitBackdropFilter` handled. */
function cssName(key: string): string {
  if (key === 'cssFloat') return 'float'
  if (key === 'cssOffset') return 'offset'
  const k = key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
  return /^webkit-/.test(k) ? `-${k}` : k
}

/**
 * Inherited properties the live host passes to the page; the SVG document has no such host. mount.ts resets the host
 * with `:host { all: initial }`, so these read as plain-document defaults (16px, weight 400, line-height `normal`, ...)
 * and the wrapper carries the very same values, read from the host rather than hard-coded.
 */
const INHERITED = [
  'font-size', 'font-weight', 'font-style', 'font-variant', 'font-kerning', 'font-feature-settings', 'line-height',
  'letter-spacing', 'word-spacing', 'text-align', 'text-transform', 'text-indent', 'text-shadow', 'text-rendering',
  'white-space', 'direction', 'writing-mode', 'color', 'visibility',
]

/** Properties whose animation makes the live element a stacking context / backdrop root (see svgFor). */
const BACKDROP_ROOT_PROPS = ['opacity', 'filter', 'clip-path', 'mask', 'mix-blend-mode']

const xmlText =(s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/**
 * `line-height` resolves to pixels in computed style, but a unitless value inherits as a NUMBER, so each descendant
 * scales it by its own font size. With the host reset it is `normal` (returned as is, never a px value); the probe
 * with a 100px child only matters if something outside the shadow root still sets a line-height on the host.
 */
function inheritedLineHeight(stageEl: HTMLElement, hostLineHeight: string): string {
  if (hostLineHeight === 'normal') return 'normal'
  const probe = document.createElement('div')
  probe.style.cssText = 'font-size:100px;position:absolute;visibility:hidden;'
  stageEl.append(probe)
  const probed = Number.parseFloat(getComputedStyle(probe).lineHeight)
  probe.remove()
  const host = Number.parseFloat(hostLineHeight)
  if (!Number.isFinite(probed) || Math.abs(probed - host) < 0.5) return hostLineHeight // fixed length: inherits as is
  return String(Math.round((probed / 100) * 10000) / 10000) // unitless number
}

interface Bake {
  id: number
  live: Element
  clone: Element
  pseudo: string | null
  props: string[]
}

/** A hook to guarantee `animation: none` and no transitions inside the image, whatever the page wrote. */
const FREEZE_CSS = '*,*::before,*::after{animation:none !important;transition:none !important;}'

export function createRasterizer(player: PagePlayerHandle, opts: { fontCss: string }): Rasterizer {
  const { stageEl, root } = player
  const { width, height } = player.page.stage

  // Page CSS exactly as mounted (font families already mapped to elah-<id>); the host-only `:host` rule is inert here.
  const pageCss = Array.from(root.querySelectorAll('style')).map((s) => s.textContent ?? '').join('\n')
  const staticCss = `${opts.fontCss}\n${pageCss}\n${FREEZE_CSS}`

  // One persistent static clone; per frame only its inline styles and the pseudo rules change.
  const clone = stageEl.cloneNode(true) as HTMLElement
  const liveAll = [stageEl, ...Array.from(stageEl.querySelectorAll('*'))]
  const cloneAll = [clone, ...Array.from(clone.querySelectorAll('*'))]
  const indexOf = new Map<Element, number>(liveAll.map((el, i) => [el, i]))

  const groups = new Map<string, { live: Element; pseudo: string | null; props: Set<string> }>()
  for (const anim of player.animations()) {
    const effect = anim.effect as KeyframeEffect | null
    const target = effect?.target ?? null
    if (!effect || !target || !indexOf.has(target)) continue
    const pseudo = effect.pseudoElement ?? null
    const key = `${indexOf.get(target)}|${pseudo ?? ''}`
    let g = groups.get(key)
    if (!g) groups.set(key, (g = { live: target, pseudo, props: new Set() }))
    for (const kf of effect.getKeyframes()) {
      for (const k of Object.keys(kf)) if (!NOT_PROPERTIES.has(k)) g.props.add(cssName(k))
    }
  }
  const bakes: Bake[] = []
  for (const g of groups.values()) {
    const clon = cloneAll[indexOf.get(g.live)!]!
    const id = bakes.length
    if (g.pseudo) clon.setAttribute('data-elah-bake', String(id))
    bakes.push({ id, live: g.live, clone: clon, pseudo: g.pseudo, props: [...g.props] })
    const rootProps = BACKDROP_ROOT_PROPS.filter((p) => g.props.has(p))
    if (rootProps.length && !g.pseudo) (clon as HTMLElement).style.setProperty('will-change', rootProps.join(','), 'important')
  }

  // The wrapper that stands in for the shadow host: stage-sized, carries the inherited text properties.
  const hostCs = getComputedStyle(root.host)
  const inherited = INHERITED.map((p) => `${p}:${p === 'line-height' ? inheritedLineHeight(stageEl, hostCs.lineHeight) : hostCs.getPropertyValue(p)}`).join(';')
  const stageBg = getComputedStyle(stageEl).backgroundColor || '#000'

  const head =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<foreignObject x="0" y="0" width="${width}" height="${height}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="${attr(`position:relative;width:${width}px;height:${height}px;overflow:hidden;${inherited}`)}">` +
    `<style>${xmlText(staticCss)}</style>`
  const tail = '</div></foreignObject></svg>'
  const serializer = new XMLSerializer()

  const timings: RasterTimings = { frames: 0, buildMs: 0, decodeMs: 0, drawMs: 0 }

  const svgFor = (t: number): string => {
    player.seek(t)
    const pseudoRules: string[] = []
    for (const b of bakes) {
      const cs = getComputedStyle(b.live, b.pseudo ?? undefined)
      if (b.pseudo === null) {
        const style = (b.clone as HTMLElement).style
        for (const p of b.props) {
          const v = cs.getPropertyValue(p)
          if (v) style.setProperty(p, v, 'important')
        }
      } else {
        const decls = b.props
          .map((p) => ({ p, v: cs.getPropertyValue(p) }))
          .filter((d) => d.v)
          .map((d) => `${d.p}:${d.v} !important`)
          .join(';')
        pseudoRules.push(`[data-elah-bake="${b.id}"]${b.pseudo}{${decls}}`)
      }
    }
    return `${head}<style>${xmlText(pseudoRules.join('\n'))}</style>${serializer.serializeToString(clone)}${tail}`
  }

  const rasterFrame = async (t: number, ctx: Ctx2D, nonce?: string): Promise<void> => {
    const t0 = performance.now()
    // `nonce` (probes only) makes the URL unique so the browser's decoded-image cache cannot answer for us.
    const svg = nonce ? `${svgFor(t)}<!--${nonce.replace(/-/g, '')}-->` : svgFor(t)
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    const t1 = performance.now()
    const img = new Image()
    img.decoding = 'sync'
    img.src = url
    try {
      await img.decode()
    } catch (e) {
      throw new PageExportUnsupported(`image decode failed: ${e instanceof Error ? e.message : String(e)}`)
    }
    const t2 = performance.now()
    ctx.fillStyle = stageBg
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(img, 0, 0, width, height)
    const t3 = performance.now()
    timings.frames += 1
    timings.buildMs += t1 - t0
    timings.decodeMs += t2 - t1
    timings.drawMs += t3 - t2
  }

  return { width, height, timings, rasterFrame, svgFor }
}

/** Throws `PageExportUnsupported` if the canvas cannot be read back (tainted by the SVG image). */
export function assertReadable(ctx: Ctx2D): void {
  try {
    ctx.getImageData(0, 0, 1, 1)
  } catch (e) {
    throw new PageExportUnsupported(`canvas is tainted: ${e instanceof Error ? e.message : String(e)}`)
  }
}
