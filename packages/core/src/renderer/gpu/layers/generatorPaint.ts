/**
 * Generator painter (EDX-P9) — shared verbatim by the preview's
 * `GeneratorLayer` and the export worker, the same arrangement as
 * `shapePaint` and `textPaint`, so a particle is in the same place in both.
 *
 * Everything is a pure function of (params, seed, time): particle `i` at time
 * `t` is a closed form of `rand(seed, i, k)` and `t`, never a simulation, so
 * any frame renders without the frames before it (scrubbing, export, and
 * frame-exact agent previews all agree).
 *
 * The painter never clears and never changes the composite operation — the
 * export draws it straight into the frame, the preview into a scratch canvas.
 * It saves/restores everything else it touches.
 */

import type { ActiveGeneratorClip } from '../../../resolver/scene'

export type Generator2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

interface Stage {
  width: number
  height: number
}

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

/** A stateless hash → [0, 1) of (seed, i, k). Same numbers on every run. */
export function rand(seed: number, i: number, k: number): number {
  let h = (Math.imul(seed | 0, 0x27d4eb2d) ^ Math.imul(i | 0, 0x165667b1) ^ Math.imul(k | 0, 0x9e3779b1)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
  h = (h ^ (h >>> 16)) >>> 0
  return h / 4294967296
}

const TAU = Math.PI * 2
const CONFETTI = ['#ff4d6d', '#ffd166', '#06d6a0', '#118ab2', '#f78c6b', '#c77dff', '#ffffff']

const num = (p: ActiveGeneratorClip['params'], k: string, d: number): number => {
  const v = p[k]
  return typeof v === 'number' && Number.isFinite(v) ? v : d
}
const str = (p: ActiveGeneratorClip['params'], k: string, d: string): string => {
  const v = p[k]
  return typeof v === 'string' ? v : d
}

function hexAlpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  const n = m ? parseInt(m[1]!, 16) : 0xffffff
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a)).toFixed(4)})`
}

function easeOutCubic(t: number): number {
  const c = Math.max(0, Math.min(1, t))
  return 1 - (1 - c) ** 3
}

function fract(x: number): number {
  return x - Math.floor(x)
}

// ---------------------------------------------------------------------------
// Kinds
// ---------------------------------------------------------------------------

function particles(ctx: Generator2D, item: ActiveGeneratorClip, s: Stage, t: number): void {
  const p = item.params
  const style = str(p, 'style', 'confetti')
  const count = Math.max(0, Math.min(500, Math.round(num(p, 'count', 120))))
  const size = num(p, 'size', 10)
  const speed = num(p, 'speed', 1)
  const color = str(p, 'color', '#ffffff')
  const W = s.width
  const H = s.height
  const seed = item.seed
  for (let i = 0; i < count; i++) {
    const r = (k: number) => rand(seed, i, k)
    switch (style) {
      case 'confetti': {
        const period = 4 + r(1) * 3
        const phase = fract((t * speed) / period + r(0))
        const x = r(2) * W + Math.sin(t * speed * (1 + r(3) * 2) + r(4) * TAU) * 0.03 * W
        const y = -0.05 * H + phase * 1.1 * H
        const w = size * (0.6 + r(7))
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(t * speed * (2 + r(5) * 4) + r(6) * TAU)
        // A tumbling piece: its visible width swings with a second rotation.
        ctx.scale(Math.cos(t * speed * (3 + r(9) * 3) + r(10) * TAU), 1)
        ctx.fillStyle = CONFETTI[Math.floor(r(8) * CONFETTI.length)]!
        ctx.fillRect(-w / 2, -w / 4, w, w / 2)
        ctx.restore()
        break
      }
      case 'snow': {
        const period = 8 + r(1) * 6
        const phase = fract((t * speed) / period + r(0))
        const x = r(2) * W + Math.sin(t * 0.8 * speed + r(4) * TAU) * 0.02 * W
        const y = -0.02 * H + phase * 1.04 * H
        ctx.fillStyle = hexAlpha(color, 0.5 + 0.5 * r(8))
        ctx.beginPath()
        ctx.arc(x, y, size * 0.25 * (0.4 + r(7)), 0, TAU)
        ctx.fill()
        break
      }
      case 'dust': {
        const x = fract(r(2) + t * speed * 0.01 * (r(3) - 0.5) * 2) * W
        const y = fract(r(1) + t * speed * 0.008 * (r(4) - 0.5) * 2) * H
        const twinkle = 0.2 + 0.4 * (0.5 + 0.5 * Math.sin(t * (1 + r(5) * 3) + r(6) * TAU))
        ctx.fillStyle = hexAlpha(color, twinkle)
        ctx.beginPath()
        ctx.arc(x, y, size * 0.12 * (0.5 + r(7)), 0, TAU)
        ctx.fill()
        break
      }
      case 'sparks':
      case 'embers': {
        const slow = style === 'embers' ? 2.2 : 1
        const period = (1.5 + r(1) * 1.5) * slow
        const phase = fract((t * speed) / period + r(0))
        const x = r(2) * W + phase * (r(4) - 0.5) * 0.2 * W
        const y = H * (1.02 - phase * 0.9 * (0.6 + 0.4 * r(3)))
        const life = 1 - phase
        if (style === 'sparks') {
          ctx.strokeStyle = hexAlpha(color, life)
          ctx.lineWidth = Math.max(1, size * 0.15)
          ctx.lineCap = 'round'
          ctx.beginPath()
          ctx.moveTo(x, y)
          ctx.lineTo(x - (r(4) - 0.5) * size * 0.6, y + size * 1.5)
          ctx.stroke()
        } else {
          const flicker = 0.6 + 0.4 * Math.sin(t * 9 + r(6) * TAU)
          const rad = size * 0.35 * (0.5 + r(7))
          const g = ctx.createRadialGradient(x, y, 0, x, y, rad * 2.2)
          g.addColorStop(0, hexAlpha(color, life * flicker))
          g.addColorStop(1, hexAlpha(color, 0))
          ctx.fillStyle = g
          ctx.beginPath()
          ctx.arc(x, y, rad * 2.2, 0, TAU)
          ctx.fill()
        }
        break
      }
      case 'bokeh': {
        const x = fract(r(2) + t * speed * 0.006 * (r(3) - 0.5) * 2) * W
        const y = fract(r(1) + t * speed * 0.005 * (r(4) - 0.5) * 2) * H
        const rad = size * (2 + r(7) * 4)
        const a = (0.08 + 0.18 * r(8)) * (0.7 + 0.3 * Math.sin(t * (0.5 + r(5)) + r(6) * TAU))
        const g = ctx.createRadialGradient(x, y, rad * 0.6, x, y, rad)
        g.addColorStop(0, hexAlpha(color, a))
        g.addColorStop(1, hexAlpha(color, 0))
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(x, y, rad, 0, TAU)
        ctx.fill()
        break
      }
    }
  }
}

function energyLines(ctx: Generator2D, item: ActiveGeneratorClip, s: Stage, t: number): void {
  const p = item.params
  const count = Math.max(0, Math.min(200, Math.round(num(p, 'count', 60))))
  const thickness = num(p, 'thickness', 6)
  const inner = num(p, 'inner', 0.35)
  const flicker = num(p, 'flicker', 12)
  const color = str(p, 'color', '#ffffff')
  const cx = s.width / 2
  const cy = s.height / 2
  const diag = Math.hypot(s.width, s.height) / 2
  const tick = flicker > 0 ? Math.floor(t * flicker) : 0
  const seed = item.seed + tick * 7919
  ctx.fillStyle = hexAlpha(color, 0.85)
  for (let i = 0; i < count; i++) {
    const a = rand(seed, i, 0) * TAU
    const r0 = diag * (inner + rand(seed, i, 1) * (1 - inner) * 0.5)
    const half = (thickness * (0.4 + rand(seed, i, 2))) / 2
    const ux = Math.cos(a)
    const uy = Math.sin(a)
    // A wedge: a point at r0, widening to `half` at the frame's edge.
    ctx.beginPath()
    ctx.moveTo(cx + ux * r0, cy + uy * r0)
    ctx.lineTo(cx + ux * diag * 1.1 - uy * half, cy + uy * diag * 1.1 + ux * half)
    ctx.lineTo(cx + ux * diag * 1.1 + uy * half, cy + uy * diag * 1.1 - ux * half)
    ctx.closePath()
    ctx.fill()
  }
}

function lightLeak(ctx: Generator2D, item: ActiveGeneratorClip, s: Stage, t: number): void {
  const p = item.params
  const colors = [str(p, 'colorA', '#ff7a18'), str(p, 'colorB', '#ff2d75')]
  const intensity = num(p, 'intensity', 0.7)
  const speed = num(p, 'speed', 0.4)
  const R = Math.max(s.width, s.height) * 0.7
  for (let i = 0; i < 3; i++) {
    const k = t * speed + i * 2.1 + rand(item.seed, i, 0) * TAU
    const x = s.width * (0.5 + 0.55 * Math.sin(k * 0.7 + i))
    const y = s.height * (0.5 + 0.45 * Math.cos(k * 0.5 + i * 1.7))
    const g = ctx.createRadialGradient(x, y, 0, x, y, R * (0.6 + 0.2 * i))
    const c = colors[i % 2]!
    g.addColorStop(0, hexAlpha(c, intensity * (0.75 - i * 0.15)))
    g.addColorStop(0.5, hexAlpha(c, intensity * 0.25))
    g.addColorStop(1, hexAlpha(c, 0))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, s.width, s.height)
  }
}

function lensFlare(ctx: Generator2D, item: ActiveGeneratorClip, s: Stage): void {
  const p = item.params
  const x = num(p, 'x', 0.78) * s.width
  const y = num(p, 'y', 0.22) * s.height
  const intensity = num(p, 'intensity', 0.9)
  const color = str(p, 'color', '#ffd9a0')
  const base = Math.min(s.width, s.height)
  const glow = ctx.createRadialGradient(x, y, 0, x, y, base * 0.35)
  glow.addColorStop(0, hexAlpha('#ffffff', Math.min(1, intensity)))
  glow.addColorStop(0.15, hexAlpha(color, intensity * 0.7))
  glow.addColorStop(1, hexAlpha(color, 0))
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, s.width, s.height)
  // A horizontal anamorphic streak.
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(1, 0.04)
  const streak = ctx.createRadialGradient(0, 0, 0, 0, 0, s.width * 0.6)
  streak.addColorStop(0, hexAlpha(color, intensity * 0.6))
  streak.addColorStop(1, hexAlpha(color, 0))
  ctx.fillStyle = streak
  ctx.beginPath()
  ctx.arc(0, 0, s.width * 0.6, 0, TAU)
  ctx.fill()
  ctx.restore()
  // Ghosts along the line through the centre.
  const cx = s.width / 2
  const cy = s.height / 2
  const ghosts = [0.5, 0.9, 1.3, 1.7]
  ghosts.forEach((d, i) => {
    const gx = x + (cx - x) * d * 1.2
    const gy = y + (cy - y) * d * 1.2
    const r = base * (0.03 + 0.03 * ((i * 37) % 3))
    ctx.fillStyle = hexAlpha(color, intensity * 0.12)
    ctx.beginPath()
    ctx.arc(gx, gy, r, 0, TAU)
    ctx.fill()
  })
}

function gradientBackground(ctx: Generator2D, item: ActiveGeneratorClip, s: Stage, t: number): void {
  const p = item.params
  const angle = ((num(p, 'angle', 135) + num(p, 'spin', 0) * t) * Math.PI) / 180
  const cx = s.width / 2
  const cy = s.height / 2
  const half = (Math.abs(Math.cos(angle)) * s.width + Math.abs(Math.sin(angle)) * s.height) / 2
  const g = ctx.createLinearGradient(cx - Math.cos(angle) * half, cy - Math.sin(angle) * half, cx + Math.cos(angle) * half, cy + Math.sin(angle) * half)
  g.addColorStop(0, str(p, 'colorA', '#1e3c72'))
  g.addColorStop(1, str(p, 'colorB', '#e94e77'))
  ctx.fillStyle = g
  ctx.fillRect(0, 0, s.width, s.height)
}

/** Where a placed generator sits, and how big: the transform's centre and scale. */
function placement(item: ActiveGeneratorClip, s: Stage): { x: number; y: number; scale: number; rotation: number } {
  const tr = item.transform
  return {
    x: (tr?.x ?? 0.5) * s.width,
    y: (tr?.y ?? 0.5) * s.height,
    scale: tr?.scale ?? 1,
    rotation: tr?.rotation ?? 0,
  }
}

/** Format a counter value: fixed decimals, optional thousands separator. */
export function formatCounter(value: number, decimals: number, separator: boolean): string {
  const d = Math.max(0, Math.min(3, Math.round(decimals)))
  const fixed = Math.abs(value).toFixed(d)
  const [int, frac] = fixed.split('.')
  const grouped = separator ? int!.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : int!
  return `${value < 0 ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`
}

/** The counter's value at a clip-local frame. */
export function counterValue(params: ActiveGeneratorClip['params'], localFrame: number, durationFrames: number): number {
  const from = num(params, 'from', 0)
  const to = num(params, 'to', 1000)
  const span = Math.max(1, Math.round(durationFrames * num(params, 'countFraction', 0.7)) - 1)
  return from + (to - from) * easeOutCubic(localFrame / span)
}

function counter(ctx: Generator2D, item: ActiveGeneratorClip, s: Stage): void {
  const p = item.params
  const value = counterValue(p, item.localFrame, item.durationFrames)
  const label = `${str(p, 'prefix', '')}${formatCounter(value, num(p, 'decimals', 0), p.separator !== false)}${str(p, 'suffix', '')}`
  const at = placement(item, s)
  ctx.save()
  ctx.translate(at.x, at.y)
  ctx.rotate(at.rotation)
  ctx.font = `800 ${Math.max(1, num(p, 'fontSize', 160) * at.scale)}px system-ui, -apple-system, "Segoe UI", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = str(p, 'color', '#ffffff')
  ctx.fillText(label, 0, 0)
  ctx.restore()
}

