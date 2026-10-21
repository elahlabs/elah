/**
 * The expression evaluator (PV-P5b-1): a checked AST → one number.
 *
 * A tree walk over a node type the parser already validated, so this file does
 * no static checking — that is the parser's job, done once. What is left here is
 * arithmetic, the whitelist's semantics, and the runtime failures that only exist
 * once there are values: `sqrt(-1)`, `1/0`, a clip that is not there, a period
 * of zero.
 *
 * Runtime failures throw a private `ExprRuntimeError` that `evaluateExpression`
 * catches and turns into a result. Any OTHER exception is a bug in this file and
 * propagates deliberately: silently converting an internal TypeError into
 * "the expression failed" would hide the defect behind a plausible message.
 *
 * Deterministic by construction — no `Date`, no `Math.random`, no clock, and no
 * state outside the parse cache. The same document rendered twice must produce
 * the same pixels, and the export worker must agree with the preview.
 *
 * DOM-free: the export worker imports this through `resolveTimeline`.
 */

import { noise1 } from '../../elements/noise'
import { physicalSpring, springProgress } from '../spring'
import { cubicBezier } from '../bezier'
import { evaluateEasing } from '../textAnimation'
import type { TextAnimationEasing } from '../../types'
import { findBezierPreset } from '../../elements/easingPresets'
import { findSpringPreset } from '../../elements/springPresets'
import type { ExprEnv, ExprErrorCode } from './scope'
import type { ExprNode } from './parse'

export interface EvalContext {
  env: ExprEnv
  /** The wiggle seed: seedFor(clipId, channel). Computed once when the document
   *  is opened, never hashed per call. */
  seed: number
  /** Non-fatal notices (prop/audio unavailable). The caller deduplicates. */
  report(code: ExprErrorCode, message: string): void
}

export type EvalResult =
  | { ok: true; value: number }
  | { ok: false; code: ExprErrorCode; message: string; pos: number }

/** Private to this module: only `evaluateExpression` catches this class. */
class ExprRuntimeError extends Error {
  constructor(
    readonly code: ExprErrorCode,
    readonly message: string,
    readonly pos: number,
  ) {
    super(message)
  }
}

/**
 * Runtime failure. Declared as a FUNCTION, not a `const` arrow: TypeScript only
 * treats a call as never-returning for a function declaration or a const with an
 * explicit type annotation, and without that narrowing every `bail(...)` below
 * would leave the compiler assuming the function might fall through.
 */
function bail(code: ExprErrorCode, message: string, pos: number): never {
  throw new ExprRuntimeError(code, message, pos)
}

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x)

/** Text reaching arithmetic is a type error, not a silent 0 or a NaN. */
function asNumber(v: number | string, pos: number): number {
  if (typeof v === 'string') bail('type', 'Text cannot be used in arithmetic', pos)
  return v
}

export function evaluateExpression(ast: ExprNode, ctx: EvalContext): EvalResult {
  try {
    const value = ev(ast, ctx)
    if (typeof value === 'string') {
      return { ok: false, code: 'type', message: 'The result is text, not a number', pos: ast.pos }
    }
    if (!Number.isFinite(value)) {
      return { ok: false, code: 'non-finite', message: 'The result is not a finite number', pos: ast.pos }
    }
    return { ok: true, value }
  } catch (err) {
    if (err instanceof ExprRuntimeError) {
      return { ok: false, code: err.code, message: err.message, pos: err.pos }
    }
    throw err
  }
}

function ev(node: ExprNode, ctx: EvalContext): number | string {
  switch (node.k) {
    case 'num':
      return node.v
    case 'str':
      return node.v
    case 'id':
      return readId(node.name, ctx)
    case 'un': {
      const a = asNumber(ev(node.a, ctx), node.a.pos)
      if (node.op === '-') return -a
      if (node.op === '+') return a
      return a === 0 ? 1 : 0
    }
    case 'bin':
      return evBinary(node, ctx)
    case 'cond': {
      const c = asNumber(ev(node.c, ctx), node.c.pos)
      return c !== 0 ? ev(node.a, ctx) : ev(node.b, ctx)
    }
    case 'mem': {
      const obj = node.obj
      if (obj.k === 'id' && obj.name === 'stage') {
        return ctx.env.stage[node.name as 'width' | 'height']
      }
      // `call clip` — the parser has already proved the argument is a literal.
      const ref = (obj as { args: ExprNode[] }).args[0] as { v: string }
      const view = ctx.env.clip(ref.v)
      if (!view) bail('unknown-clip', `No clip "${ref.v}"`, node.pos)
      return view[node.name as 'x']
    }
    case 'call':
      return evCall(node, ctx)
  }
}

