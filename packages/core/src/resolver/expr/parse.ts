/**
 * The expression parser (PV-P5b-1): tokens → a checked AST, or one error.
 *
 * A single Pratt loop rather than a recursive-descent ladder, because the
 * precedence table is the whole grammar and a table is far easier to verify
 * against the tests than a stack of mutually recursive functions. Left binding
 * power is compared with `>` (never `>=`) against `minBp`; that one character
 * is what makes `+ - * / %` left-associative while `^` and `?:` are
 * right-associative.
 *
 * Everything checkable without running the expression is checked HERE, once:
 * unknown names, unknown functions, arity, member fields, and text in a place
 * text is not allowed. The resolver calls `parseExpression` for every frame of
 * every channel, so a bad expression must fail once at load and then be a cached
 * error object, not a per-frame exception — which is also why failures are
 * cached alongside successes.
 *
 * No `eval`, no `new Function`, no `with`, no dynamic import — `noEval.test.ts`
 * reads this file and fails the build if any of those appear.
 */

import {
  CLIP_VIEW_FIELDS,
  EXPR_FUNCTIONS,
  EXPR_IDENTIFIERS,
  EASE_NAMES,
  MAX_EXPRESSION_LENGTH,
  MAX_EXPRESSION_NODES,
  STAGE_FIELDS,
  type ExprErrorCode,
} from './scope'
import { tokenize, type Token } from './tokenize'

export type UnaryOp = '-' | '+' | '!'
export type BinaryOp =
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '^'
  | '<'
  | '<='
  | '>'
  | '>='
  | '=='
  | '!='
  | '&&'
  | '||'

export type ExprNode =
  | { k: 'num'; v: number; pos: number }
  | { k: 'str'; v: string; pos: number }
  | { k: 'id'; name: string; pos: number }
  | { k: 'un'; op: UnaryOp; a: ExprNode; pos: number }
  | { k: 'bin'; op: BinaryOp; a: ExprNode; b: ExprNode; pos: number }
  | { k: 'cond'; c: ExprNode; a: ExprNode; b: ExprNode; pos: number }
  | { k: 'call'; fn: string; args: ExprNode[]; pos: number }
  | { k: 'mem'; obj: ExprNode; name: string; pos: number }

export type ParseResult =
  | { ok: true; ast: ExprNode; nodes: number }
  | { ok: false; code: ExprErrorCode; message: string; pos: number }

/** Left binding power per operator, and the `minBp` its right operand is parsed
 *  with. `^` and `?:` pass a value one lower than their own, which is how
 *  right-associativity falls out of the same comparison as everything else. */
const BINDING: Record<string, { lbp: number; rbp: number }> = {
  '?': { lbp: 10, rbp: 9 },
  '||': { lbp: 20, rbp: 20 },
  '&&': { lbp: 30, rbp: 30 },
  '==': { lbp: 40, rbp: 40 },
  '!=': { lbp: 40, rbp: 40 },
  '<': { lbp: 50, rbp: 50 },
  '<=': { lbp: 50, rbp: 50 },
  '>': { lbp: 50, rbp: 50 },
  '>=': { lbp: 50, rbp: 50 },
  '+': { lbp: 60, rbp: 60 },
  '-': { lbp: 60, rbp: 60 },
  '*': { lbp: 70, rbp: 70 },
  '/': { lbp: 70, rbp: 70 },
  '%': { lbp: 70, rbp: 70 },
  '^': { lbp: 90, rbp: 89 },
}

/** Prefix operators bind at 80, so `-2^2` parses as `-(2^2)`. */
const PREFIX_BP = 80
/** Calls and member access bind tightest of all. */
const POSTFIX_BP = 100

/** Thrown internally and caught by `parseExpression`; never escapes the module. */
class ParseAbort extends Error {
  constructor(
    readonly code: ExprErrorCode,
    readonly message: string,
    readonly pos: number,
  ) {
    super(message)
  }
}

/**
 * Abort parsing. Declared as a FUNCTION, not a `const` arrow: TypeScript only
 * treats a call as never-returning for a function declaration or a const with an
 * explicit type annotation, and every narrowing below (`if (!arity) fail(...)`,
 * `if (left.k !== 'id') fail(...)`) depends on it.
 */
function fail(code: ExprErrorCode, message: string, pos: number): never {
  throw new ParseAbort(code, message, pos)
}

// --- Static validation ------------------------------------------------------

/** Functions whose FIRST argument is a name in quotes: clip, prop, audio. */
const NAME_ARG_FIRST: ReadonlySet<string> = new Set(['clip', 'prop', 'audio'])

/**
 * Where a node sits, which two of the rules depend on:
 *   - `asMemberObject`: `stage` and `clip(...)` are legal ONLY as the object of
 *     a `.`, so the same node is a type error or not depending on its parent.
 *   - `inNameSlot`: text is legal only as a function's name argument.
 */
