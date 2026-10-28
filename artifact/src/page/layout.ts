/**
 * Layout report for a programmatic video (HF-7). The Node validator cannot lay anything out, so the artifact does
 * it once, right after the video is mounted: for each `[data-scene]` it seeks to the middle of the scene's hold and
 * measures the text the browser actually drew there.
 *
 *   (a) two text boxes that intersect by more than 4 px in both axes (unless one contains the other)
 *   (b) a text box that crosses the 6% safe margin of the stage
 *
 * Every finding is a `warn` Issue that goes to the existing Issues panel (and its Copy button, so a person can
 * paste it back to Claude). It never blocks preview, Edit or export.
 *
 * Boxes are in the stage's own pixel coordinates: the fit transform of the player is undone by dividing by the
 * stage element's on-screen size, so the numbers do not depend on the window. A text box is the union of the
 * client rects of the element's own text (not the element box, which is as wide as its container), with the height
 * trimmed to about 0.85 em (70% of the browser's roughly 1.2 em content area, where capitals and x-height text sit): the full content area would make tightly leaded stacked lines look like they collide.
 */

import type { Issue } from '../input'
import { seekAnimations } from './seek'
import type { SceneWindow } from './types'

const OVERLAP_PX = 4
const SAFE_FRACTION = 0.06
const MIN_OPACITY = 0.5
/** Fraction of the browser's text rect height kept (the em box inside the roughly 1.2 em content area). */
const EM_BOX = 0.7
const EDGE_TOLERANCE_PX = 1

interface Box {
  l: number
  t: number
  r: number
  b: number
}

interface TextEl {
  el: Element
  label: string
  boxes: Box[]
}

export interface LayoutReport {
  issues: Issue[]
  ms: number
  /** The time each scene was measured at, in scene order (seconds). */
  times: number[]
}

function describe(el: Element): string {
  const cls = Array.from(el.classList).slice(0, 3).map((c) => `.${c}`).join('')
  return `${el.localName}${el.id ? `#${el.id}` : ''}${cls}`
}

function snippet(el: Element, n = 28): string {
  const own = Array.from(el.childNodes)
    .filter((c): c is Text => c.nodeType === Node.TEXT_NODE)
    .map((c) => c.data)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return own.length > n ? `${own.slice(0, n - 1)}...` : own
}

const labelOf = (el: Element): string => `${describe(el)} "${snippet(el)}"`

const fmt = (n: number): string => (Math.round(n * 100) / 100).toString()

/**
 * Where an animation's opacity is fully up: the offset (0..1 of one iteration) at which it has arrived and the
 * offset at which it starts to leave. `undefined` when it has no opacity keyframes, `rise` 0 when it starts up and
 * `fall` 1 when it never leaves.
 */
function opacityShape(effect: KeyframeEffect): { rise: number; fall: number } | undefined {
  const pts: Array<{ o: number; v: number }> = []
  for (const k of effect.getKeyframes()) {
    const raw = (k as unknown as Record<string, unknown>).opacity
    if (raw === undefined || raw === null) continue
    const v = parseFloat(String(raw))
    if (!Number.isFinite(v)) continue
    const o = typeof k.computedOffset === 'number' ? k.computedOffset : Number(k.offset ?? 0)
    pts.push({ o, v })
  }
  if (pts.length === 0) return undefined
  // An implicit `from` / `to` keyframe is the element's own opacity, which is 1 unless the page says otherwise.
  if (pts[0]!.o > 0) pts.unshift({ o: 0, v: 1 })
  if (pts[pts.length - 1]!.o < 1) pts.push({ o: 1, v: 1 })
  const top = Math.max(...pts.map((p) => p.v))
  if (top <= 0) return undefined
  const up = pts.filter((p) => p.v >= top - 0.01)
  const rise = pts[0]!.v >= top - 0.01 ? 0 : up[0]!.o
  const fall = pts[pts.length - 1]!.v <= top * 0.5 ? up[up.length - 1]!.o : 1
  return { rise, fall }
}