function readId(name: string, ctx: EvalContext): number {
  const env = ctx.env
  if (name === 'PI') return Math.PI
  if (name === 't') return env.t
  if (name === 'frame') return env.frame
  if (name === 'fps') return env.fps
  if (name === 'duration') return env.duration
  if (name === 'progress') return env.progress
  if (name === 'value') return env.value
  // `stage` reaches here only as a member object, where `mem` handled it.
  bail('type', 'stage needs .width or .height', 0)
}

function evBinary(node: Extract<ExprNode, { k: 'bin' }>, ctx: EvalContext): number {
  const a = asNumber(ev(node.a, ctx), node.a.pos)

  // Short-circuit: the right operand must NOT be evaluated when the left
  // decides the answer, or `0 && clip("missing").x` would report an error for a
  // branch that never runs.
  if (node.op === '&&') return a !== 0 ? (asNumber(ev(node.b, ctx), node.b.pos) !== 0 ? 1 : 0) : 0
  if (node.op === '||') return a !== 0 ? 1 : asNumber(ev(node.b, ctx), node.b.pos) !== 0 ? 1 : 0

  const b = asNumber(ev(node.b, ctx), node.b.pos)
  switch (node.op) {
    case '+':
      return a + b
    case '-':
      return a - b
    case '*':
      return a * b
    case '/':
      return a / b
    case '%':
      return a % b
    case '^':
      return Math.pow(a, b)
    case '<':
      return a < b ? 1 : 0
    case '<=':
      return a <= b ? 1 : 0
    case '>':
      return a > b ? 1 : 0
    case '>=':
      return a >= b ? 1 : 0
    case '==':
      return a === b ? 1 : 0
    case '!=':
      return a !== b ? 1 : 0
  }
}

function evCall(node: Extract<ExprNode, { k: 'call' }>, ctx: EvalContext): number {
  const args = node.args

  // The functions with a TEXT argument come first, and deliberately: their
  // argument is a string, so hoisting the numeric extraction above them would
  // reject `prop("title")` and `ease(x, "quad-out")` as text-in-arithmetic
  // before their own cases ever ran.
  switch (node.fn) {
    case 'clip':
      // The parser guarantees a `.field` follows, so `mem` consumed this value.
      // Reaching here means the AST was hand-built rather than parsed.
      return bail('type', 'clip(...) needs a field such as .x', node.pos)
    case 'prop': {
      const name = (args[0] as { v: string }).v
      const got = ctx.env.prop?.(name)
      if (got === undefined) {
        // A notice, not a failure: the rest of the expression still evaluates,
        // so one unavailable property does not blank the channel.
        ctx.report('prop-unavailable', `prop("${name}") is not available here`)
        return 0
      }
      if (typeof got === 'string') bail('type', 'Text cannot be used in arithmetic', args[0]!.pos)
      return got
    }
    case 'audio': {
      const name = (args[0] as { v: string }).v
      const got = ctx.env.audio?.(name)
      if (got === undefined) {
        ctx.report('audio-unavailable', `audio("${name}") is not available here`)
        return 0
      }
      return got
    }
    case 'ease': {
      const x = args[0] ? asNumber(ev(args[0], ctx), args[0].pos) : 0
      return evEase(node, x)
    }
  }

  // Fixed-arity functions read their arguments into locals rather than an
  // array: this runs once per channel per frame, and a per-frame array
  // allocation for `sin(t)` is exactly the kind of cost that makes an animation
  // stutter on a long timeline.
  const a0 = args[0] ? asNumber(ev(args[0], ctx), args[0].pos) : 0
  const a1 = args[1] ? asNumber(ev(args[1], ctx), args[1].pos) : 0
  const a2 = args[2] ? asNumber(ev(args[2], ctx), args[2].pos) : 0
  const a3 = args[3] ? asNumber(ev(args[3], ctx), args[3].pos) : 0

  switch (node.fn) {
    case 'sin':
      return Math.sin(a0)
    case 'cos':
      return Math.cos(a0)
    case 'abs':
      return Math.abs(a0)
    case 'floor':
      return Math.floor(a0)
    case 'ceil':
      return Math.ceil(a0)
    case 'round':
      return Math.round(a0)
    case 'sqrt':
      return Math.sqrt(a0)
    case 'exp':
      return Math.exp(a0)
    case 'log':
      return Math.log(a0)
    case 'pow':
      return Math.pow(a0, a1)
    case 'clamp':
      return Math.min(Math.max(a0, a1), a2)
    case 'lerp':
      // t is NOT clamped: overshooting a lerp is how an expression is meant to
      // leave the range on purpose.
      return a0 + (a1 - a0) * a2
    case 'smoothstep':
      return smoothstep(a0, a1, a2)
    case 'min':
    case 'max': {
      let out = a0
      for (let i = 1; i < args.length; i++) {
        const v = asNumber(ev(args[i]!, ctx), args[i]!.pos)
        out = node.fn === 'min' ? Math.min(out, v) : Math.max(out, v)
      }
      return out
    }
    case 'loop': {
      if (!(a1 > 0)) bail('domain', 'loop needs a positive period', node.pos)
      return a0 - a1 * Math.floor(a0 / a1)
    }
    case 'pingpong': {
      if (!(a1 > 0)) bail('domain', 'pingpong needs a positive length', node.pos)
      // length − |loop(x, 2·length) − length|: 0 → length → 0, and continuous
      // at both ends, which a `x % (2*length)` fold would not be.
      const folded = a0 - 2 * a1 * Math.floor(a0 / (2 * a1))
      return a1 - Math.abs(folded - a1)
    }
    case 'pulse': {
      if (!(a1 > 0)) bail('domain', 'pulse needs a positive period', node.pos)
      const duty = clamp(args[2] ? a2 : 0.5, 0, 1)
      return a0 - a1 * Math.floor(a0 / a1) < duty * a1 ? 1 : 0
    }
    case 'spring':
      return physicalSpring(a0, args[1] ? a1 : 100, args[2] ? a2 : 10, args[3] ? a3 : 1)
    case 'wiggle':
      return wiggle(ctx, a0, a1, args[2] ? a2 : 1)
  }

  // The parser only admits names in EXPR_FUNCTIONS, so this is unreachable from
  // a parsed tree and only reachable from a hand-built one. A named error beats
  // returning undefined, and it is also what makes this function total: the two
  // switches above cover all 24 names between them, but TypeScript does not
  // compose exhaustiveness across two separate switches.
  return bail('unknown-function', `Unknown function "${node.fn}"`, node.pos)
}

