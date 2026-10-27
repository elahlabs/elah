/**
 * The expression tokenizer (PV-P5b-1): text → tokens, or one syntax error.
 *
 * Hand-written on purpose. A regular expression cannot enforce the two rules
 * that matter most here — a number may not run into an identifier, and a string
 * may not contain a newline — without either accepting `2x` or rejecting valid
 * input, and a tokenizer that is hard to reason about is a tokenizer that
 * eventually lets something through the parser.
 *
 * `pos` is the index of a token's FIRST character, always, so an error position
 * points at the token the author can see rather than at its end.
 */

import { MAX_STRING_LITERAL } from './scope'

export type TokenKind = 'num' | 'str' | 'id' | 'op' | 'eof'

export interface Token {
  kind: TokenKind
  /** The token's source text. Empty for `eof`; the CONTENT (no quotes) for `str`. */
  text: string
  /** Numeric value, `num` tokens only. */
  value?: number
  pos: number
}

export type TokenizeResult =
  | { ok: true; tokens: Token[] }
  | { ok: false; code: 'syntax'; message: string; pos: number }

/** Two-character operators, matched before the single-character ones. */
const OPERATORS_2 = ['<=', '>=', '==', '!=', '&&', '||']
/** Single-character operators. Note there is no bare `=`, `&` or `|`: they are
 *  only ever part of `==`, `!=`, `&&`, `||`, and a lone one is a typo worth
 *  reporting rather than silently treating as something else. */
const OPERATORS_1 = ['+', '-', '*', '/', '%', '^', '(', ')', ',', '.', '?', ':', '<', '>', '!']

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9'
}

function isIdentStart(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_'
}

function isIdentPart(c: string): boolean {
  return isIdentStart(c) || isDigit(c)
}

function unexpected(c: string, pos: number): TokenizeResult {
  return { ok: false, code: 'syntax', message: `Unexpected "${c}" at ${pos}`, pos }
}

export function tokenize(source: string): TokenizeResult {
  const tokens: Token[] = []
  let i = 0

  while (i < source.length) {
    const c = source[i]!

    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++
      continue
    }

    // Number. Two shapes, because `.5` is legal and `5.` is too — but `5` must
    // not be allowed to swallow the `.` of a member access on an integer.
    if (isDigit(c) || (c === '.' && isDigit(source[i + 1] ?? ''))) {
      const pos = i
      if (isDigit(c)) {
        while (i < source.length && isDigit(source[i]!)) i++
        if (source[i] === '.') {
          i++
          while (i < source.length && isDigit(source[i]!)) i++
        }
      } else {
        i++ // the leading '.'
        while (i < source.length && isDigit(source[i]!)) i++
      }
      if (source[i] === 'e' || source[i] === 'E') {
        const save = i
        i++
        if (source[i] === '+' || source[i] === '-') i++
        if (isDigit(source[i] ?? '')) {
          while (i < source.length && isDigit(source[i]!)) i++
        } else {
          i = save // not an exponent after all
        }
      }
      const text = source.slice(pos, i)
      // `2x` is a typo, not an implicit multiply: reporting it here names the
      // exact character instead of leaving the parser to say "unexpected id".
      if (isIdentStart(source[i] ?? '')) return unexpected(source[i]!, i)
      tokens.push({ kind: 'num', text, value: Number(text), pos })
      continue
    }

    if (isIdentStart(c)) {
      const pos = i
      while (i < source.length && isIdentPart(source[i]!)) i++
      tokens.push({ kind: 'id', text: source.slice(pos, i), pos })
      continue
    }

    if (c === '"' || c === "'") {
      const pos = i
      const quote = c
      i++
      const start = i
      while (i < source.length && source[i] !== quote) {
        // No escapes and no newlines inside a literal: a name is a name, and a
        // newline almost always means a missing quote somewhere above.
        if (source[i] === '\n' || source[i] === '\r') return unexpected(c, pos)
        i++
      }
      if (i >= source.length) {
        return { ok: false, code: 'syntax', message: `Unterminated text at ${pos}`, pos }
      }
      const text = source.slice(start, i)
      if (text.length > MAX_STRING_LITERAL) {
        return {
          ok: false,
          code: 'syntax',
          message: `Text longer than ${MAX_STRING_LITERAL} characters at ${pos}`,
          pos,
        }
      }
      i++ // closing quote
      tokens.push({ kind: 'str', text, pos })
      continue
    }

    const two = source.slice(i, i + 2)
    if (OPERATORS_2.includes(two)) {
      tokens.push({ kind: 'op', text: two, pos: i })
      i += 2
      continue
    }

    if (OPERATORS_1.includes(c)) {
      tokens.push({ kind: 'op', text: c, pos: i })
      i++
      continue
    }

    return unexpected(c, i)
  }

  tokens.push({ kind: 'eof', text: '', pos: source.length })
  return { ok: true, tokens }
}
