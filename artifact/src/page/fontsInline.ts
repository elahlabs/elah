/**
 * Inline the bundled fonts a mounted page actually uses (PLAN-HTML-FIRST section 4, HF-2 step 1).
 *
 * The export rasteriser draws the page through an SVG `<img>`. `document.fonts` is invisible inside that
 * image, so every face the page needs is embedded in the SVG itself as a `data:` `@font-face`. Only the
 * (family, weight, style) faces the page resolves to are embedded, and each file is fetched and base64'd once
 * per session (`b64Cache`), so the per-frame cost is the string, not the network.
 */

import { FONT_REGISTRY, fontFaceFamily, fontFileUrl, type FontDef, type FontFile } from '@elah/core'

const REGISTRY_BY_FACE = new Map(FONT_REGISTRY.map((d) => [fontFaceFamily(d), d]))

/** Which faces a page needs: `elah-inter|900|normal`. */
export interface UsedFace {
  def: FontDef
  file: FontFile
}

const b64Cache = new Map<string, Promise<string>>()

/**
 * CSS font matching (Fonts 4, "font style / weight matching") against the files one family ships: style first
 * (italic falls back to normal), then weight with the 400/500 and lighter-first / heavier-first rules.
 */
export function matchFace(def: FontDef, weight: number, italic: boolean): FontFile {
  const wantStyle: FontFile['style'] = italic ? 'italic' : 'normal'
  let pool = def.files.filter((f) => f.style === wantStyle)
  if (pool.length === 0) pool = [...def.files]
  const weights = [...new Set(pool.map((f) => f.weight))].sort((a, b) => a - b)
  const exact = weights.find((w) => w === weight)
  let chosen = exact
  if (chosen === undefined) {
    const lighter = weights.filter((w) => w < weight).reverse()
    const heavier = weights.filter((w) => w > weight)
    if (weight >= 400 && weight <= 500) {
      const between = heavier.filter((w) => w <= 500)
      chosen = between[0] ?? lighter[0] ?? heavier[0]
    } else if (weight < 400) {
      chosen = lighter[0] ?? heavier[0]
    } else {
      chosen = heavier[0] ?? lighter[0]
    }
  }
  return pool.find((f) => f.weight === chosen) ?? pool[0]!
}

const hasOwnText = (el: Element): boolean => {
  for (const n of Array.from(el.childNodes)) if (n.nodeType === 3 && (n.nodeValue ?? '').trim() !== '') return true
  return false
}

/** Walk computed `font-family` / `font-weight` / `font-style` for every element that paints text. */
export function usedFaces(stageEl: HTMLElement): UsedFace[] {
  const found = new Map<string, UsedFace>()
  const note = (cs: CSSStyleDeclaration) => {
    const weight = Number.parseInt(cs.fontWeight, 10) || 400
    const italic = cs.fontStyle === 'italic' || cs.fontStyle.startsWith('oblique')
    for (const raw of cs.fontFamily.split(',')) {
      const name = raw.trim().replace(/^["']|["']$/g, '')
      const def = REGISTRY_BY_FACE.get(name)
      if (!def) continue
      const file = matchFace(def, weight, italic)
      found.set(`${def.id}|${file.file}`, { def, file })
    }
  }
  const els: Element[] = [stageEl, ...Array.from(stageEl.querySelectorAll('*'))]
  for (const el of els) {
    if (hasOwnText(el)) note(getComputedStyle(el))
    for (const pseudo of ['::before', '::after'] as const) {
      const cs = getComputedStyle(el, pseudo)
      if (cs.content && cs.content !== 'none' && cs.content !== 'normal') note(cs)
    }
  }
  return [...found.values()]
}

async function fetchBase64(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`font ${url} returned ${res.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(bin)
}

export interface InlinedFonts {
  /** The `@font-face` block (empty when the page uses no bundled font). */
  css: string
  /** `elah-inter 900 normal` per embedded face, for reports and probes. */
  faces: string[]
  /** Bytes of base64 in the block. */
  bytes: number
}

/** The `@font-face { font-family: "elah-<id>"; src: url(data:font/woff2;base64,...) }` block for a page. */
export async function inlineFonts(stageEl: HTMLElement, baseUrl: string): Promise<InlinedFonts> {
  const used = usedFaces(stageEl)
  const blocks: string[] = []
  const faces: string[] = []
  let bytes = 0
  for (const { def, file } of used) {
    const url = fontFileUrl(baseUrl, def, file)
    let p = b64Cache.get(url)
    if (!p) {
      p = fetchBase64(url)
      b64Cache.set(url, p)
      p.catch(() => b64Cache.delete(url))
    }
    const b64 = await p
    bytes += b64.length
    faces.push(`${fontFaceFamily(def)} ${file.weight} ${file.style}`)
    blocks.push(
      `@font-face{font-family:"${fontFaceFamily(def)}";font-weight:${file.weight};font-style:${file.style};` +
        `src:url(data:font/woff2;base64,${b64}) format("woff2");}`,
    )
  }
  return { css: blocks.join('\n'), faces, bytes }
}