function smoothstep(e0: number, e1: number, x: number): number {
  if (e0 === e1) return x < e0 ? 0 : 1
  const u = clamp((x - e0) / (e1 - e0), 0, 1)
  return u * u * (3 - 2 * u)
}

/**
 * `wiggle(freq, amp, octaves = 1)`: value plus layered value noise, After Effects
 * style. Returns `value + amp · sum / Σ0.5^o`, so the jitter is `amp` at its
 * strongest no matter how many octaves are asked for.
 *
 * The seed comes from the CONTEXT, not from hashing here: a per-call hash would
 * walk a string per channel per frame, and the only requirement is that the same
 * channel wobbles the same way every time.
 */
function wiggle(ctx: EvalContext, freq: number, amp: number, octaves: number): number {
  const n = clamp(Math.round(Number.isFinite(octaves) ? octaves : 1), 1, 4)
  const env = ctx.env
  let sum = 0
  let norm = 0
  for (let o = 0; o < n; o++) {
    const weight = Math.pow(0.5, o)
    // The seed + o·7919 wrap is intentional and deterministic: `noise1` takes
    // the seed through `| 0` anyway.
    sum += weight * noise1(ctx.seed + o * 7919, env.t * freq * Math.pow(2, o))
    norm += weight
  }
  return env.value + (amp * sum) / norm
}

function evEase(node: Extract<ExprNode, { k: 'call' }>, x: number): number {
  const p = clamp(x, 0, 1)
  const nameArg = node.args[1]
  if (!nameArg || nameArg.k !== 'str') {
    // No name: the default bezier preset, matching the panel's first row.
    return cubicBezier([0.25, 0.1, 0.25, 1], p)
  }
  const name = nameArg.v
  if (name.startsWith('spring:')) {
    const preset = findSpringPreset(name.slice('spring:'.length))
    if (!preset) bail('unknown-easing', `Unknown curve "${name}"`, nameArg.pos)
    return springProgress(preset.spring, p)
  }
  const bezier = findBezierPreset(name)
  if (bezier) return cubicBezier(bezier.bezier, p)
  return evaluateEasing(name as TextAnimationEasing, p)
}
