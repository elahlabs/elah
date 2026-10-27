/**
 * Browser-side validation of a `source.kind: "page"` input (PLAN-HTML-FIRST H2): HTML + CSS only, real CSS
 * animations, no scripts, no network, only the 12 bundled font families. DOM-free string checks for the CSS
 * and a `DOMParser` pass for the markup (the parse is inert: nothing runs, nothing loads).
 *
 * Every refusal is an `Issue` (`where` + message) and ends with "Use instead: ..." so a person can paste the
 * list back to Claude.
 */

import { FONT_REGISTRY } from '@elah/core'
import type { Issue } from '../input'
import type { PageSource } from './types'
import { assetName } from './assetsInline'

// --- fonts (a local copy of the nearest-name logic in @elah/core/html, which does not export it) -----------

const GENERIC_FAMILY = new Set(['sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded'])
const CSS_WIDE = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer'])

const unquote = (s: string): string => s.trim().replace(/^["']|["']$/g, '').trim()

export function resolveBundledFont(name: string): string | undefined {
  const n = unquote(name).toLowerCase().replace(/^elah-/, '')
  for (const f of FONT_REGISTRY) if (f.id === n || f.family.toLowerCase() === n) return f.id
  return undefined
}

function nearestBundledFamily(name: string): string {
  const n = unquote(name).toLowerCase()
  const family = (id: string) => FONT_REGISTRY.find((f) => f.id === id)!.family
  if (/mono|code|courier|consolas/.test(n)) return family('roboto-mono')
  if (/script|hand|brush|marker/.test(n)) return family('caveat')
  if (/serif|times|georgia|garamond|playfair|merriweather/.test(n) && !/sans/.test(n)) return family('playfair-display')
  if (/impact|condensed|display|black|heavy|bebas|anton/.test(n)) return family('bebas-neue')
  return family('inter')
}

export const BUNDLED_FAMILIES = FONT_REGISTRY.map((f) => f.family)

// --- helpers ---------------------------------------------------------------------------------------------

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

function describe(el: Element): string {
  const id = el.id ? `#${el.id}` : ''
  const cls = el.getAttribute('class')?.trim().split(/\s+/).slice(0, 2).map((c) => `.${c}`).join('') ?? ''
  return `<${el.localName}${id}${cls}>`
}

const snippet = (s: string, n = 70): string => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, n)}...` : one
}

const refusal = (where: string, message: string, substitute: string): Issue => ({
  severity: 'error',
  where,
  message: `${message} Use instead: ${substitute}`,
})

const FORBIDDEN_TAGS: Record<string, string> = {
  script: 'Remove it. A programmatic video has no scripts; all motion comes from @keyframes in the css.',
  iframe: 'Draw the content with HTML and inline SVG inside the video.',
  object: 'Draw the content with HTML and inline SVG inside the video.',
  embed: 'Draw the content with HTML and inline SVG inside the video.',
  video: 'A programmatic video has no media elements. Build the visual from HTML, CSS gradients and inline SVG.',
  audio: 'A programmatic video has no audio in this version. Remove it.',
  style: 'Move the rules into the separate css field of the input; the markup carries no <style>.',
  link: 'Put the rules in the css field. Bundled fonts are used by naming the family in font-family.',
  base: 'Remove it. A programmatic video has no network and no base URL.',
}

const URL_ATTRS = ['src', 'href', 'xlink:href', 'poster', 'srcset', 'action', 'formaction']
/** The attributes that may name a supplied image as assets/<name>. */
const LINK_ATTRS = new Set(['src', 'href', 'xlink:href'])

// --- css -------------------------------------------------------------------------------------------------

export function checkCss(cssIn: string, where: string): Issue[] {
  const css = stripComments(cssIn)
  const out: Issue[] = []

  if (/@import\b/i.test(css)) {
    out.push(refusal(`${where}: @import`, '@import loads from the network.', 'put all rules in this one stylesheet; name a bundled family in font-family.'))
  }
  if (/@font-face\b/i.test(css)) {
    out.push(refusal(`${where}: @font-face`, 'Custom fonts are not allowed.', `font-family with one of the bundled families: ${BUNDLED_FAMILIES.join(', ')}.`))
  }
  if (/(^|[;{}\s])transition(-(property|duration|delay|timing-function|behavior))?\s*:/i.test(css)) {
    out.push(refusal(`${where}: transition`, 'Nothing can trigger a transition in a video.', '@keyframes with an explicit animation duration and animation-delay in seconds.'))
  }
  if (/animation-play-state\s*:/i.test(css)) {
    out.push(refusal(`${where}: animation-play-state`, 'The player pauses and seeks every animation itself.', 'remove it; give each animation a duration and delay.'))
  }
  for (const m of css.matchAll(/(^|[;{}\s])animation\s*:\s*([^;}]+)/gi)) {
    if (/\b(paused|running)\b/i.test(m[2])) {
      out.push(refusal(`${where}: animation ${snippet(m[2], 40)}`, 'The animation shorthand carries a play-state keyword.', 'remove "paused" / "running"; the player controls play state.'))
    }
  }
  const seenUrls = new Set<string>()
  for (const m of css.matchAll(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi)) {
    const target = m[2].trim()
    if (/^data:/i.test(target) || target.startsWith('#') || assetName(target)) continue // assets/<name>: a supplied image
    if (seenUrls.has(target)) continue
    seenUrls.add(target)
    out.push(refusal(`${where}: url(${snippet(target, 50)})`, 'Network references are not allowed (nothing is fetched).', 'a gradient, an inline SVG element, url(data:...), a fragment url(#id), or url(assets/<name>) for an image the person supplied.'))
  }
  if (/expression\s*\(|-moz-binding|behavior\s*:/i.test(css)) {
    out.push(refusal(`${where}: script-like css`, 'expression(), behavior and -moz-binding are refused.', 'plain declarations.'))
  }
  out.push(...checkFontFamilies(css, where))
  return out
}

function checkFontFamilies(css: string, where: string): Issue[] {
  const out: Issue[] = []
  const seen = new Set<string>()
  for (const m of css.matchAll(/font-family\s*:\s*([^;}]+)/gi)) out.push(...checkFamilyList(m[1], where, seen))
  for (const m of css.matchAll(FONT_SHORTHAND)) out.push(...checkFamilyList(m[2], where, seen))
  return out
}

/** `font: <weight> <size>[/<line-height>] <family list>`: group 2 is the family list. */
export const FONT_SHORTHAND = /(?<![-\w])(font\s*:\s*[^;}]*?\d(?:\.\d+)?(?:px|pt|em|rem|%|vw|vh|vmin|vmax)(?:\s*\/\s*[^\s;}]+)?\s+)([^;}]+)/gi

function checkFamilyList(list: string, where: string, seen: Set<string>): Issue[] {
  const out: Issue[] = []
  for (const raw of list.split(',')) {
    const fam = unquote(raw.replace(/!important/i, ''))
    if (!fam || /^var\(/i.test(fam) || CSS_WIDE.has(fam.toLowerCase()) || GENERIC_FAMILY.has(fam.toLowerCase())) continue
    if (resolveBundledFont(fam)) continue
    if (seen.has(fam.toLowerCase())) continue
    seen.add(fam.toLowerCase())
    out.push(
      refusal(
        `${where}: font-family "${fam}"`,
        `"${fam}" is not one of the bundled fonts.`,
        `"${nearestBundledFamily(fam)}" (bundled: ${BUNDLED_FAMILIES.join(', ')}).`,
      ),
    )
  }
  return out
}

// --- markup ----------------------------------------------------------------------------------------------

export function checkHtml(html: string): Issue[] {
  const out: Issue[] = []
  const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html')
  const all = Array.from(doc.body.querySelectorAll('*'))

  const tagSeen = new Set<string>()
  for (const el of all) {
    const tag = el.localName
    if (FORBIDDEN_TAGS[tag] && !tagSeen.has(tag)) {
      tagSeen.add(tag)
      const count = all.filter((e) => e.localName === tag).length
      out.push(refusal(`<${tag}>${count > 1 ? ` (x${count})` : ''}`, `<${tag}> is not allowed in a programmatic video.`, FORBIDDEN_TAGS[tag]))
    }
    for (const a of Array.from(el.attributes)) {
      const name = a.name.toLowerCase()
      if (name.startsWith('on')) {
        out.push(refusal(`${describe(el)} ${a.name}=`, 'Event-handler attributes are not allowed.', 'remove the attribute; nothing can be clicked in a video.'))
      } else if (URL_ATTRS.includes(name) && !/^(data:|#)/i.test(a.value.trim()) && a.value.trim() !== '' && el.localName !== 'script') {
        if (el.localName === 'link') continue // already refused as a tag
        if (LINK_ATTRS.has(name) && assetName(a.value)) continue // assets/<name>: a supplied image, published beside the page
        out.push(refusal(`${describe(el)} ${a.name}="${snippet(a.value, 40)}"`, 'Network references are not allowed (nothing is fetched).', 'inline SVG, a gradient, a data: URI, or src="assets/<name>" for an image the person supplied.'))
      } else if (name === 'style') {
        out.push(...checkCss(`x{${a.value}}`, `${describe(el)} style=`))
      } else if (name === 'font-family') {
        out.push(...checkFamilyList(a.value, `${describe(el)} font-family=`, new Set()))
      }
    }
  }
  return dedupe(out)
}

function dedupe(issues: Issue[]): Issue[] {
  const seen = new Set<string>()
  return issues.filter((i) => {
    const k = `${i.where}|${i.message}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

