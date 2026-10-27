import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * The expression language must never reach JavaScript (PV-P5b-1, Principle 5
 * of the plan: "Expressions are a small language, not JavaScript").
 *
 * A test that greps the source is the only enforcement that cannot be defeated
 * by a well-meaning refactor. Each pattern below is a distinct escape route, and
 * any one of them would turn a 512-character document into arbitrary code
 * execution — in the preview and again in the export worker.
 *
 * **Comments and string literals are stripped before matching.** These files
 * explain the rule in prose, and a grep that cannot tell a comment from code
 * fails the moment someone writes down WHY the rule exists — at which point the
 * tempting fix is to delete the explanation, and the guard has taught the team
 * that the guard is the problem. Neither a comment nor a string literal can
 * execute anything, so excluding them costs no real coverage.
 */
const FILES = ['./scope.ts', './tokenize.ts', './parse.ts', './evaluate.ts'] as const

const FORBIDDEN: ReadonlyArray<{ what: string; pattern: RegExp }> = [
  { what: 'eval(', pattern: /\beval\s*\(/ },
  { what: 'new Function', pattern: /new\s+Function\b/ },
  { what: 'Function(', pattern: /\bFunction\s*\(/ },
  { what: 'a with-statement', pattern: /\bwith\s*\(/ },
  { what: 'a dynamic import', pattern: /import\s*\(/ },
  { what: 'setTimeout/setInterval', pattern: /\bset(?:Timeout|Interval)\s*\(/ },
  { what: 'Date.now()', pattern: /\bDate\s*\.\s*now\b/ },
  { what: 'Math.random()', pattern: /\bMath\s*\.\s*random\b/ },
  { what: 'a globalThis lookup', pattern: /globalThis\s*\[/ },
  { what: 'a window lookup', pattern: /\bwindow\s*\[/ },
]

/**
 * Remove comments and string/template literals. None of these four files
 * contains a regex literal, so a `//` or quote inside one cannot confuse it —
 * asserted by the self-test below, which is the reason to believe that.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
}

const sourceOf = (file: string): string => readFileSync(new URL(file, import.meta.url), 'utf8')

describe('noEval', () => {
  for (const file of FILES) {
    it(`${file} contains no escape route to JavaScript`, () => {
      const code = codeOnly(sourceOf(file))
      for (const { what, pattern } of FORBIDDEN) {
        expect(pattern.test(code), `${file} must not use ${what}`).toBe(false)
      }
    })
  }

  it('really reads the sources, rather than passing on empty strings', () => {
    // A guard that reads nothing passes everything. A path typo must not turn
    // the whole file into a green no-op.
    for (const file of FILES) {
      const source = sourceOf(file)
      expect(source.length).toBeGreaterThan(200)
      expect(source).toContain('export')
      expect(codeOnly(source).length).toBeGreaterThan(100)
    }
  })
})

describe('the noEval guard can actually fail', () => {
  // Without this, "strip comments" could quietly turn the guard into a no-op:
  // a stripper that emptied the string would make every pattern pass.
  it('still sees eval in code', () => {
    const code = codeOnly('const x = 1; function f(y) { return eval(y); }')
    expect(FORBIDDEN.some((r) => r.pattern.test(code))).toBe(true)
  })

  it('sees every forbidden construct in code', () => {
    const samples = [
      'eval(x)',
      'new Function("return 1")',
      'Function("return 1")',
      'with (a) { b() }',
      'await import("./x")',
      'setTimeout(f, 1)',
      'Date.now()',
      'Math.random()',
      'globalThis["ev" + "al"]',
      'window["y"]',
    ]
    for (const s of samples) {
      const code = codeOnly(`// leading comment\n${s}\n`)
      expect(FORBIDDEN.some((r) => r.pattern.test(code)), `should catch: ${s}`).toBe(true)
    }
  })

  it('does not fire on prose that merely mentions them', () => {
    // The reason `codeOnly` exists: these files document the rule.
    const comment = '// No eval, no new Function, no with, no dynamic import here.'
    const block = '/* never call eval( in this module */'
    const strings = 'const msg = "do not use eval(" + "or Date.now()"'
    for (const s of [comment, block, strings]) {
      expect(FORBIDDEN.some((r) => r.pattern.test(codeOnly(s))), `should ignore: ${s}`).toBe(false)
    }
  })
})
