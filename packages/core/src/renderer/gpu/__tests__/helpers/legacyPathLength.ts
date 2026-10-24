/**
 * A verbatim copy of `estimatePathLength` as it was BEFORE PV-P2b split the
 * walker out of it.
 *
 * This file exists only to be compared against. `pathLength.test.ts` asserts
 * the refactored function is `toBe`-equal to this one over a list of paths,
 * which is the only thing that can catch a refactor quietly changing a draw-on
 * animation's length - the kind of change no screenshot would show.
 *
 * DO NOT EDIT. If a test here fails, the refactor changed behaviour; put the old
 * behaviour back rather than updating this copy.
 */

const CURVE_STEPS = 16

export function legacyEstimatePathLength(d: string): number {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)
  if (!tokens) return 0
  let i = 0
  let cmd = ''
  let x = 0
  let y = 0
  let sx = 0
  let sy = 0
  let total = 0
  const next = () => Number(tokens[i++])
  const hasNumber = () => i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i]!)
  const line = (nx: number, ny: number) => {
    total += Math.hypot(nx - x, ny - y)
    x = nx
    y = ny
  }
  const cubic = (x1: number, y1: number, x2: number, y2: number, nx: number, ny: number) => {
    let px = x
    let py = y
    for (let s = 1; s <= CURVE_STEPS; s++) {
      const t = s / CURVE_STEPS
      const u = 1 - t
      const qx = u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * nx
      const qy = u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ny
      total += Math.hypot(qx - px, qy - py)
      px = qx
      py = qy
    }
    x = nx
    y = ny
  }
  const quad = (x1: number, y1: number, nx: number, ny: number) =>
    cubic(x + (2 / 3) * (x1 - x), y + (2 / 3) * (y1 - y), nx + (2 / 3) * (x1 - nx), ny + (2 / 3) * (y1 - ny), nx, ny)

  let guard = 0
  while (i < tokens.length && guard++ < 100000) {
    if (/^[a-zA-Z]$/.test(tokens[i]!)) cmd = tokens[i++]!
    else if (!cmd) return total
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
        next()
        next()
        next()
        next()
        next()
        const nx = ox + next()
        const ny = oy + next()
        total += (Math.hypot(nx - x, ny - y) * Math.PI) / 2
        x = nx
        y = ny
        break
      }
      case 'Z':
        line(sx, sy)
        cmd = ''
        break
      default:
        return total
    }
  }
  return Number.isFinite(total) ? total : 0
}
