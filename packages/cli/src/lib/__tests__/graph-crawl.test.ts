// Regression crawler — walks the served module graph exactly like a browser
// would and fails on anything unloadable: 404s, wrong MIME, bare specifiers
// that escaped the vendor rewrite (e.g. mediabunny's node-only modules).
import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { resolveModuleFile, startHarnessServer } from '../server'

// A specifier has no whitespace, which keeps string literals that merely
// contain the word (`num(params, 'from', 0)`) from reading as imports.
const IMPORT_RE = /\b(?:from|import)\s*\(?\s*['"]([^'"\s]+)['"]/g

const coreDistBuilt = (() => {
  try {
    return existsSync(resolveModuleFile('@elah/core'))
  } catch {
    return false
  }
})()
if (!coreDistBuilt) {
  console.warn(
    '[cli tests] @elah/core dist not built — module-graph crawl SKIPPED. Run `npm run build:packages` first.'
  )
}

describe.skipIf(!coreDistBuilt)('served module graph', () => {
  it('every transitive import of ExportWorker resolves', async () => {
    const server = await startHarnessServer({ token: 'crawl-token', media: new Map() })
    const seen = new Set<string>()
    const queue = ['/core/export/ExportWorker.ts', '/core/export/exportVideo.js']
    const failures: string[] = []

    while (queue.length) {
      const path = queue.shift()!
      if (seen.has(path)) continue
      seen.add(path)

      const res = await fetch(server.origin + path)
      const type = res.headers.get('content-type')
      if (res.status !== 200) {
        failures.push(`${res.status} ${path}`)
        continue
      }
      if (!type?.includes('javascript')) failures.push(`BAD MIME ${type} ${path}`)

      // Like a browser, resolve relative imports against the response URL:
      // a directory request is redirected to its index.js.
      const base = res.url || server.origin + path
      const source = await res.text()
      for (const match of source.matchAll(IMPORT_RE)) {
        const spec = match[1]
        if (!spec.startsWith('.') && !spec.startsWith('/')) {
          failures.push(`UNREWRITTEN BARE '${spec}' in ${path}`)
          continue
        }
        const resolved = new URL(spec, base).pathname
        if (!seen.has(resolved)) queue.push(resolved)
      }
    }

    await server.close()
    console.log(`crawled ${seen.size} modules`)
    expect(failures).toEqual([])
  }, 30000)
})