/**
 * The moment the scene is at rest: after its finite arrivals have finished and before its exits start. An arrival
 * ends where its opacity is fully up (or where the animation ends when it has no opacity keyframes); an exit is a
 * fade to nothing that starts once everything else has arrived (a fade in the middle of the scene, such as a digit
 * swap, is not an exit). A scene with no exit is held until the next scene starts, or the end of the video. When
 * the gap is empty the middle of the scene's window is used.
 */
export function holdTime(sceneEl: Element, anims: readonly Animation[], durationSeconds: number, nextStartSeconds?: number): number {
  let start = Infinity
  let end = -Infinity
  let arrivalsEnd = -Infinity
  const exits: number[] = []
  for (const a of anims) {
    const effect = a.effect as KeyframeEffect | null
    const target = effect?.target
    if (!effect || !target || !sceneEl.contains(target)) continue
    const t = effect.getComputedTiming()
    const endTime = typeof t.endTime === 'number' ? t.endTime : Number(t.endTime)
    if (!Number.isFinite(endTime)) continue
    const delay = Math.max(0, Number(t.delay ?? 0))
    start = Math.min(start, delay)
    end = Math.max(end, endTime)
    const dur = Number(t.duration ?? 0)
    const single = Number(t.iterations ?? 1) === 1 && (t.direction ?? 'normal') === 'normal' && dur > 0
    const shape = single ? opacityShape(effect) : undefined
    if (shape) {
      const origin = Number(t.delay ?? 0)
      if (shape.rise > 0) arrivalsEnd = Math.max(arrivalsEnd, origin + shape.rise * dur)
      if (shape.fall < 1) exits.push(origin + shape.fall * dur)
    } else {
      arrivalsEnd = Math.max(arrivalsEnd, endTime)
    }
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return durationSeconds / 2
  const lo = Number.isFinite(arrivalsEnd) ? arrivalsEnd : start
  const later = exits.filter((x) => x >= lo - 1e-6)
  const fallback = nextStartSeconds !== undefined && nextStartSeconds * 1000 > lo ? nextStartSeconds * 1000 : durationSeconds * 1000
  const hi = later.length > 0 ? Math.min(...later) : fallback
  const midMs = lo < hi ? (lo + hi) / 2 : (start + end) / 2
  return Math.min(durationSeconds, Math.max(0, midMs / 1000))
}

/** Own-text elements that are visible enough to count, with their boxes in stage px. */
function collectText(stageEl: HTMLElement, origin: DOMRect, sx: number, sy: number): TextEl[] {
  const out: TextEl[] = []
  const range = document.createRange()
  const opacityCache = new Map<Element, number>()
  const effectiveOpacity = (el: Element | null): number => {
    if (!el || el === stageEl.parentNode) return 1
    const hit = opacityCache.get(el)
    if (hit !== undefined) return hit
    const own = parseFloat(getComputedStyle(el).opacity)
    const v = (Number.isFinite(own) ? own : 1) * (el === stageEl ? 1 : effectiveOpacity(el.parentElement))
    opacityCache.set(el, v)
    return v
  }
  for (const el of Array.from(stageEl.querySelectorAll('*'))) {
    const tag = el.localName
    if (tag === 'style' || tag === 'script' || tag === 'title' || tag === 'desc') continue
    const texts = Array.from(el.childNodes).filter((c): c is Text => c.nodeType === Node.TEXT_NODE && ((c as Text).data ?? '').trim() !== '')
    if (texts.length === 0) continue
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') continue
    if (effectiveOpacity(el) < MIN_OPACITY) continue
    const boxes: Box[] = []
    for (const node of texts) {
      range.selectNodeContents(node)
      for (const r of Array.from(range.getClientRects())) {
        if (r.width <= 0 || r.height <= 0) continue
        const cy = (r.top + r.bottom) / 2
        const half = (r.height * EM_BOX) / 2
        boxes.push({
          l: (r.left - origin.left) / sx,
          r: (r.right - origin.left) / sx,
          t: (cy - half - origin.top) / sy,
          b: (cy + half - origin.top) / sy,
        })
      }
    }
    if (boxes.length > 0) out.push({ el, label: labelOf(el), boxes })
  }
  range.detach()
  return out
}

const contains = (a: Box, b: Box): boolean =>
  a.l <= b.l + EDGE_TOLERANCE_PX && a.r >= b.r - EDGE_TOLERANCE_PX && a.t <= b.t + EDGE_TOLERANCE_PX && a.b >= b.b - EDGE_TOLERANCE_PX

function overlap(a: Box, b: Box): { w: number; h: number } | null {
  const w = Math.min(a.r, b.r) - Math.max(a.l, b.l)
  const h = Math.min(a.b, b.b) - Math.max(a.t, b.t)
  if (w <= OVERLAP_PX || h <= OVERLAP_PX) return null
  if (contains(a, b) || contains(b, a)) return null
  return { w, h }
}

/**
 * Measure every scene of the mounted video. Leaves the animations wherever the last measure put them: the caller
 * seeks back to where the player was.
 */
export function layoutReport(
  stageEl: HTMLElement,
  anims: readonly Animation[],
  scenes: readonly SceneWindow[],
  stage: { width: number; height: number },
  durationSeconds: number,
): LayoutReport {
  const started = performance.now()
  const issues: Issue[] = []
  const times: number[] = []
  const sceneEls = Array.from(stageEl.querySelectorAll<HTMLElement>('[data-scene]'))
  const seen = new Set<string>()
  const push = (scene: string, at: number, what: string, key: string, message: string) => {
    if (seen.has(key)) return
    seen.add(key)
    issues.push({ severity: 'warn', where: `scene "${scene}" at ${fmt(at)}s: ${what}`, message })
  }
  const mx = stage.width * SAFE_FRACTION
  const my = stage.height * SAFE_FRACTION

  sceneEls.forEach((sceneEl, i) => {
    const name = scenes[i]?.name ?? (sceneEl.getAttribute('data-scene')?.trim() || sceneEl.id || `Scene ${i + 1}`)
    const mine = scenes[i]
    const following = mine ? scenes.filter((s) => s.start > mine.start + 1e-6).map((s) => s.start) : []
    const t = holdTime(sceneEl, anims, durationSeconds, following.length > 0 ? Math.min(...following) : undefined)
    times.push(t)
    seekAnimations(anims, t)
    const origin = stageEl.getBoundingClientRect()
    const sx = origin.width / stage.width
    const sy = origin.height / stage.height
    if (!(sx > 0) || !(sy > 0)) return
    const texts = collectText(stageEl, origin, sx, sy)

    for (let a = 0; a < texts.length; a++) {
      for (let b = a + 1; b < texts.length; b++) {
        let worst: { w: number; h: number } | null = null
        for (const ba of texts[a]!.boxes) {
          for (const bb of texts[b]!.boxes) {
            const o = overlap(ba, bb)
            if (o && (!worst || o.w * o.h > worst.w * worst.h)) worst = o
          }
        }
        if (worst) {
          push(
            name,
            t,
            `${texts[a]!.label} overlaps ${texts[b]!.label}`,
            `o|${texts[a]!.label}|${texts[b]!.label}`,
            `The two text boxes overlap by ${Math.round(worst.w)} x ${Math.round(worst.h)} px. Move one of them, shorten the text, or make them appear at different times.`,
          )
        }
      }
    }

    for (const te of texts) {
      let left = 0
      let right = 0
      let top = 0
      let bottom = 0
      for (const bx of te.boxes) {
        left = Math.max(left, mx - bx.l)
        right = Math.max(right, bx.r - (stage.width - mx))
        top = Math.max(top, my - bx.t)
        bottom = Math.max(bottom, bx.b - (stage.height - my))
      }
      const sides: string[] = []
      if (left > EDGE_TOLERANCE_PX) sides.push(`left by ${Math.round(left)} px`)
      if (right > EDGE_TOLERANCE_PX) sides.push(`right by ${Math.round(right)} px`)
      if (top > EDGE_TOLERANCE_PX) sides.push(`top by ${Math.round(top)} px`)
      if (bottom > EDGE_TOLERANCE_PX) sides.push(`bottom by ${Math.round(bottom)} px`)
      if (sides.length > 0) {
        push(
          name,
          t,
          te.label,
          `m|${te.label}`,
          `The text crosses the 6% safe margin of the stage (${sides.join(', ')}). Move it inward or make it smaller so it stays inside the margin.`,
        )
      }
    }
  })

  return { issues, ms: performance.now() - started, times }
}
