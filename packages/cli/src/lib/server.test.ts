import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  resolveDistFile,
  resolveModuleFile,
  rewriteSpecifiers,
  startHarnessServer,
  type HarnessServer,
} from './server'

describe('resolveDistFile', () => {
  const root = mkdtempSync(join(tmpdir(), 'elah-dist-'))
  mkdirSync(join(root, 'export'), { recursive: true })
  writeFileSync(join(root, 'export', 'exportVideo.js'), '// a')
  writeFileSync(join(root, 'export', 'ExportWorker.js'), '// w')
  writeFileSync(join(root, 'index.js'), '// i')
  mkdirSync(join(root, 'utils'))
  writeFileSync(join(root, 'utils', 'index.js'), '// u')

  it('serves exact paths', () => {
    expect(resolveDistFile(root, 'export/exportVideo.js')).toBe(join(root, 'export/exportVideo.js'))
  })

  it('falls back to +.js for extensionless module specifiers', () => {
    expect(resolveDistFile(root, 'export/exportVideo')).toBe(join(root, 'export/exportVideo.js'))
  })

  it("maps the dist's literal ExportWorker.ts worker URL to .js", () => {
    expect(resolveDistFile(root, 'export/ExportWorker.ts')).toBe(join(root, 'export/ExportWorker.js'))
  })

  it('falls back to directory index.js', () => {
    expect(resolveDistFile(root, 'utils')).toBe(join(root, 'utils/index.js'))
  })

  it('returns undefined for misses', () => {
    expect(resolveDistFile(root, 'nope/nothing')).toBeUndefined()
  })

  it('blocks path traversal', () => {
    expect(resolveDistFile(root, '../secret')).toBeUndefined()
    expect(resolveDistFile(root, 'export/../../secret')).toBeUndefined()
  })
})

describe('rewriteSpecifiers', () => {
  const vendors = new Map([
    ['mediabunny', { root: '/x', entry: 'dist/modules/src/index.js', browserFalse: new Set<string>() }],
  ])
  const url = '/vendor/mediabunny/dist/modules/src/index.js'

  it('rewrites static imports', () => {
    expect(rewriteSpecifiers("import * as mb from 'mediabunny';", vendors)).toBe(
      `import * as mb from '${url}';`
    )
  })

  it('rewrites re-exports and dynamic imports', () => {
    expect(rewriteSpecifiers("export { Input } from 'mediabunny'", vendors)).toContain(url)
    expect(rewriteSpecifiers("await import('mediabunny')", vendors)).toContain(url)
  })

  it('rewrites bare side-effect imports', () => {
    expect(rewriteSpecifiers("import 'mediabunny'\nconst x = 1", vendors)).toContain(url)
  })

  it('leaves relative imports and other specifiers alone', () => {
    const src = "import { a } from './local'\nimport b from 'other-pkg'"
    expect(rewriteSpecifiers(src, vendors)).toBe(src)
  })
})

// The full server resolves @elah/core's dist at startup — only run when built.
const coreDistBuilt = (() => {
  try {
    return existsSync(resolveModuleFile('@elah/core'))
  } catch {
    return false
  }
})()
if (!coreDistBuilt) {
  console.warn(
    '[cli tests] @elah/core dist not built — startHarnessServer suite SKIPPED. Run `npm run build:packages` first.'
  )
}

describe.skipIf(!coreDistBuilt)('startHarnessServer', () => {
  const TOKEN = 'test-token'
  const mediaDir = mkdtempSync(join(tmpdir(), 'elah-media-'))
  const mediaFile = join(mediaDir, 'clip.mp4')
  writeFileSync(mediaFile, Buffer.from('0123456789abcdef'))

  let server: HarnessServer
  afterAll(async () => {
    await server?.close()
  })

  it('serves harness, core modules (rewritten), and ranged media', async () => {
    server = await startHarnessServer({
      token: TOKEN,
      media: new Map([[`/media/${TOKEN}/0`, mediaFile]]),
    })

    const html = await fetch(`${server.origin}/`)
    expect(html.status).toBe(200)
    expect(await html.text()).toContain('/harness.js')

    const harness = await fetch(`${server.origin}/harness.js`)
    expect(await harness.text()).toContain(`/cb/${TOKEN}`)

    const worker = await fetch(`${server.origin}/core/export/ExportWorker.ts`)
    expect(worker.status).toBe(200)
    expect(worker.headers.get('content-type')).toBe('text/javascript')
    const workerSource = await worker.text()
    expect(workerSource).not.toMatch(/from\s*['"]mediabunny['"]/)
    expect(workerSource).toContain('/vendor/mediabunny/')

    const full = await fetch(`${server.origin}/media/${TOKEN}/0`)
    expect(full.status).toBe(200)
    expect(full.headers.get('accept-ranges')).toBe('bytes')

    const ranged = await fetch(`${server.origin}/media/${TOKEN}/0`, {
      headers: { range: 'bytes=4-7' },
    })
    expect(ranged.status).toBe(206)
    expect(ranged.headers.get('content-range')).toBe('bytes 4-7/16')
    expect(await ranged.text()).toBe('4567')

    // suffix, open-ended, unsatisfiable, malformed ranges
    const suffix = await fetch(`${server.origin}/media/${TOKEN}/0`, {
      headers: { range: 'bytes=-4' },
    })
    expect(suffix.status).toBe(206)
    expect(await suffix.text()).toBe('cdef')

    const open = await fetch(`${server.origin}/media/${TOKEN}/0`, {
      headers: { range: 'bytes=12-' },
    })
    expect(open.status).toBe(206)
    expect(await open.text()).toBe('cdef')

    const beyond = await fetch(`${server.origin}/media/${TOKEN}/0`, {
      headers: { range: 'bytes=99-' },
    })
    expect(beyond.status).toBe(416)

    const malformed = await fetch(`${server.origin}/media/${TOKEN}/0`, {
      headers: { range: 'bytes=abc' },
    })
    expect(malformed.status).toBe(200)

    const missing = await fetch(`${server.origin}/media/${TOKEN}/9`)
    expect(missing.status).toBe(404)
  })

  it("stubs mediabunny's browser:false node-only module with an empty module", async () => {
    const stub = await fetch(`${server.origin}/vendor/mediabunny/dist/modules/src/node.js`)
    expect(stub.status).toBe(200)
    const source = await stub.text()
    expect(source.trim()).toBe('export {}')
    expect(source).not.toContain('node:fs')
  })

  it('delivers progress and result round-trips on token routes only', async () => {
    const progress: Array<{ frame: number; totalFrames: number }> = []
    const s = await startHarnessServer({
      token: TOKEN,
      media: new Map(),
      onProgress: (p) => progress.push(p),
    })

    // wrong token → 404, callback not invoked
    const forged = await fetch(`${s.origin}/cb/wrong-token/progress`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ frame: 9, totalFrames: 10 }),
    })
    expect(forged.status).toBe(404)
    expect(progress).toEqual([])

    await fetch(`${s.origin}/cb/${TOKEN}/progress`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ frame: 3, totalFrames: 10 }),
    })
    expect(progress).toEqual([{ frame: 3, totalFrames: 10 }])

    const bytes = Buffer.from([1, 2, 3, 4])
    await fetch(`${s.origin}/cb/${TOKEN}/result`, { method: 'POST', body: bytes })
    expect(await s.result).toEqual(bytes)
    await s.close()
  })
})
