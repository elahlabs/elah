import { describe, expect, it } from 'vitest'
import { tokenize, type Token } from './tokenize'

/** `kind` for each token, so a test can assert the shape without noise. */
const kinds = (source: string): string[] => {
  const r = tokenize(source)
  if (!r.ok) throw new Error(`expected ${source} to tokenize: ${r.message}`)
  return r.tokens.map((t) => t.kind)
}

const ops = (source: string): string[] => {
  const r = tokenize(source)
  if (!r.ok) throw new Error(`expected ${source} to tokenize: ${r.message}`)
  return r.tokens.filter((t) => t.kind === 'op').map((t) => t.text)
}

const first = (source: string): Token => {
  const r = tokenize(source)
  if (!r.ok) throw new Error(`expected ${source} to tokenize: ${r.message}`)
  return r.tokens[0]!
}

describe('tokenize', () => {
  it('reads a number, an operator, a fraction with an exponent, and eof', () => {
    // '.5e1' is 5, and the two operators sit at 0, 2 and 4 — pos is always the
    // token's FIRST character, which is what an error message must point at.
    expect(kinds('1 + .5e1')).toEqual(['num', 'op', 'num', 'eof'])
    const r = tokenize('1 + .5e1')
    if (!r.ok) throw new Error('unreachable')
    expect(r.tokens[0]).toMatchObject({ value: 1, pos: 0 })
    expect(r.tokens[2]).toMatchObject({ value: 5, pos: 4 })
  })

  it('reads a trailing dot and a signed exponent', () => {
    expect(first('5.')).toMatchObject({ value: 5 })
    expect(first('1e-3')).toMatchObject({ value: 0.001 })
    expect(first('2E+2')).toMatchObject({ value: 200 })
  })

  it('rejects a dangling exponent rather than reading 1 and leaving the e', () => {
    // `1e` is a typo. The "digit immediately followed by a letter" rule fires
    // before the exponent could be read as anything, so this is an error at the
    // 'e' rather than the number 1 followed by a stray identifier.
    const r = tokenize('1e')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.pos).toBe(1)
  })

  it('reads two-character operators before one-character ones', () => {
    expect(ops('a<=b')).toEqual(['<='])
    expect(kinds('a<=b')).toEqual(['id', 'op', 'id', 'eof'])
  })

  it('reads a call, a member access and a string', () => {
    expect(kinds('clip("Title").x')).toEqual(['id', 'op', 'str', 'op', 'op', 'id', 'eof'])
    const r = tokenize('clip("Title").x')
    if (!r.ok) throw new Error('unreachable')
    // `text` is the CONTENT, without the quotes — the parser compares it against
    // the identifier tables, and quotes would make every name unknown.
    expect(r.tokens[2]).toMatchObject({ kind: 'str', text: 'Title', pos: 5 })
  })

  it('accepts single-quoted text and an empty string', () => {
    expect(first("'abc'")).toMatchObject({ kind: 'str', text: 'abc' })
    expect(first('""')).toMatchObject({ kind: 'str', text: '' })
  })

  it('always ends with eof at the source length', () => {
    const r = tokenize('t*2')
    if (!r.ok) throw new Error('unreachable')
    expect(r.tokens[r.tokens.length - 1]).toEqual({ kind: 'eof', text: '', pos: 3 })
  })

  it('skips every kind of whitespace', () => {
    expect(kinds('  t\t+\n2\r ')).toEqual(['id', 'op', 'num', 'eof'])
  })

  it('reads underscores in identifiers', () => {
    expect(first('my_clip')).toMatchObject({ kind: 'id', text: 'my_clip' })
  })
})

describe('tokenize errors', () => {
  const err = (source: string) => {
    const r = tokenize(source)
    if (r.ok) throw new Error(`expected ${source} to fail`)
    return r
  }

  it('rejects a lone assignment sign at its own position', () => {
    // '=' alone is a typo, not an assignment: the language has no assignment.
    expect(err('x = 1').pos).toBe(2)
  })

  it('rejects a number running into a letter', () => {
    // `2x` is a typo rather than an implicit multiply, and the position is the
    // offending character, not the start of the number.
    expect(err('2x').pos).toBe(1)
  })

  it('rejects unterminated text at the opening quote', () => {
    expect(err('"abc').pos).toBe(0)
    expect(err('"abc').message).toMatch(/Unterminated text/)
  })

  it('rejects text of 65 characters and accepts 64', () => {
    const ok = tokenize(`"${'a'.repeat(64)}"`)
    expect(ok.ok).toBe(true)
    const bad = err(`"${'a'.repeat(65)}"`)
    expect(bad.pos).toBe(0)
    expect(bad.message).toMatch(/Text longer than 64 characters/)
  })

  it('rejects a newline inside text', () => {
    expect(err('"ab\ncd"').pos).toBe(0)
  })

  it('rejects a lone ampersand and a lone pipe', () => {
    expect(err('a & b').pos).toBe(2)
    expect(err('a | b').pos).toBe(2)
  })

  it('rejects an unknown character at its own position', () => {
    expect(err('1 @ 2').pos).toBe(2)
  })
})
