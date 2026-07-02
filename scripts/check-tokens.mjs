#!/usr/bin/env node
/**
 * Token drift guard.
 *
 * The published packages (@elah/timeline, @elah/editor) must not reintroduce raw
 * color literals in component files — every color goes through the --elah-* CSS
 * variable contract (as a Tailwind token class or a var(--elah-*) reference).
 * This keeps the whole editor themeable from one place and vendor-overridable.
 *
 * Allowed: hex/rgb inside a var() fallback, e.g. var(--elah-x, #4c9aff).
 * Allowed: hex/rgb in // line comments (explanatory docs, not live style values).
 * Ignored: theme.ts (backward-compat CSS-var facade; not a color source).
 *
 * Run: node scripts/check-tokens.mjs   (exits non-zero on violations)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['packages/timeline/src', 'packages/editor/src']
const IGNORE = [/theme\.ts$/]
const HEX = /#[0-9a-fA-F]{3,8}\b/
// Strip var(--name) and var(--name, fallback) spans (fallbacks legitimately
// carry a literal). Fallbacks contain no nested ')' for color values.
const VAR = /var\(\s*--[a-z0-9-]+(?:\s*,[^)]*)?\)/g
// Strip single-line JS comments — hex inside a // comment is documentation,
// not a live style value, and should not count as a token violation.
const COMMENT = /\/\/.*/

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.tsx$/.test(p) && !IGNORE.some((re) => re.test(p))) out.push(p)
  }
  return out
}

const violations = []
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      const stripped = line.replace(VAR, '').replace(COMMENT, '')
      if (HEX.test(stripped)) violations.push(`${file}:${i + 1}: ${line.trim()}`)
    })
  }
}

if (violations.length) {
  console.error(
    `\n✖ Raw color literal(s) found in package components — use a token class or var(--elah-*):\n`,
  )
  for (const v of violations) console.error('  ' + v)
  console.error(`\n${violations.length} violation(s).\n`)
  process.exit(1)
}
console.log('✓ No raw color literals in package components.')