// --- the whole page --------------------------------------------------------------------------------------

export interface PageVerdict {
  page?: PageSource
  issues: Issue[]
}

const isPosNum = (n: unknown, max: number): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= max

/**
 * Validate and default a raw `source` of kind `page`. `page` is set only when there is no error-severity issue.
 */
export function validatePage(src: {
  html?: unknown
  css?: unknown
  durationSeconds?: unknown
  stage?: unknown
  fps?: unknown
}): PageVerdict {
  const issues: Issue[] = []
  const bad = (where: string, message: string, substitute: string) => issues.push(refusal(where, message, substitute))

  if (typeof src.html !== 'string' || src.html.trim() === '') bad('source.html', 'source.html must be a non-empty string.', 'the video markup, e.g. "<main data-scene=\\"intro\\">...</main>".')
  if (src.css !== undefined && typeof src.css !== 'string') bad('source.css', 'source.css must be a string.', 'the video stylesheet as one string.')
  if (!isPosNum(src.durationSeconds, 600)) bad('source.durationSeconds', 'durationSeconds must be a number of seconds, greater than 0 and at most 600.', 'e.g. "durationSeconds": 14.')

  const rawStage = src.stage as { width?: unknown; height?: unknown } | undefined
  let stage = { width: 1920, height: 1080 }
  if (rawStage !== undefined) {
    if (isPosNum(rawStage?.width, 7680) && isPosNum(rawStage?.height, 7680) && rawStage.width >= 64 && rawStage.height >= 64) {
      stage = { width: Math.round(rawStage.width), height: Math.round(rawStage.height) }
    } else {
      bad('source.stage', 'stage must be { width, height } in pixels (64 to 7680).', '"stage": { "width": 1920, "height": 1080 }.')
    }
  }
  let fps = 30
  if (src.fps !== undefined) {
    if (isPosNum(src.fps, 120)) fps = Math.round(src.fps)
    else bad('source.fps', 'fps must be a number from 1 to 120.', '"fps": 30.')
  }

  const html = typeof src.html === 'string' ? src.html : ''
  const css = typeof src.css === 'string' ? src.css : ''
  if (html) issues.push(...checkHtml(html))
  if (css) issues.push(...checkCss(css, 'css'))

  if (!/@keyframes\b/i.test(css)) {
    issues.push({ severity: 'warn', where: 'css', message: 'No @keyframes found: the video will be a still image. Motion comes from @keyframes with an explicit duration and delay.' })
  }
  if (/(^|[}\s,])(:root|html|body)(?![\w-])\s*[{,]/.test(stripComments(css))) {
    issues.push({ severity: 'warn', where: 'css: :root / html / body', message: 'These selectors do not match inside the video (they are re-pointed at the stage element here, but nowhere else). Put colours and fonts on the root <main class="stage"> element instead.' })
  }
  if (html && !/data-scene\s*=/.test(html)) {
    issues.push({ severity: 'info', where: 'html', message: 'No [data-scene] elements: the player shows no scene bars. Name each scene with data-scene="name" on sibling elements.' })
  }

  const errors = issues.some((i) => i.severity === 'error')
  if (errors) return { issues }
  return {
    page: { kind: 'page', html, css, durationSeconds: src.durationSeconds as number, stage, fps },
    issues,
  }
}