interface Site {
  inNameSlot: boolean
  asMemberObject: boolean
}

const ROOT: Site = { inNameSlot: false, asMemberObject: false }

function validate(node: ExprNode, site: Site = ROOT): void {
  switch (node.k) {
    case 'num':
      return
    case 'str':
      if (!site.inNameSlot) fail('type', 'Text is only allowed as a name in quotes', node.pos)
      return
    case 'id':
      if (!EXPR_IDENTIFIERS.has(node.name)) {
        fail('unknown-identifier', `Unknown name "${node.name}"`, node.pos)
      }
      if (node.name === 'stage' && !site.asMemberObject) {
        fail('type', 'stage needs .width or .height', node.pos)
      }
      return
    case 'un':
      validate(node.a)
      return
    case 'bin':
      validate(node.a)
      validate(node.b)
      return
    case 'cond':
      validate(node.c)
      validate(node.a)
      validate(node.b)
      return
    case 'call': {
      const arity = EXPR_FUNCTIONS.get(node.fn)
      if (!arity) fail('unknown-function', `Unknown function "${node.fn}"`, node.pos)
      const [min, max] = arity
      if (node.args.length < min || node.args.length > max) {
        const expected = min === max ? `${min} argument${min === 1 ? '' : 's'}` : `${min}–${max} arguments`
        fail('arity', `${node.fn} takes ${expected}`, node.pos)
      }
      // A clip view is nine numbers; `clip("a")` on its own is not a value.
      if (node.fn === 'clip' && !site.asMemberObject) {
        fail('type', 'clip(...) needs a field such as .x', node.pos)
      }
      // Two different rules that must not be merged: `ease` takes a NUMBER first
      // and a name second, so only clip/prop/audio require a quoted first
      // argument. Applying the first-argument rule to `ease` would reject every
      // legal `ease(x, "quad-out")` in the language.
      node.args.forEach((arg, i) => {
        const isNameSlot = NAME_ARG_FIRST.has(node.fn) || (node.fn === 'ease' && i === 1)
        validate(arg, { inNameSlot: isNameSlot, asMemberObject: false })
      })
      if (NAME_ARG_FIRST.has(node.fn)) {
        const nameArg = node.args[0]!
        if (nameArg.k !== 'str') {
          fail('type', `${node.fn} needs a name in quotes`, nameArg.pos)
        }
      }
      if (node.fn === 'ease' && node.args[1] && node.args[1].k === 'str') {
        const v = node.args[1].v
        if (!EASE_NAMES.has(v)) fail('unknown-easing', `Unknown curve "${v}"`, node.args[1].pos)
      }
      return
    }
    case 'mem': {
      // Validate the object with the flag set, so `stage` and `clip(...)` pass
      // here and their own arguments are still checked.
      validate(node.obj, { inNameSlot: false, asMemberObject: true })
      const obj = node.obj
      if (obj.k === 'id' && obj.name === 'stage') {
        if (!STAGE_FIELDS.has(node.name)) {
          fail('unknown-member', `"${node.name}" is not a field here`, node.pos)
        }
        return
      }
      if (obj.k === 'call' && obj.fn === 'clip') {
        if (!CLIP_VIEW_FIELDS.has(node.name)) {
          fail('unknown-member', `"${node.name}" is not a field here`, node.pos)
        }
        return
      }
      fail('unknown-member', `"${node.name}" is not a field here`, node.pos)
    }
  }
}

// --- Parser -----------------------------------------------------------------

class Parser {
  private i = 0
  nodes = 0

  constructor(private readonly tokens: Token[]) {}

  /** Public: `parseUncached` checks the trailing token after the parse. */
  peek(): Token {
    return this.tokens[this.i]!
  }

  private next(): Token {
    return this.tokens[this.i++]!
  }

  private count(pos: number): void {
    // Counted as the tree is BUILT, not afterwards: a 512-character input
    // cannot construct a deep tree first and be rejected once it is finished.
    if (++this.nodes > MAX_EXPRESSION_NODES) {
      fail('too-complex', `More than ${MAX_EXPRESSION_NODES} parts`, pos)
    }
  }

  parseExpr(minBp: number): ExprNode {
    let left = this.prefix()
    for (;;) {
      const t = this.peek()
      if (t.kind !== 'op') break

      if (t.text === '?') {
        if (BINDING['?']!.lbp <= minBp) break
        this.next()
        const then = this.parseExpr(0)
        const colon = this.next()
        if (colon.kind !== 'op' || colon.text !== ':') {
          fail('syntax', `Expected ":" at ${colon.pos}`, colon.pos)
        }
        const otherwise = this.parseExpr(BINDING['?']!.rbp)
        this.count(t.pos)
        left = { k: 'cond', c: left, a: then, b: otherwise, pos: t.pos }
        continue
      }

      if (t.text === '(' || t.text === '.') {
        if (POSTFIX_BP <= minBp) break
        left = this.postfix(left, t)
        continue
      }

      const bp = BINDING[t.text]
      if (!bp || bp.lbp <= minBp) break
      this.next()
      const right = this.parseExpr(bp.rbp)
      this.count(t.pos)
      left = { k: 'bin', op: t.text as BinaryOp, a: left, b: right, pos: t.pos }
    }
    return left
  }

