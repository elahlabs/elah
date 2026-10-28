/**
 * Supplied images in a programmatic video (TICKET-PF-11): a logo, product shots, screenshots.
 *
 * The person's files sit in `assets/` beside the input and are published beside `index.html`, so the page references
 * them as `assets/<name>` (or `./assets/<name>`) in `<img src>`, an SVG `<image href>` or a CSS `url()`. Preview loads
 * them relative to the page like any other file. Export cannot: the rasteriser draws each frame through an SVG image,
 * which loads nothing from outside itself, so every reference is swapped for a `data:` URL first (a `blob:` URL
 * would taint the canvas). Each file is fetched and encoded once per session (`dataCache`), the way fontsInline.ts
 * caches fonts. Edit turns an `<img>` into an image clip whose `src` is the same `data:` URL, so the project stays
 * whole when it is downloaded and the export worker never resolves a relative path.
 */

/** The only accepted shape: one file directly in assets/. Matches the plugin validator's ASSET_REF. */
export const ASSET_REF = /^(?:\.\/)?assets\/([A-Za-z0-9][A-Za-z0-9._-]*)$/

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

/** `assets/logo.png` or `./assets/logo.png` -> `logo.png`; anything else -> undefined. */
export function assetName(ref: string): string | undefined {
  const m = ASSET_REF.exec(ref.trim())
  return m && !m[1]!.includes('..') && MIME[extOf(m[1]!)] ? m[1] : undefined
}

const extOf = (name: string): string => (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase()

/** `url(...)` with an optional quote; group 2 is the target. */
const CSS_URL = /url\(\s*(['"]?)\s*([^)'"]*?)\s*\1\s*\)/gi

/** The asset names a CSS text references (unknown or network targets are not this module's business). */
export function assetNamesInCss(css: string, base?: string): string[] {
  const out: string[] = []
  for (const m of css.matchAll(CSS_URL)) {
    const name = nameOf(m[2]!, base)
    if (name) out.push(name)
  }
  return out
}

/** A relative `assets/<name>`, or (in computed style) the absolute URL it resolved to under `base`. */
function nameOf(target: string, base?: string): string | undefined {
  const direct = assetName(target)
  if (direct) return direct
  if (base && target.startsWith(base)) return assetName(`assets/${target.slice(base.length)}`)
  return undefined
}

const LINK_ATTRS = ['src', 'href', 'xlink:href'] as const

/** Every asset a mounted page uses: `<img src>`, SVG `<image href>`, `style=""` and the stylesheet. */
export function collectAssetNames(root: Element, css: string): Set<string> {
  const names = new Set<string>(assetNamesInCss(css))
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const a of LINK_ATTRS) {
      const v = el.getAttribute(a)
      const name = v ? assetName(v) : undefined
      if (name) names.add(name)
    }
    const style = el.getAttribute('style')
    if (style && /url\(/i.test(style)) for (const n of assetNamesInCss(style)) names.add(n)
  }
  return names
}

const dataCache = new Map<string, Promise<string>>()

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(blob)
  })
}

/** `data:<type>;base64,...` for `assets/<name>`, fetched once per session. The type comes from the extension. */
export function assetDataUrl(name: string, baseUrl: string): Promise<string> {
  const url = new URL(name, baseUrl).href
  let p = dataCache.get(url)
  if (!p) {
    p = (async () => {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`The image assets/${name} could not be loaded (HTTP ${res.status}). It must be published beside the page.`)
      const bytes = await res.arrayBuffer()
      return blobToDataUrl(new Blob([bytes], { type: MIME[extOf(name)] ?? 'application/octet-stream' }))
    })()
    dataCache.set(url, p)
    p.catch(() => dataCache.delete(url))
  }
  return p
}

export interface InlinedAssets {
  /** name -> data: URL */
  map: Map<string, string>
  /** Characters of data: URL across all images. */
  bytes: number
}

export async function loadAssets(names: Iterable<string>, baseUrl: string): Promise<InlinedAssets> {
  const map = new Map<string, string>()
  let bytes = 0
  for (const name of names) {
    const data = await assetDataUrl(name, baseUrl)
    map.set(name, data)
    bytes += data.length
  }
  return { map, bytes }
}

/** Replace every `url(assets/<name>)` (relative, or absolute under `base`) with its data: URL. */
export function replaceCssAssets(css: string, map: ReadonlyMap<string, string>, base?: string): string {
  if (map.size === 0 || !/url\(/i.test(css)) return css
  return css.replace(CSS_URL, (all, _q: string, target: string) => {
    const name = nameOf(target, base)
    const data = name ? map.get(name) : undefined
    return data ? `url("${data}")` : all
  })
}

/** Point the `<img src>`, `<image href>` and `style=""` references of a static clone at their data: URLs. */
export function inlineAssetsInTree(root: Element, map: ReadonlyMap<string, string>): void {
  if (map.size === 0) return
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const a of LINK_ATTRS) {
      const v = el.getAttribute(a)
      const name = v ? assetName(v) : undefined
      const data = name ? map.get(name) : undefined
      if (data) {
        if (a === 'xlink:href') el.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', data)
        else el.setAttribute(a, data)
      }
    }
    const style = el.getAttribute('style')
    if (style && /url\(/i.test(style)) el.setAttribute('style', replaceCssAssets(style, map))
  }
}

/** Make sure every image is decoded in this document, so a fresh `<img>` with the same URL is complete at once. */
export async function preloadAssets(names: Iterable<string>, baseUrl: string): Promise<void> {
  await Promise.all(
    [...names].map(async (name) => {
      const img = new Image()
      img.src = new URL(name, baseUrl).href
      try {
        await img.decode()
      } catch {
        /* a broken image is reported by the converter (no natural size) */
      }
    }),
  )
}
