import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * Guards the layering rules in docs/react-native/03-architecture.md:
 *
 *   core <- react <- react-native   (react-native never imports timeline or editor)
 *
 * and the one this package adds: `src/timeline/model` is platform-free. The
 * reducers run in Node against the real engine, which is the whole point of
 * keeping React, react-native, gesture-handler, Reanimated and Skia out of
 * that directory. Modelled on core's `no-react-imports.test.ts`.
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

const IMPORT_RE = /from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)/g

function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  const specifiers: string[] = []
  for (const match of source.matchAll(IMPORT_RE)) {
    specifiers.push((match[1] ?? match[2] ?? match[3]) as string)
  }
  return specifiers
}

const rel = (file: string) => relative(SRC_ROOT, file).split(sep).join('/')

describe('@elah/react-native layering', () => {
  const files = collectSourceFiles(SRC_ROOT)

  it('finds source files to scan', () => {
    expect(files.length).toBeGreaterThan(5)
  })

  it('never imports the DOM packages or the web timeline / editor', () => {
    const banned = ['react-dom', '@elah/timeline', '@elah/editor', 'lucide-react']
    const offenders = files
      .filter((f) => importsOf(f).some((s) => banned.some((b) => s === b || s.startsWith(`${b}/`))))
      .map(rel)
    expect(offenders).toEqual([])
  })

  it('keeps the timeline model platform-free (no React, react-native, gesture-handler, Reanimated or Skia)', () => {
    const banned = [
      'react',
      'react-native',
      'react-native-gesture-handler',
      'react-native-reanimated',
      'react-native-worklets',
      'react-native-skia',
      '@shopify/react-native-skia',
      'expo',
    ]
    const offenders = files
      .filter((f) => rel(f).startsWith('timeline/model/'))
      .filter((f) => importsOf(f).some((s) => banned.some((b) => s === b || s.startsWith(`${b}/`) || s.startsWith('expo-'))))
      .map(rel)
    expect(offenders).toEqual([])
  })

  it('imports @elah/core by value only through the browser-free engine entry', () => {
    // The root '@elah/core' reaches the export worker's import.meta, which
    // Metro cannot parse. Type-only imports from it are erased and allowed.
    const offenders = files
      .filter((f) => {
        const source = readFileSync(f, 'utf8')
        // One statement at a time: the body may not cross another `from`.
        const statements = source.match(
          /(?:^|\n)\s*(?:import|export)\s+(?!type\s)(?:(?!\bfrom\b)[\s\S])*?\bfrom\s+['"]@elah\/core['"]/g,
        )
        return statements !== null
      })
      .map(rel)
    expect(offenders).toEqual([])
  })

  it('reaches @elah/core only through a package entry, never a deep path', () => {
    const offenders = files
      .filter((f) =>
        importsOf(f).some(
          (s) => s.startsWith('@elah/core/') && s !== '@elah/core/engine',
        ),
      )
      .map(rel)
    expect(offenders).toEqual([])
  })

  it('contains no import.meta (Metro and Hermes reject it)', () => {
    const offenders = files.filter((f) => readFileSync(f, 'utf8').includes('import.meta')).map(rel)
    expect(offenders).toEqual([])
  })
})