  private prefix(): ExprNode {
    const t = this.next()
    if (t.kind === 'num') {
      this.count(t.pos)
      return { k: 'num', v: t.value!, pos: t.pos }
    }
    if (t.kind === 'str') {
      this.count(t.pos)
      return { k: 'str', v: t.text, pos: t.pos }
    }
    if (t.kind === 'id') {
      this.count(t.pos)
      return { k: 'id', name: t.text, pos: t.pos }
    }
    if (t.kind === 'op' && t.text === '(') {
      const inner = this.parseExpr(0)
      const close = this.next()
      if (close.kind !== 'op' || close.text !== ')') {
        fail('syntax', `Expected ")" at ${close.pos}`, close.pos)
      }
      return inner
    }
    if (t.kind === 'op' && (t.text === '-' || t.text === '+' || t.text === '!')) {
      const operand = this.parseExpr(PREFIX_BP)
      this.count(t.pos)
      return { k: 'un', op: t.text as UnaryOp, a: operand, pos: t.pos }
    }
    if (t.kind === 'eof') fail('syntax', 'Unexpected end of expression', t.pos)
    fail('syntax', `Unexpected "${t.text}" at ${t.pos}`, t.pos)
  }

  private postfix(left: ExprNode, t: Token): ExprNode {
    this.next() // '(' or '.'
    if (t.text === '(') {
      if (left.k !== 'id') {
        fail('syntax', `Only a function name can be called at ${t.pos}`, t.pos)
      }
      const args: ExprNode[] = []
      if (!(this.peek().kind === 'op' && this.peek().text === ')')) {
        for (;;) {
          args.push(this.parseExpr(0))
          const sep = this.peek()
          if (sep.kind === 'op' && sep.text === ',') {
            this.next()
            continue
          }
          break
        }
      }
      const close = this.next()
      if (close.kind !== 'op' || close.text !== ')') {
        fail('syntax', `Expected ")" at ${close.pos}`, close.pos)
      }
      this.count(t.pos)
      return { k: 'call', fn: left.name, args, pos: t.pos }
    }
    // '.'
    const name = this.next()
    if (name.kind !== 'id') {
      fail('syntax', `Expected a field name at ${name.pos}`, name.pos)
    }
    this.count(t.pos)
    return { k: 'mem', obj: left, name: name.text, pos: t.pos }
  }
}

// --- Cache ------------------------------------------------------------------

/** Parsed once, reused forever: the resolver parses the same source on every
 *  frame of every channel. Bounded, and failures are cached too. */
const cache = new Map<string, ParseResult>()

export function clearExpressionCache(): void {
  cache.clear()
}

export function parseExpression(source: string): ParseResult {
  const hit = cache.get(source)
  if (hit) return hit

  const result = parseUncached(source)
  if (cache.size >= 512) cache.clear()
  cache.set(source, result)
  return result
}

function parseUncached(source: string): ParseResult {
  try {
    if (typeof source !== 'string') {
      return { ok: false, code: 'syntax', message: 'Not text', pos: 0 }
    }
    if (source.length > MAX_EXPRESSION_LENGTH) {
      return {
        ok: false,
        code: 'too-long',
        message: `Longer than ${MAX_EXPRESSION_LENGTH} characters`,
        pos: MAX_EXPRESSION_LENGTH,
      }
    }
    if (source.trim() === '') {
      return { ok: false, code: 'syntax', message: 'Empty expression', pos: 0 }
    }

    const lexed = tokenize(source)
    if (!lexed.ok) {
      return { ok: false, code: 'syntax', message: lexed.message, pos: lexed.pos }
    }

    const parser = new Parser(lexed.tokens)
    const ast = parser.parseExpr(0)
    const trailing = parser.peek()
    if (trailing.kind !== 'eof') {
      return {
        ok: false,
        code: 'syntax',
        message: `Unexpected "${trailing.text}" at ${trailing.pos}`,
        pos: trailing.pos,
      }
    }

    validate(ast)
    return { ok: true, ast, nodes: parser.nodes }
  } catch (err) {
    if (err instanceof ParseAbort) return { ok: false, code: err.code, message: err.message, pos: err.pos }
    // Not a parse problem: a bug here, and swallowing it would report a
    // confusing syntax error instead.
    throw err
  }
}
