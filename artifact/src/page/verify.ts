/**
 * Independent check of a conversion: HTML versus native, numerically (HF-3).
 *
 * A hidden copy of the page is mounted and seeked to each time; for every converted node the browser's own
 * answer (the transform-origin point after the whole ancestor chain of translate / rotate / scale / transform,
 * the rotation, the scale and the product of the opacities) is compared with what the ENGINE resolves for the
 * same instant (`resolveTimeline`, composed through the compound chain). Nothing here shares code with the key
 * builder, so a wrong rest layout, a wrong nesting push-down or a bad key shows up as a number.
 *
 * Browser probe only: `window.__elahConvert.verify([1.2, 3, 5.4, 8.8, 12.5])`.
 */

import { resolveTimeline, type Project } from '@elah/core'
import { aboutOrigin, decompose, mul, readComposite, type Aff } from './pose'
import { mountPage } from './mount'
import { collectAnimations, seekAnimations } from './seek'
import type { PageSource } from './types'

export interface VerifyNode {
  key: string
  name: string
  /** Index of the element in document order (root = 0). */
  index: number
  /** The node's own transform-origin point (a split text leaf has its own, inside the element's box). */
  origin: { x: number; y: number }
  /** An imported SVG: its clip scale carries the viewBox-to-box factor, so scale is not compared. */
  svg?: boolean
}

export interface VerifyInput {
  page: PageSource
  project: Project
  nodes: VerifyNode[]
  /** Absolute origin point of every element, by document-order index. */
  origins: Record<number, { x: number; y: number }>
}

export interface VerifyRow {
  name: string
  /** Pixels between the DOM origin point and the native anchor. */
  pos: number
  /** Radians. */
  rot: number
  opacity: number
  /** |ratio - 1| of the accumulated scale (text and compounds only). */
  scale: number | null
}

export interface VerifyTime {
  t: number
  frame: number
  compared: number
  maxPos: number
  meanPos: number
  maxRot: number
  maxOpacity: number
  maxScale: number
  worst: VerifyRow[]
  worstScale: VerifyRow[]
}

interface Native {
  pos: { x: number; y: number }
  rot: number
  scale: number
  opacity: number
  type: string
}

type SceneLike = {
  stage: { width: number; height: number }
  texts?: AnyActive[]
  shapes?: AnyActive[]
  images?: AnyActive[]
  compounds?: Array<AnyActive & { scene: SceneLike; contentSize: { width: number; height: number } }>
}
type AnyActive = {
  name: string
  opacity: number
  transform?: { x: number; y: number; scale: number; rotation: number; anchor: { x: number; y: number }; scaleX?: number; scaleY?: number }
}

function nativeAt(project: Project, frame: number): Map<string, Native> {
  const out = new Map<string, Native>()
  const scene = resolveTimeline(frame, project) as unknown as SceneLike
  const visit = (s: SceneLike, map: (p: { x: number; y: number }) => { x: number; y: number }, rot: number, scale: number, opacity: number): void => {
    const pw = s.stage.width
    const ph = s.stage.height
    const all: Array<[string, AnyActive]> = []
    for (const c of s.texts ?? []) all.push(['text', c])
    for (const c of s.shapes ?? []) all.push(['shape', c])
    for (const c of s.images ?? []) all.push(['image', c])
    for (const c of s.compounds ?? []) all.push(['compound', c])
    for (const [type, c] of all) {
      const t = c.transform
      if (!t) continue
      const sx = t.scale * (t.scaleX ?? 1)
      const sy = t.scale * (t.scaleY ?? 1)
      out.set(c.name, {
        pos: map({ x: t.x * pw, y: t.y * ph }),
        rot: rot + t.rotation,
        scale: scale * sx,
        opacity: opacity * c.opacity,
        type,
      })
      if (type === 'compound') {
        const comp = c as AnyActive & { scene: SceneLike; contentSize: { width: number; height: number } }
        const cw = comp.contentSize.width
        const ch = comp.contentSize.height
        const cos = Math.cos(t.rotation)
        const sin = Math.sin(t.rotation)
        const inner = (p: { x: number; y: number }): { x: number; y: number } => {
          const dx = (p.x - t.anchor.x * cw) * sx
          const dy = (p.y - t.anchor.y * ch) * sy
          return map({ x: t.x * pw + cos * dx - sin * dy, y: t.y * ph + sin * dx + cos * dy })
        }
        visit(comp.scene, inner, rot + t.rotation, scale * sx, opacity * c.opacity)
      }
    }
  }
  visit(scene, (p) => p, 0, 1, 1)
  return out
}

