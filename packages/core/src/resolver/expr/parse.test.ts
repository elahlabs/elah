import { beforeEach, describe, expect, it } from 'vitest'
import { clearExpressionCache, parseExpression, type ExprNode, type ParseResult } from './parse'

/** S-expression form of the tree, so a test asserts SHAPE rather than fields. */
function show(n: ExprNode): string {
  switch (n.k) {
    case 'num':
      return String(n.v)
    case 'str':
      return `"${n.v}"`
    case 'id':
      return n.name
    case 'un':
      return `(${n.op} ${show(n.a)})`
    case 'bin':
      return `(${n.op} ${show(n.a)} ${show(n.b)})`
    case 'cond':
      return `(? ${show(n.c)} ${show(n.a)} ${show(n.b)})`
    case 'call':
      return `(${n.fn} ${n.args.map(show).join(' ')})`
    case 'mem':
      return `(. ${show(n.obj)} ${n.name})`
  }
}

/** The shape of a source that must parse. */
function shape(source: string): string {
  const r = parseExpression(source)
  if (!r.ok) throw new Error(`expected ${source} to parse, got ${r.code}: ${r.message}`)
  return show(r.ast)
}

/** The error code of a source that must be rejected. */
function code(source: string): string {
  const r = parseExpression(source)
  if (r.ok) throw new Error(`expected ${source} to fail, got ${show(r.ast)}`)
  return r.code
}

beforeEach(() => clearExpressionCache())

describe('precedence and associativity', () => {
  it('binds multiplication tighter than addition', () => {
    expect(shape('1 + 2 * 3')).toBe('(+ 1 (* 2 3))')
  })

  it('honours parentheses', () => {
    expect(shape('(1 + 2) * 3')).toBe('(* (+ 1 2) 3)')
  })

  it('makes unary minus bind looser than ^, so -2^2 is -4', () => {
    // The maths convention. It is deliberate: an animation author writing
    // `-x^2` means minus the square, not the square of minus x.
    expect(shape('-2 ^ 2')).toBe('(- (^ 2 2))')
  })

  it('makes ^ right-associative', () => {
    expect(shape('2 ^ 3 ^ 2')).toBe('(^ 2 (^ 3 2))')
  })

  it('allows a unary operand on the right of ^', () => {
    expect(shape('2 ^ -1')).toBe('(^ 2 (- 1))')
  })

  it('binds comparison looser than equality', () => {
    expect(shape('1 < 2 == 1')).toBe('(== (< 1 2) 1)')
  })

  it('binds && tighter than ||', () => {
    expect(shape('t || frame && value')).toBe('(|| t (&& frame value))')
  })

  it('nests a conditional to the right', () => {
    expect(shape('t ? 1 : frame ? 2 : 3')).toBe('(? t 1 (? frame 2 3))')
  })

  it('makes + - * / % left-associative', () => {
    // Left binding power is compared with `>` against minBp, and *that* is what
    // makes these left- rather than right-associative.
    expect(shape('1 - 2 - 3')).toBe('(- (- 1 2) 3)')
    expect(shape('8 / 4 / 2')).toBe('(/ (/ 8 4) 2)')
  })

  it('reads a member access on a call', () => {
    expect(shape('clip("A").x + 1')).toBe('(+ (. (clip "A") x) 1)')
  })

  it('reads a member access on an identifier', () => {
    expect(shape('stage.width / 2')).toBe('(/ (. stage width) 2)')
  })

  it('reads nested calls', () => {
    expect(shape('max(sin(t), 1)')).toBe('(max (sin t) 1)')
  })

  it('reads an empty argument list as a call, not a syntax error', () => {
    // No function takes zero arguments, so this is always rejected — but it must
    // be rejected on ARITY, which proves the empty-argument path exists.
    expect(code('min()')).toBe('arity')
  })
})