/** Parse "40, 65, 52" → finite numbers (at most 24). */
export function parseChartValues(raw: string): number[] {
  return raw
    .split(/[,;\s]+/)
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v))
    .slice(0, 24)
}

function barChart(ctx: Generator2D, item: ActiveGeneratorClip, s: Stage): void {
  const p = item.params
  const values = parseChartValues(str(p, 'values', ''))
  if (values.length === 0) return
  const at = placement(item, s)
  const w = num(p, 'width', 0.5) * s.width * at.scale
  const h = num(p, 'height', 0.35) * s.height * at.scale
  const max = Math.max(...values.map(Math.abs), 1e-9)
  const gap = w * 0.04
  const barW = (w - gap * (values.length - 1)) / values.length
  const grow = Math.max(1, item.durationFrames * num(p, 'growFraction', 0.5))
  const stagger = grow / (values.length + 2)
  const color = str(p, 'color', '#4ade80')
  ctx.save()
  ctx.translate(at.x, at.y)
  ctx.rotate(at.rotation)
  values.forEach((v, i) => {
    const k = easeOutCubic((item.localFrame - i * stagger) / Math.max(1, grow - values.length * stagger))
    const bh = (Math.abs(v) / max) * h * k
    const x = -w / 2 + i * (barW + gap)
    ctx.fillStyle = color
    ctx.fillRect(x, h / 2 - bh, barW, bh)
    if (p.showValues !== false && k > 0.05) {
      ctx.font = `700 ${Math.max(8, barW * 0.32)}px system-ui, -apple-system, "Segoe UI", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.fillStyle = hexAlpha('#ffffff', k)
      ctx.fillText(formatCounter(v * k, 0, true), x + barW / 2, h / 2 - bh - barW * 0.08)
    }
  })
  ctx.restore()
}

function progressBar(ctx: Generator2D, item: ActiveGeneratorClip, s: Stage): void {
  const p = item.params
  const at = placement(item, s)
  const w = num(p, 'width', 0.6) * s.width * at.scale
  const th = num(p, 'thickness', 18) * at.scale
  const t = item.durationFrames > 1 ? item.localFrame / (item.durationFrames - 1) : 1
  const from = num(p, 'from', 0)
  const to = num(p, 'to', 1)
  const fill = Math.max(0, Math.min(1, from + (to - from) * easeOutCubic(t)))
  const r = th / 2
  const rounded = (x: number, width: number) => {
    ctx.beginPath()
    if (typeof ctx.roundRect === 'function') ctx.roundRect(x, -th / 2, width, th, r)
    else ctx.rect(x, -th / 2, width, th)
    ctx.fill()
  }
  ctx.save()
  ctx.translate(at.x, at.y)
  ctx.rotate(at.rotation)
  ctx.fillStyle = hexAlpha(str(p, 'track', '#ffffff'), 0.25)
  rounded(-w / 2, w)
  if (fill > 0) {
    ctx.fillStyle = str(p, 'color', '#38bdf8')
    rounded(-w / 2, Math.max(th, w * fill))
  }
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** Paint a generator clip in stage coordinates. The caller owns globalAlpha and clearing. */
export function paintGenerator(ctx: Generator2D, item: ActiveGeneratorClip, stage: Stage): void {
  const t = item.localFrame / Math.max(1, item.fps)
  ctx.save()
  switch (item.kind) {
    case 'particles':
      particles(ctx, item, stage, t)
      break
    case 'energyLines':
      energyLines(ctx, item, stage, t)
      break
    case 'lightLeak':
      lightLeak(ctx, item, stage, t)
      break
    case 'lensFlare':
      lensFlare(ctx, item, stage)
      break
    case 'gradientBackground':
      gradientBackground(ctx, item, stage, t)
      break
    case 'counter':
      counter(ctx, item, stage)
      break
    case 'barChart':
      barChart(ctx, item, stage)
      break
    case 'progressBar':
      progressBar(ctx, item, stage)
      break
  }
  ctx.restore()
}

/**
 * Everything the painted pixels depend on. Generators animate, so the frame
 * is part of it — except a still gradient, which is painted once.
 */
export function generatorPaintSignature(item: ActiveGeneratorClip, stage: Stage): string {
  const still = item.kind === 'gradientBackground' && num(item.params, 'spin', 0) === 0
  const tr = item.transform
  return [
    item.kind,
    item.seed,
    JSON.stringify(item.params),
    stage.width,
    stage.height,
    still ? '' : item.localFrame,
    item.fps,
    item.durationFrames,
    tr ? `${tr.x},${tr.y},${tr.scale},${tr.rotation}` : '',
  ].join('|')
}