const wrap = (a: number): number => {
  const t = 2 * Math.PI
  return Math.abs(((a + Math.PI) % t + t) % t - Math.PI)
}

/** Compare HTML and native at each time (seconds). Mounts and removes a hidden copy of the page. */
export async function verifyConversion(input: VerifyInput, times: readonly number[], worstCount = 4): Promise<VerifyTime[]> {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none'
  document.body.append(host)
  const mounted = mountPage(host, input.page)
  try {
    await document.fonts.ready
    const anims = collectAnimations(mounted.stageEl)
    const main = mounted.stageEl.firstElementChild as HTMLElement
    const els = [main, ...Array.from(main.querySelectorAll('*'))]
    const index = new Map<Element, number>(els.map((e, i) => [e, i]))
    const out: VerifyTime[] = []
    for (const t of times) {
      const frame = Math.round(t * input.page.fps)
      seekAnimations(anims, frame / input.page.fps)
      const native = nativeAt(input.project, frame)
      const rows: VerifyRow[] = []
      for (const n of input.nodes) {
        const nat = native.get(n.name)
        if (!nat) continue
        const el = els[n.index]
        if (!el) continue
        // The browser's answer: every ancestor's composite about its own origin, outermost first.
        let abs: Aff = [1, 0, 0, 1, 0, 0]
        let opacity = 1
        for (let a: Element | null = el; a && index.has(a); a = a === main ? null : a.parentElement) {
          const cs = getComputedStyle(a)
          const o = input.origins[index.get(a)!] ?? { x: 0, y: 0 }
          abs = mul(aboutOrigin(readComposite(a, cs).c, o.x, o.y), abs)
          opacity *= parseFloat(cs.opacity)
        }
        const own = n.origin
        const px = abs[0] * own.x + abs[2] * own.y + abs[4]
        const py = abs[1] * own.x + abs[3] * own.y + abs[5]
        const d = decompose(abs)
        rows.push({
          name: n.name,
          pos: Math.hypot(nat.pos.x - px, nat.pos.y - py),
          rot: d.rot === undefined ? 0 : wrap(nat.rot - d.rot),
          opacity: Math.abs(nat.opacity - Math.min(1, Math.max(0, opacity))),
          scale: !n.svg && (nat.type === 'text' || nat.type === 'compound') ? (d.sx > 1e-3 ? Math.abs(nat.scale / d.sx - 1) : null) : null,
        })
      }
      rows.sort((a, b) => b.pos - a.pos)
      const scales = rows.map((r) => r.scale).filter((v): v is number => v !== null)
      out.push({
        t,
        frame,
        compared: rows.length,
        maxPos: Math.max(0, ...rows.map((r) => r.pos)),
        meanPos: rows.length ? rows.reduce((s, r) => s + r.pos, 0) / rows.length : 0,
        maxRot: Math.max(0, ...rows.map((r) => r.rot)),
        maxOpacity: Math.max(0, ...rows.map((r) => r.opacity)),
        maxScale: Math.max(0, ...scales),
        worst: rows.slice(0, worstCount),
        worstScale: [...rows].filter((r) => r.scale !== null).sort((a, b) => (b.scale ?? 0) - (a.scale ?? 0)).slice(0, worstCount),
      })
    }
    return out
  } finally {
    mounted.dispose()
    host.remove()
  }
}
