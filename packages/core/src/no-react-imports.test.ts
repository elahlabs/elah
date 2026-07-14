import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guards the "core has zero React imports" rule (ARCHITECTURE.md §Layering).
 * @elah/core must load in non-React environments (Node, workers, Vue, Svelte),
 * so no source file may import 'react' or zustand's React entry point —
 * only 'zustand/vanilla' and 'zustand/middleware' are allowed.
 * React bindings belong in @elah/react. See issue #42.
 */

const SRC_ROOT = join(__dirname)

function collectSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...collectSourceFiles(full))
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

const IMPORT_RE = /from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g

function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  const specifiers: string[] = []
  for (const match of source.matchAll(IMPORT_RE)) {
    specifiers.push((match[1] ?? match[2]) as string)
  }
  return specifiers
}

describe('core stays React-free', () => {
  const files = collectSourceFiles(SRC_ROOT)

  it('finds source files to scan', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it("no file imports 'react' or 'react-dom'", () => {
    const offenders = files.filter((f) =>
      importsOf(f).some((s) => s === 'react' || s === 'react-dom' || s.startsWith('react/')),
    )
    expect(offenders).toEqual([])
  })

  it("no file imports zustand's React entry (only zustand/vanilla and zustand/middleware)", () => {
    const offenders = files.filter((f) =>
      importsOf(f).some((s) => s === 'zustand' || s === 'zustand/react' || s === 'zustand/traditional'),
    )
    expect(offenders).toEqual([])
  })
})
