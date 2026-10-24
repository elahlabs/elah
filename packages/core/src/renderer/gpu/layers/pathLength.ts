/**
 * One SVG path parser, shared by everything that needs to walk a `d` string.
 *
 * Canvas has no `getTotalLength` and the SVG DOM is not available in the export
 * worker, so the two things that need to know a path's geometry - the draw-on
 * animation's length (EDX-P9) and the drawing's own box (PV-P2b) - each brought
 * their own parse. They must not: a length measured by one parse and a box
 * measured by another disagree on exactly the paths where it shows. So the
 * tokenizer and the command loop live here once, and both consume it.
 *
 * The walk is intentionally the parser this always was, approximation included:
 *
 *  - Curves are flattened at {@link CURVE_STEPS} samples, not solved.
 *  - `S` uses the current point as its first control (no reflection of the
 *    previous curve's) and `T` is a straight line. `Path2D` paints the true
 *    curves, so a bound on an `S`/`T` path can be slightly off. That is the
 *    trade for the length function and the bounds agreeing with each other.
 *  - Arcs are reported as an arc, not converted: a visitor that wants geometry
 *    (see `pathBounds`) applies the SVG endpoint-to-centre conversion itself,
 *    and one that wants a cheap length measures the chord.
 *
 * Pure, allocation-light, never throws: unparseable input yields nothing, and the
 * walk stops exactly where the old parser stopped.
 */

const CURVE_STEPS = 16

/** Receives every segment of a path in absolute user units. Quadratics arrive as cubics. */
export interface PathVisitor {
  move(x: number, y: number): void
  line(x0: number, y0: number, x1: number, y1: number): void
  cubic(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
  ): void
  arc(
    x0: number,
    y0: number,
    rx: number,
    ry: number,
    rotationDeg: number,
    largeArc: boolean,
    sweep: boolean,
    x1: number,
    y1: number,
  ): void
}

/**
 * Parse `d` exactly as the length function always has and report each segment.
 * Never throws.
 *
 * Every coordinate is absolute: a relative command has already had the current
 * point added to it, so a visitor never has to track relative state itself.
 */
export function walkPath(d: string, visit: PathVisitor): void {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)
  if (!tokens) return
  let i = 0
  let cmd = ''
  let x = 0
  let y = 0
  let sx = 0
  let sy = 0
  const next = () => Number(tokens[i++])
  const hasNumber = () => i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i]!)
  const line = (nx: number, ny: number) => {
    visit.line(x, y, nx, ny)
    x = nx
    y = ny
  }
  const cubic = (x1: number, y1: number, x2: number, y2: number, nx: number, ny: number) => {
    visit.cubic(x, y, x1, y1, x2, y2, nx, ny)
    x = nx
    y = ny
  }
  const quad = (x1: number, y1: number, nx: number, ny: number) =>
    cubic(x + (2 / 3) * (x1 - x), y + (2 / 3) * (y1 - y), nx + (2 / 3) * (x1 - nx), ny + (2 / 3) * (y1 - ny), nx, ny)

  let guard = 0
  while (i < tokens.length && guard++ < 100000) {
    if (/^[a-zA-Z]$/.test(tokens[i]!)) cmd = tokens[i++]!
    else if (!cmd) return
    const rel = cmd === cmd.toLowerCase()
    const ox = rel ? x : 0
    const oy = rel ? y : 0
    switch (cmd.toUpperCase()) {
      case 'M': {
        if (!hasNumber()) break
        x = ox + next()
        y = oy + next()
        sx = x
        sy = y
        visit.move(x, y)
        cmd = rel ? 'l' : 'L'
        break
      }
      case 'L':
        if (!hasNumber()) break
        line(ox + next(), oy + next())
        break
      case 'H':
        if (!hasNumber()) break
        line((rel ? x : 0) + next(), y)
        break
      case 'V':
        if (!hasNumber()) break
        line(x, (rel ? y : 0) + next())
        break
      case 'C': {
        if (!hasNumber()) break
        const a = [next(), next(), next(), next(), next(), next()]
        cubic(ox + a[0]!, oy + a[1]!, ox + a[2]!, oy + a[3]!, ox + a[4]!, oy + a[5]!)
        break
      }
      case 'S': {
        if (!hasNumber()) break
        const a = [next(), next(), next(), next()]
        cubic(x, y, ox + a[0]!, oy + a[1]!, ox + a[2]!, oy + a[3]!)
        break
      }
      case 'Q': {
        if (!hasNumber()) break
        const a = [next(), next(), next(), next()]
        quad(ox + a[0]!, oy + a[1]!, ox + a[2]!, oy + a[3]!)
        break
      }
      case 'T':
        if (!hasNumber()) break
        line(ox + next(), oy + next())
        break
      case 'A': {
        if (!hasNumber()) break
        const rx = next()
        const ry = next()
        const rotation = next()
        const large = next()
        const sweep = next()
        const nx = ox + next()
        const ny = oy + next()
        // Reported as an arc, before the current point moves: the visitor gets
        // the start, the end, and the flags, and decides what an arc is worth.
        visit.arc(x, y, rx, ry, rotation, large !== 0, sweep !== 0, nx, ny)
        x = nx
        y = ny
        break
      }
      case 'Z':
        line(sx, sy)
        cmd = ''
        break
      default:
        return
    }
  }
}

/**
 * Approximate length of an SVG path `d` string (EDX-P9 draw-on). Canvas has no
 * `getTotalLength`, so a shape that draws itself on needs its own estimate.
 * Curves are flattened into 16 segments; an arc is measured as its chord × π/2
 * (a half-circle upper bound — draw-on only needs "about right" so the stroke
 * finishes when the animation does).
 *
 * The arithmetic below is the function this was before the walker was split out,
 * expression for expression, because a draw-on animation that finishes a frame
 * early is not something a screenshot would ever show.
 */
export function estimatePathLength(d: string): number {
  let total = 0
  walkPath(d, {
    move: () => {},
    line: (x0, y0, x1, y1) => {
      total += Math.hypot(x1 - x0, y1 - y0)
    },
    cubic: (x0, y0, x1, y1, x2, y2, x3, y3) => {
      let px = x0
      let py = y0
      for (let s = 1; s <= CURVE_STEPS; s++) {
        const t = s / CURVE_STEPS
        const u = 1 - t
        const qx = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3
        const qy = u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3
        total += Math.hypot(qx - px, qy - py)
        px = qx
        py = qy
      }
    },
    arc: (x0, y0, _rx, _ry, _rotation, _large, _sweep, x1, y1) => {
      total += (Math.hypot(x1 - x0, y1 - y0) * Math.PI) / 2
    },
  })
  return Number.isFinite(total) ? total : 0
}