describe('static checks', () => {
  it('reports syntax', () => {
    expect(code('1 +')).toBe('syntax')
    expect(code('(1)(2)')).toBe('syntax')
    expect(code('')).toBe('syntax')
    expect(code('   ')).toBe('syntax')
  })

  it('reports an unknown identifier', () => {
    expect(code('foo')).toBe('unknown-identifier')
  })

  it('reports an unknown function', () => {
    expect(code('foo(1)')).toBe('unknown-function')
    // An identifier followed by `(` is always a call, so a name that is a valid
    // identifier but not a function is a function error, not an arity one.
    expect(code('t(1)')).toBe('unknown-function')
  })

  it('reports arity', () => {
    expect(code('sin(1, 2)')).toBe('arity')
    expect(code('min()')).toBe('arity')
    expect(code('clamp(1, 2)')).toBe('arity')
    expect(code('min(1,2,3,4,5,6,7,8,9)')).toBe('arity')
  })

  it('reports a type error for a name that is not quoted', () => {
    expect(code('clip(1).x')).toBe('type')
    expect(code('stage')).toBe('type')
    expect(code('"x" + 1')).toBe('type')
  })

  it('reports a bare clip call as needing a field', () => {
    expect(code('clip("a")')).toBe('type')
  })

  it('reports an unknown member', () => {
    expect(code('clip("a").z')).toBe('unknown-member')
    expect(code('stage.depth')).toBe('unknown-member')
  })

  it('reports an unknown easing name', () => {
    expect(code('ease(t, "nope")')).toBe('unknown-easing')
    // A spring id without its namespace is not a curve name.
    expect(code('ease(t, "bouncy")')).toBe('unknown-easing')
  })

  it('accepts a spring easing name', () => {
    expect(shape('ease(t, "spring:bouncy")')).toBe('(ease t "spring:bouncy")')
  })
})

describe('bounds', () => {
  it('accepts 255 nodes and rejects 257', () => {
    // Counted while parsing, so a 512-character input cannot build a deep tree
    // first and be rejected afterwards.
    const ok = parseExpression(`${'1+'.repeat(127)}1`)
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.nodes).toBe(255)

    const bad = parseExpression(`${'1+'.repeat(128)}1`)
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.code).toBe('too-complex')
  })

  it('accepts 512 characters and rejects 513', () => {
    const atLimit = `${'1+'.repeat(128)}1`
    expect(atLimit.length).toBe(257)
    const long = 't'.repeat(0) + `${'1'.repeat(512)}`
    const r = parseExpression(long)
    expect(r.ok).toBe(true)

    const tooLong = parseExpression(`${'1'.repeat(513)}`)
    expect(tooLong.ok).toBe(false)
    if (!tooLong.ok) {
      expect(tooLong.code).toBe('too-long')
      expect(tooLong.pos).toBe(512)
    }
  })

  it('rejects a non-string source', () => {
    const r = parseExpression(42 as unknown as string)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('syntax')
  })
})

describe('the parse cache', () => {
  it('returns the same object for the same source', () => {
    // The resolver parses the same source on every frame of every channel, so
    // identity here is the point, not an optimisation detail.
    expect(parseExpression('t * 2')).toBe(parseExpression('t * 2'))
  })

  it('caches failures too', () => {
    // Otherwise an invalid expression is re-parsed once per frame forever.
    expect(parseExpression('foo')).toBe(parseExpression('foo'))
  })

  it('is cleared on demand', () => {
    const before = parseExpression('t * 2')
    clearExpressionCache()
    const after = parseExpression('t * 2')
    expect(after).not.toBe(before)
    expect(after).toEqual(before)
  })
})

describe('positions', () => {
  it('carries the source position of the offending token', () => {
    const r: ParseResult = parseExpression('1 +')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.pos).toBe(3)

    const bar = parseExpression('t + bar')
    expect(bar.ok).toBe(false)
    if (!bar.ok) {
      expect(bar.code).toBe('unknown-identifier')
      expect(bar.pos).toBe(4)
    }
  })
})
