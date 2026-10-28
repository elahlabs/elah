/**
 * Mount a page into a stage-sized shadow root (PLAN-HTML-FIRST section 4). The page keeps real CSS: its
 * `@keyframes` run in the browser's own animation engine and `seek.ts` drives them.
 *
 * The shadow root isolates the page from the artifact chrome (and the other way round). Rules written for the
 * document (`:root`, `html`, `body`) are re-pointed at the stage element, and bundled font families are
 * rewritten to their registered `elah-<id>` faces (the faces are loaded into `document.fonts` beforehand by
 * `loadAllFonts`; the FontFaceSet is shared with shadow trees).
 */

import { mapBundledFontFamilies } from '../measure'
import type { PageSource } from './types'
import { FONT_SHORTHAND, resolveBundledFont } from './validate'

export interface MountedPage {
  root: ShadowRoot
  stageEl: HTMLElement
  stage: { width: number; height: number }
  dispose: () => void
}

/** Point `:root`, `html` and `body` selectors at the stage element. Only selector text is touched. */
export function scopeRootSelectors(css: string, stageClass = 'elah-stage'): string {
  return css.replace(/([^{};@]+)\{/g, (all, selector: string) => {
    const next = selector.replace(/(^|[\s,>+~(])(?::root|html|body)(?![\w-])/g, (_m, lead: string) => `${lead}.${stageClass}`)
    return next === selector ? all : `${next}{`
  })
}

/** `font: 700 22px "Roboto Mono"` -> the family list becomes the registered `elah-<id>` face (the longhand mapper skips it). */
function mapFontShorthand(css: string): string {
  return css.replace(FONT_SHORTHAND, (all, head: string, families: string) => {
    const first = families.split(',')[0].trim()
    const id = resolveBundledFont(first)
    return id ? `${head}"elah-${id}", sans-serif` : all
  })
}

const prepareCss = (css: string): string => scopeRootSelectors(mapFontShorthand(mapBundledFontFamilies(css)))

/** Defence in depth: validate.ts already refused these; never let one reach the live DOM. */
function sanitise(root: ParentNode): void {
  for (const s of Array.from(root.querySelectorAll('script, iframe, object, embed, link, base, video, audio'))) s.remove()
  for (const el of Array.from(root.querySelectorAll('*'))) {
    for (const a of Array.from(el.attributes)) {
      if (a.name.toLowerCase().startsWith('on')) el.removeAttribute(a.name)
    }
  }
}

function mapInlineFonts(root: ParentNode): void {
  for (const el of Array.from(root.querySelectorAll('[style]'))) {
    const v = el.getAttribute('style') ?? ''
    if (/font/i.test(v)) el.setAttribute('style', mapFontShorthand(mapBundledFontFamilies(v)))
  }
  for (const el of Array.from(root.querySelectorAll('[font-family]'))) {
    const v = el.getAttribute('font-family') ?? ''
    el.setAttribute('font-family', mapBundledFontFamilies(`font-family:${v}`).replace(/^font-family:/, ''))
  }
  for (const st of Array.from(root.querySelectorAll('style'))) st.textContent = prepareCss(st.textContent ?? '')
}

export function mountPage(host: HTMLElement, src: PageSource): MountedPage {
  const { width, height } = src.stage
  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
  root.replaceChildren()

  const base = document.createElement('style')
  base.textContent = [
    // `all: initial` cuts the inheritance from the artifact app's `body` (line-height 1.5, 14px, ...): the page starts
    // from plain-document text defaults, like the HTML it was authored against. raster.ts and measure.ts mirror it.
    ':host { all: initial; display: block; contain: layout paint; }',
    '*, *::before, *::after { box-sizing: border-box; }',
    `.elah-stage { position: relative; overflow: hidden; width: ${width}px; height: ${height}px; background: #000; color: #fff; font-family: "elah-inter", sans-serif; }`,
  ].join('\n')

  const style = document.createElement('style')
  style.textContent = prepareCss(src.css)

  const stageEl = document.createElement('div')
  stageEl.className = 'elah-stage'
  stageEl.setAttribute('data-elah-stage', '')

  const tpl = document.createElement('template')
  tpl.innerHTML = src.html // inert until adopted; scripts in a parsed template never run
  sanitise(tpl.content)
  mapInlineFonts(tpl.content)
  stageEl.append(tpl.content)

  root.append(base, style, stageEl)
  return {
    root,
    stageEl,
    stage: { width, height },
    dispose: () => root.replaceChildren(),
  }
}
